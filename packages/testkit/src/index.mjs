import fs from "node:fs/promises";
import path from "node:path";

import { applyContentQuery, getContentTypeForPath } from "../../core/src/index.mjs";

function normalizeKey(key) {
  return String(key).replace(/\\/g, "/");
}

export class InMemoryTemplateRepository {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files).map(([key, value]) => [
      normalizeKey(key),
      {
        key: normalizeKey(key),
        body: value,
        contentType: getContentTypeForPath(key)
      }
    ]));
  }

  async get(key) {
    return this.files.get(normalizeKey(key)) ?? null;
  }

  async listVariantEntries(variant) {
    const prefix = `${variant}/`;
    return [...this.files.values()].filter((entry) => entry.key.startsWith(prefix));
  }

  async exists(key) {
    return this.files.has(normalizeKey(key));
  }
}

export class InMemoryContentRepository {
  constructor(items = []) {
    this.items = [...items];
  }

  async getByContentId(contentId) {
    return this.items.find((item) => item.contentId === contentId) ?? null;
  }

  async query(query) {
    return applyContentQuery(this.items, query);
  }
}

export class MemoryDependencyStore {
  constructor() {
    this.bySource = new Map();
  }

  async replaceSourceDependencies(record) {
    this.bySource.set(record.sourceId, record);
  }

  async findDependentsByDependency(ref) {
    const dependencyKey = `${ref.kind}#${ref.id}`;
    return [...this.bySource.values()].filter((record) => record.dependencies.some((dependency) => (
      `${dependency.kind}#${dependency.id}` === dependencyKey
    )));
  }

  async findGeneratedOutputsByTemplate(templateKey, scope) {
    return [...this.bySource.values()]
      .filter((record) => record.templateKey === templateKey
        && record.environment === scope.environment
        && record.variant === scope.variant
        && record.language === scope.language)
      .map((record) => ({
        environment: record.environment,
        variant: record.variant,
        language: record.language,
        templateKey: record.templateKey,
        outputKey: record.outputKey
      }));
  }

  async deleteOutput(output) {
    const sourceId = `${output.environment}#${output.variant}#${output.language}#${output.outputKey}`;
    this.bySource.delete(sourceId);
  }
}

export class CollectingOutputPublisher {
  constructor() {
    this.operations = [];
  }

  async put(artifact, target) {
    this.operations.push({ type: "put", artifact, target });
  }

  async copySourceObject(sourceKey, target) {
    this.operations.push({ type: "copy", sourceKey, target });
  }

  async delete(outputKey, target) {
    this.operations.push({ type: "delete", outputKey, target });
  }
}

export class CollectingInvalidationScheduler {
  constructor() {
    this.requests = [];
  }

  async enqueue(request) {
    this.requests.push(request);
  }
}

export async function loadContentFixtures(projectDir, languageCode) {
  const candidates = [
    path.join(projectDir, "offline", "content", `${languageCode}.json`),
    path.join(projectDir, "offline", "content", "items.json"),
    path.join(projectDir, "content", `${languageCode}.json`),
    path.join(projectDir, "content", "items.json")
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        return items;
      }
    } catch {
      // optional fixture file
    }
  }

  return [];
}
