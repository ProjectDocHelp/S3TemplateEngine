import fs from "node:fs/promises";
import path from "node:path";

import { applyContentQuery, getContentTypeForPath } from "../../core/src/index.mjs";

function normalizeKey(value) {
  return String(value).replace(/\\/g, "/");
}

function matchesProjectRelativeRoot(key, root) {
  const normalizedKey = normalizeKey(key);
  const normalizedRoot = normalizeKey(root);
  return normalizedKey === normalizedRoot || normalizedKey.startsWith(`${normalizedRoot}/`);
}

function normalizeLocale(value) {
  return String(value).trim().toLowerCase();
}

function comparableTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : -1;
}

function compareContentFreshness(left, right) {
  const updatedDiff = comparableTimestamp(right.updatedAt) - comparableTimestamp(left.updatedAt);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const changedDiff = comparableTimestamp(right.lastChangedAt) - comparableTimestamp(left.lastChangedAt);
  if (changedDiff !== 0) {
    return changedDiff;
  }

  const createdDiff = comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  const versionDiff = Number(right.version ?? -1) - Number(left.version ?? -1);
  if (versionDiff !== 0) {
    return versionDiff;
  }

  return String(right.id ?? "").localeCompare(String(left.id ?? ""));
}

function buildLocaleCandidates(language, languageLocaleMap) {
  const requested = String(language ?? "").trim();
  const configured = String(languageLocaleMap?.[requested] ?? requested).trim();
  return [...new Set([configured, requested].filter(Boolean).map(normalizeLocale))];
}

function matchesRequestedLocale(item, language, languageLocaleMap) {
  return localeMatchScore(item?.locale, language, languageLocaleMap) > 0;
}
function localeMatchScore(itemLocale, language, languageLocaleMap) {
  if (!itemLocale) {
    return 1;
  }

  const normalizedItemLocale = normalizeLocale(itemLocale);
  const candidates = buildLocaleCandidates(language, languageLocaleMap);
  if (candidates.includes(normalizedItemLocale)) {
    return 3;
  }

  if (candidates.some((candidate) => candidate.length >= 2 && normalizedItemLocale.startsWith(`${candidate}-`))) {
    return 2;
  }

  return 0;
}

function filterItemsByRequestedLocale(items, language, languageLocaleMap) {
  const grouped = new Map();

  for (const item of items) {
    const groupKey = item.contentId ?? item.id ?? JSON.stringify(item);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push(item);
  }

  return [...grouped.values()].flatMap((groupItems) => {
    const scored = groupItems
      .map((item) => ({ item, score: localeMatchScore(item.locale, language, languageLocaleMap) }))
      .filter((entry) => entry.score > 0);
    if (scored.length === 0) {
      return [];
    }

    const bestScore = Math.max(...scored.map((entry) => entry.score));
    return scored
      .filter((entry) => entry.score === bestScore)
      .map((entry) => entry.item)
      .sort(compareContentFreshness)
      .slice(0, 1);
  });
}

async function walkFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootDir, fullPath));
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return files;
}

export class FileSystemTemplateRepository {
  constructor(projectDir, config) {
    this.projectDir = projectDir;
    this.config = config;
  }

  resolveKey(key) {
    const normalized = normalizeKey(key);

    for (const variantConfig of Object.values(this.config.variants)) {
      if (
        matchesProjectRelativeRoot(normalized, variantConfig.sourceDir)
        || matchesProjectRelativeRoot(normalized, variantConfig.partDir)
      ) {
        return path.join(this.projectDir, normalized);
      }
    }

    for (const [variantName, variantConfig] of Object.entries(this.config.variants)) {
      if (normalized === variantName || normalized.startsWith(`${variantName}/`)) {
        const suffix = normalized === variantName ? "" : normalized.slice(variantName.length + 1);
        return path.join(this.projectDir, variantConfig.sourceDir, suffix);
      }
    }

    return path.join(this.projectDir, normalized);
  }

  async get(key) {
    const filePath = this.resolveKey(key);
    try {
      const body = await fs.readFile(filePath);
      return {
        key: normalizeKey(key),
        body: body.toString("utf8"),
        contentType: getContentTypeForPath(filePath)
      };
    } catch {
      return null;
    }
  }

  async listVariantEntries(variant) {
    const variantConfig = this.config.variants[variant];
    const sourceDir = path.join(this.projectDir, variantConfig.sourceDir);
    const files = await walkFiles(sourceDir);
    return files.map((relativePath) => ({
      key: `${variant}/${relativePath}`.replace(/\\/g, "/"),
      body: null,
      contentType: getContentTypeForPath(relativePath)
    }));
  }

  async exists(key) {
    try {
      await fs.stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}

export class FileSystemContentRepository {
  constructor(itemsByLanguage, languageLocaleMap = {}) {
    this.itemsByLanguage = itemsByLanguage;
    this.languageLocaleMap = languageLocaleMap;
  }

  getItems(language) {
    const items = this.itemsByLanguage[language] ?? this.itemsByLanguage.default ?? [];
    return filterItemsByRequestedLocale(items, language, this.languageLocaleMap);
  }

  async getByContentId(contentId, language) {
    return this.getItems(language).find((item) => item.contentId === contentId) ?? null;
  }

  async query(query, language) {
    return applyContentQuery(this.getItems(language), query);
  }
}

export async function loadLocalContent(projectDir, config) {
  const contentDirectories = [
    path.join(projectDir, "offline", "content"),
    path.join(projectDir, "content")
  ];
  const itemsByLanguage = {};

  try {
    for (const contentDir of contentDirectories) {
      let entries = [];
      try {
        entries = await fs.readdir(contentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }
        const raw = await fs.readFile(path.join(contentDir, entry.name), "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          continue;
        }
        const key = entry.name === "items.json" ? "default" : entry.name.slice(0, -".json".length);
        itemsByLanguage[key] = parsed;
      }

      if (Object.keys(itemsByLanguage).length > 0) {
        break;
      }
    }
  } catch {
    for (const variantConfig of Object.values(config.variants)) {
      for (const languageCode of Object.keys(variantConfig.languages)) {
        itemsByLanguage[languageCode] = [];
      }
    }
  }

  const languageLocaleMap = Object.fromEntries(Object.entries(config.variants).flatMap(([, variantConfig]) => (
    Object.entries(variantConfig.languages).map(([languageCode, languageConfig]) => [
      languageCode,
      languageConfig.webinyLocale ?? languageCode
    ])
  )));

  return new FileSystemContentRepository(itemsByLanguage, languageLocaleMap);
}

export async function ensureDirectory(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
}

export async function writeTextFile(targetPath, body) {
  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, body, "utf8");
}

export async function copyFile(sourcePath, targetPath) {
  await ensureDirectory(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

export async function removeDirectory(targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
}
