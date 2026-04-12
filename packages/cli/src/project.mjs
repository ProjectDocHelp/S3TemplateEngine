import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

import {
  S3teError,
  buildEnvironmentRuntimeConfig,
  createManualRenderTargets,
  isRenderableKey,
  loadProjectConfig,
  renderSourceTemplate,
  validateAndResolveProjectConfig
} from "../../core/src/index.mjs";

import {
  deployAwsProject,
  ensureAwsCliAvailable,
  ensureAwsCredentials,
  packageAwsProject,
  runAwsCli,
  syncAwsProject
} from "../../aws-adapter/src/index.mjs";

import {
  FileSystemTemplateRepository,
  copyFile,
  ensureDirectory,
  loadLocalContent,
  removeDirectory,
  writeTextFile
} from "./fs-adapters.mjs";

function normalizePath(value) {
  return String(value).replace(/\\/g, "/");
}

function isProjectTestFile(filename) {
  return /(?:^test-.*|.*\.(?:test|spec))\.(?:cjs|mjs|js)$/i.test(filename);
}

async function listProjectTestFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listProjectTestFiles(rootDir, fullPath));
      continue;
    }

    if (entry.isFile() && isProjectTestFile(entry.name)) {
      files.push(normalizePath(path.relative(rootDir, fullPath)));
    }
  }

  return files.sort();
}

function unknownEnvironmentMessage(config, environmentName) {
  const knownEnvironments = Object.keys(config?.environments ?? {});
  return `Unknown environment ${environmentName}. Known environments: ${knownEnvironments.length > 0 ? knownEnvironments.join(", ") : "(none)"}.`;
}

function normalizeHostname(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\.+$/, "");
}

function certificatePatternMatchesHost(pattern, hostname) {
  const normalizedPattern = normalizeHostname(pattern);
  const normalizedHostname = normalizeHostname(hostname);

  if (!normalizedPattern || !normalizedHostname) {
    return false;
  }

  if (!normalizedPattern.includes("*")) {
    return normalizedPattern === normalizedHostname;
  }

  const patternLabels = normalizedPattern.split(".");
  const hostnameLabels = normalizedHostname.split(".");

  if (patternLabels[0] !== "*" || patternLabels.slice(1).some((label) => label.includes("*"))) {
    return false;
  }

  if (patternLabels.length !== hostnameLabels.length) {
    return false;
  }

  return patternLabels.slice(1).join(".") === hostnameLabels.slice(1).join(".");
}

function findUncoveredCertificateHosts(hostnames, certificateDomains) {
  const normalizedCertificateDomains = [...new Set(
    certificateDomains
      .map((value) => normalizeHostname(value))
      .filter(Boolean)
  )];

  return [...new Set(
    hostnames
      .map((value) => normalizeHostname(value))
      .filter(Boolean)
      .filter((hostname) => !normalizedCertificateDomains.some((pattern) => certificatePatternMatchesHost(pattern, hostname)))
  )].sort();
}

function collectEnvironmentCloudFrontAliases(config, environmentName) {
  const runtimeConfig = buildEnvironmentRuntimeConfig(config, environmentName);
  const aliases = [];

  for (const variantConfig of Object.values(runtimeConfig.variants)) {
    for (const languageConfig of Object.values(variantConfig.languages)) {
      aliases.push(...(languageConfig.cloudFrontAliases ?? []));
    }
  }

  return [...new Set(aliases.map((value) => normalizeHostname(value)).filter(Boolean))].sort();
}

async function describeAcmCertificate({ certificateArn, profile, cwd, runAwsCliFn }) {
  const response = await runAwsCliFn(["acm", "describe-certificate", "--certificate-arn", certificateArn, "--output", "json"], {
    region: "us-east-1",
    profile,
    cwd,
    errorCode: "AWS_AUTH_ERROR"
  });
  return JSON.parse(response.stdout || "{}").Certificate ?? {};
}

function assertKnownEnvironment(config, environmentName) {
  if (!environmentName) {
    return;
  }

  if (!config?.environments?.[environmentName]) {
    throw new S3teError("CONFIG_CONFLICT_ERROR", unknownEnvironmentMessage(config, environmentName));
  }
}

function normalizeBaseUrl(value) {
  const trimmed = String(value).trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).host;
    } catch {
      // fall back to lightweight normalization below
    }
  }

  return trimmed
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")[0];
}

function schemaTemplate() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "S3TemplateEngine Project Config",
    type: "object",
    additionalProperties: false,
    required: ["project", "environments", "variants"],
    properties: {
      $schema: { type: "string" },
      configVersion: { type: "integer", minimum: 1 },
      project: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: {
            type: "string",
            pattern: "^[a-z0-9-]+$"
          },
          displayName: { type: "string" }
        }
      },
      environments: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          required: ["awsRegion", "certificateArn"],
          properties: {
            awsRegion: { type: "string" },
            stackPrefix: { type: "string" },
            certificateArn: { type: "string" },
            route53HostedZoneId: { type: "string" }
          }
        }
      },
      rendering: {
        type: "object",
        additionalProperties: false,
        properties: {
          minifyHtml: { type: "boolean" },
          renderExtensions: {
            type: "array",
            items: { type: "string" }
          },
          outputDir: { type: "string" },
          maxRenderDepth: {
            type: "integer",
            minimum: 1
          }
        }
      },
      variants: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          required: ["defaultLanguage", "languages"],
          properties: {
            sourceDir: { type: "string" },
            partDir: { type: "string" },
            defaultLanguage: { type: "string" },
            routing: {
              type: "object",
              additionalProperties: false,
              properties: {
                indexDocument: { type: "string" },
                notFoundDocument: { type: "string" }
              }
            },
            languages: {
              type: "object",
              additionalProperties: {
                type: "object",
                additionalProperties: false,
                required: ["baseUrl", "cloudFrontAliases"],
                properties: {
                  baseUrl: { type: "string" },
                  targetBucket: { type: "string" },
                  cloudFrontAliases: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 1
                  },
                  webinyLocale: { type: "string" }
                }
              }
            }
          }
        }
      },
      aws: {
        type: "object",
        additionalProperties: false,
        properties: {
          codeBuckets: {
            type: "object",
            additionalProperties: { type: "string" }
          },
          dependencyStore: {
            type: "object",
            additionalProperties: false,
            properties: {
              tableName: { type: "string" }
            }
          },
          contentStore: {
            type: "object",
            additionalProperties: false,
            properties: {
              tableName: { type: "string" },
              contentIdIndexName: { type: "string" }
            }
          },
          invalidationStore: {
            type: "object",
            additionalProperties: false,
            properties: {
              tableName: { type: "string" },
              debounceSeconds: {
                type: "integer",
                minimum: 0
              }
            }
          },
          lambda: {
            type: "object",
            additionalProperties: false,
            properties: {
              runtime: {
                type: "string",
                enum: ["nodejs24.x"]
              },
              architecture: {
                type: "string",
                enum: ["arm64", "x86_64"]
              }
            }
          }
        }
      },
      integrations: {
        type: "object",
        additionalProperties: false,
        properties: {
          webiny: {
            type: "object",
            additionalProperties: false,
            properties: {
              enabled: { type: "boolean" },
              sourceTableName: { type: "string" },
              mirrorTableName: { type: "string" },
              tenant: { type: "string" },
              relevantModels: {
                type: "array",
                items: { type: "string" }
              },
              environments: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean" },
                    sourceTableName: { type: "string" },
                    mirrorTableName: { type: "string" },
                    tenant: { type: "string" },
                    relevantModels: {
                      type: "array",
                      items: { type: "string" }
                    }
                  }
                }
              }
            }
          },
          sitemap: {
            type: "object",
            additionalProperties: false,
            properties: {
              enabled: { type: "boolean" },
              environments: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean" }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function githubSyncWorkflowTemplate() {
  return `# Required GitHub repository secrets:
# - AWS_ACCESS_KEY_ID
# - AWS_SECRET_ACCESS_KEY
# Required GitHub repository variable for push-based sync in multi-environment projects:
# - S3TE_ENVIRONMENT (for example dev, test, or prod)
# Optional GitHub repository variable:
# - S3TE_GIT_BRANCH (defaults to main)
# Notes:
# - workflow_dispatch can override the environment manually
# - if s3te.config.json contains exactly one environment, no S3TE_ENVIRONMENT variable is needed
# This workflow reads s3te.config.json at runtime and syncs all variants into their own code buckets.
name: S3TE Sync

on:
  workflow_dispatch:
    inputs:
      environment:
        description: Optional S3TE environment override from s3te.config.json
        required: false
        type: string
  push:
    paths:
      - "app/**"
      - "package.json"
      - "package-lock.json"
      - ".github/workflows/s3te-sync.yml"

jobs:
  sync:
    if: github.event_name == 'workflow_dispatch' || github.ref_name == (vars.S3TE_GIT_BRANCH || 'main')
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Install dependencies
        shell: bash
        run: |
          if [ -f package-lock.json ]; then
            npm ci
          else
            npm install
          fi
      - name: Resolve S3TE environment and AWS region from s3te.config.json
        id: s3te-config
        shell: bash
        env:
          WORKFLOW_INPUT_ENVIRONMENT: \${{ inputs.environment }}
          REPOSITORY_S3TE_ENVIRONMENT: \${{ vars.S3TE_ENVIRONMENT }}
        run: |
          node -e "const fs=require('node:fs'); const fromInput=(process.env.WORKFLOW_INPUT_ENVIRONMENT || '').trim(); const fromVariable=(process.env.REPOSITORY_S3TE_ENVIRONMENT || '').trim(); const config=JSON.parse(fs.readFileSync('s3te.config.json','utf8')); const known=Object.keys(config.environments ?? {}); const requested=(fromInput || fromVariable || (known.length === 1 ? known[0] : '')).trim(); if(!requested){ console.error('Missing S3TE environment. Provide workflow_dispatch input \"environment\" or set GitHub repository variable S3TE_ENVIRONMENT. Known environments: ' + (known.length > 0 ? known.join(', ') : '(none)') + '.'); process.exit(1);} const environmentConfig=config.environments?.[requested]; if(!environmentConfig){ console.error('Unknown environment ' + requested + '. Known environments: ' + (known.length > 0 ? known.join(', ') : '(none)') + '.'); process.exit(1);} fs.appendFileSync(process.env.GITHUB_OUTPUT, 'environment=' + requested + '\\n'); fs.appendFileSync(process.env.GITHUB_OUTPUT, 'aws_region=' + environmentConfig.awsRegion + '\\n');"
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: \${{ steps.s3te-config.outputs.aws_region }}
      - name: Validate project
        run: npx s3te validate --env \${{ steps.s3te-config.outputs.environment }}
      - name: Sync project sources to the S3TE code buckets
        run: npx s3te sync --env \${{ steps.s3te-config.outputs.environment }}
`;
}

async function fileExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function writeProjectFile(targetPath, body, force = false, overwriteExisting = false) {
  if (!force && !overwriteExisting && await fileExists(targetPath)) {
    return;
  }
  await writeTextFile(targetPath, body);
}

function mergeDefaults(existingValue, defaultValue) {
  if (existingValue === undefined) {
    return defaultValue;
  }

  if (isPlainObject(defaultValue)) {
    if (!isPlainObject(existingValue)) {
      throw new Error("Existing JSON content must use an object where S3TE expects one.");
    }

    const mergedValue = { ...existingValue };
    for (const [key, value] of Object.entries(defaultValue)) {
      mergedValue[key] = mergeDefaults(existingValue[key], value);
    }
    return mergedValue;
  }

  return existingValue;
}

function mergeProjectPackageJson(existingPackageJson, projectPackageJson, scaffoldOptions = {}) {
  if (!isPlainObject(existingPackageJson)) {
    throw new Error("Existing package.json must contain a JSON object.");
  }

  if (existingPackageJson.scripts !== undefined && !isPlainObject(existingPackageJson.scripts)) {
    throw new Error("Existing package.json must use an object for scripts.");
  }

  const mergedPackageJson = { ...existingPackageJson };
  for (const [key, value] of Object.entries(projectPackageJson)) {
    if (key === "scripts") {
      continue;
    }

    if (mergedPackageJson[key] === undefined) {
      mergedPackageJson[key] = value;
    }
  }

  const mergedScripts = { ...(mergedPackageJson.scripts ?? {}) };
  for (const [name, command] of Object.entries(projectPackageJson.scripts ?? {})) {
    if (mergedScripts[name] === undefined) {
      mergedScripts[name] = command;
    }
  }

  if (Object.keys(mergedScripts).length > 0) {
    mergedPackageJson.scripts = mergedScripts;
  }

  if (scaffoldOptions.projectNameProvided) {
    mergedPackageJson.name = scaffoldOptions.projectName;
  }

  return mergedPackageJson;
}

async function writeProjectPackageJson(targetPath, projectPackageJson, scaffoldOptions = {}, force = false) {
  if (force || !await fileExists(targetPath)) {
    await writeTextFile(targetPath, JSON.stringify(projectPackageJson, null, 2) + "\n");
    return;
  }

  let existingPackageJson;
  try {
    existingPackageJson = JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    throw new Error(`Existing package.json is not valid JSON: ${targetPath}`, { cause: error });
  }

  const mergedPackageJson = mergeProjectPackageJson(existingPackageJson, projectPackageJson, scaffoldOptions);
  await writeTextFile(targetPath, JSON.stringify(mergedPackageJson, null, 2) + "\n");
}

function applyScaffoldConfigOverrides(config, scaffoldOptions = {}) {
  if (scaffoldOptions.projectNameProvided) {
    config.project.name = scaffoldOptions.projectName;
  }

  const variantConfig = config.variants?.[scaffoldOptions.variant];
  const languageConfig = variantConfig?.languages?.[scaffoldOptions.language];
  if (!variantConfig || !languageConfig) {
    return config;
  }

  if (scaffoldOptions.languageProvided) {
    variantConfig.defaultLanguage = scaffoldOptions.language;
  }

  if (languageConfig.webinyLocale === undefined) {
    languageConfig.webinyLocale = scaffoldOptions.language;
  }

  if (scaffoldOptions.baseUrlProvided) {
    const previousBaseUrl = languageConfig.baseUrl;
    languageConfig.baseUrl = scaffoldOptions.baseUrl;
    if (!Array.isArray(languageConfig.cloudFrontAliases)
      || languageConfig.cloudFrontAliases.length === 0
      || (languageConfig.cloudFrontAliases.length === 1 && languageConfig.cloudFrontAliases[0] === previousBaseUrl)) {
      languageConfig.cloudFrontAliases = [scaffoldOptions.baseUrl];
    }
  }

  return config;
}

async function writeProjectConfigJson(targetPath, projectConfig, scaffoldOptions = {}, force = false) {
  if (force || !await fileExists(targetPath)) {
    await writeTextFile(targetPath, JSON.stringify(projectConfig, null, 2) + "\n");
    return;
  }

  let existingConfig;
  try {
    existingConfig = JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    throw new Error(`Existing s3te.config.json is not valid JSON: ${targetPath}`, { cause: error });
  }

  if (!isPlainObject(existingConfig)) {
    throw new Error("Existing s3te.config.json must contain a JSON object.");
  }

  const mergedConfig = applyScaffoldConfigOverrides(mergeDefaults(existingConfig, projectConfig), scaffoldOptions);
  await writeTextFile(targetPath, JSON.stringify(mergedConfig, null, 2) + "\n");
}

async function loadRenderState(projectDir, environment) {
  const statePath = path.join(projectDir, "offline", "S3TELocal", "render-state", `${environment}.json`);
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return { statePath, state: JSON.parse(raw) };
  } catch {
    return { statePath, state: { templates: {} } };
  }
}

async function saveRenderState(statePath, state) {
  await writeTextFile(statePath, JSON.stringify(state, null, 2) + "\n");
}

function renderStateKey(target) {
  return `${target.variant}#${target.language}#${target.sourceKey}`;
}

function normalizeStringList(values) {
  return [...new Set((values ?? [])
    .map((value) => String(value).trim())
    .filter(Boolean))];
}

function normalizeLocale(value) {
  return value == null ? "" : String(value).trim().toLowerCase();
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

function buildContentIdentityKey(item) {
  return [
    item.contentId ?? item.id ?? "",
    item.model ?? "",
    item.tenant ?? "",
    normalizeLocale(item.locale)
  ].join("#");
}

function compareDownloadedContentOrder(left, right) {
  return String(left.contentId ?? left.id ?? "").localeCompare(String(right.contentId ?? right.id ?? ""))
    || normalizeLocale(left.locale).localeCompare(normalizeLocale(right.locale))
    || String(left.model ?? "").localeCompare(String(right.model ?? ""))
    || String(left.tenant ?? "").localeCompare(String(right.tenant ?? ""))
    || compareContentFreshness(left, right);
}

function deduplicateContentItems(items) {
  const latestItems = new Map();

  for (const item of items ?? []) {
    const identityKey = buildContentIdentityKey(item);
    const current = latestItems.get(identityKey);
    if (!current || compareContentFreshness(item, current) < 0) {
      latestItems.set(identityKey, item);
    }
  }

  return [...latestItems.values()].sort(compareDownloadedContentOrder);
}

async function scanRemoteContentTable({ tableName, region, profile }) {
  const previousProfile = process.env.AWS_PROFILE;
  if (profile) {
    process.env.AWS_PROFILE = profile;
  }

  const baseClient = new DynamoDBClient({ region });
  const documentClient = DynamoDBDocumentClient.from(baseClient);
  const items = [];
  let lastEvaluatedKey;

  try {
    do {
      const response = await documentClient.send(new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      items.push(...(response.Items ?? []));
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
  } catch (error) {
    throw new S3teError("AWS_AUTH_ERROR", `Unable to download content from DynamoDB table ${tableName}.`, {
      tableName,
      region,
      cause: error.message
    });
  } finally {
    baseClient.destroy();
    if (profile) {
      if (previousProfile === undefined) {
        delete process.env.AWS_PROFILE;
      } else {
        process.env.AWS_PROFILE = previousProfile;
      }
    }
  }
}

export async function loadResolvedConfig(projectDir, configPath) {
  const rawConfig = await loadProjectConfig(configPath);
  const result = await validateAndResolveProjectConfig(rawConfig, { projectDir });
  return { rawConfig, ...result };
}

export async function validateProject(projectDir, config, options = {}) {
  if (options.environment && !config?.environments?.[options.environment]) {
    return {
      ok: false,
      errors: [{
        code: "CONFIG_CONFLICT_ERROR",
        message: unknownEnvironmentMessage(config, options.environment)
      }],
      warnings: [],
      checkedTemplates: []
    };
  }

  const templateRepository = new FileSystemTemplateRepository(projectDir, config);
  const contentRepository = await loadLocalContent(projectDir, config);
  const warnings = [];
  const errors = [];
  const checkedTemplates = [];
  const environments = options.environment ? [options.environment] : Object.keys(config.environments);

  for (const environment of environments) {
    for (const [variantName, variantConfig] of Object.entries(config.variants)) {
      const entries = await templateRepository.listVariantEntries(variantName);
      for (const entry of entries) {
        if (!isRenderableKey(config, entry.key)) {
          continue;
        }

        for (const languageCode of Object.keys(variantConfig.languages)) {
          try {
            const results = await renderSourceTemplate({
              config,
              templateRepository,
              contentRepository,
              environment,
              variantName,
              languageCode,
              sourceKey: entry.key
            });
            warnings.push(...results.flatMap((result) => result.warnings));
            checkedTemplates.push(`${environment}:${variantName}:${languageCode}:${entry.key}`);
          } catch (error) {
            errors.push({
              code: error.code ?? "TEMPLATE_SYNTAX_ERROR",
              message: error.message,
              details: error.details
            });
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checkedTemplates
  };
}

export async function scaffoldProject(projectDir, options = {}) {
  const projectName = options.projectName ?? path.basename(projectDir).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "example.com");
  const variant = options.variant ?? "website";
  const language = options.language ?? "en";
  const force = Boolean(options.force);
  const scaffoldOptions = {
    projectName,
    projectNameProvided: options.projectName !== undefined,
    baseUrl,
    baseUrlProvided: options.baseUrl !== undefined,
    variant,
    variantProvided: options.variant !== undefined,
    language,
    languageProvided: options.language !== undefined
  };

  await ensureDirectory(path.join(projectDir, "app", "part"));
  await ensureDirectory(path.join(projectDir, "app", variant));
  await ensureDirectory(path.join(projectDir, "offline", "tests"));
  await ensureDirectory(path.join(projectDir, "offline", "content"));
  await ensureDirectory(path.join(projectDir, "offline", "schemas"));
  await ensureDirectory(path.join(projectDir, ".github", "workflows"));
  await ensureDirectory(path.join(projectDir, ".vscode"));

  const projectPackageJson = {
    name: projectName,
    private: true,
    type: "module",
    scripts: {
      validate: "s3te validate",
      render: "s3te render --env dev",
      sync: "s3te sync --env dev",
      test: "s3te test"
    }
  };

  const config = {
    $schema: "./offline/schemas/s3te.config.schema.json",
    configVersion: 1,
    project: {
      name: projectName
    },
    rendering: {
      outputDir: "offline/S3TELocal/preview"
    },
    environments: {
      dev: {
        awsRegion: "eu-central-1",
        stackPrefix: "DEV",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/replace-me"
      }
    },
    variants: {
      [variant]: {
        sourceDir: `app/${variant}`,
        partDir: "app/part",
        defaultLanguage: language,
        languages: {
          [language]: {
            baseUrl,
            cloudFrontAliases: [baseUrl],
            webinyLocale: language
          }
        }
      }
    }
  };

  await writeProjectPackageJson(path.join(projectDir, "package.json"), projectPackageJson, scaffoldOptions, force);
  await writeProjectConfigJson(path.join(projectDir, "s3te.config.json"), config, scaffoldOptions, force);
  await writeProjectFile(path.join(projectDir, "offline", "schemas", "s3te.config.schema.json"), JSON.stringify(schemaTemplate(), null, 2) + "\n", force, true);
  await writeProjectFile(path.join(projectDir, ".github", "workflows", "s3te-sync.yml"), githubSyncWorkflowTemplate(), force);
  await writeProjectFile(path.join(projectDir, "app", "part", "head.part"), "<meta charset='utf-8'>\n<title>My S3TE Site</title>\n", force);
  await writeProjectFile(path.join(projectDir, "app", variant, "index.html"), "<!doctype html>\n<html lang=\"<lang>2</lang>\">\n  <head>\n    <part>head.part</part>\n  </head>\n  <body>\n    <h1>Hello from S3TemplateEngine</h1>\n  </body>\n</html>\n", force);
  await writeProjectFile(path.join(projectDir, "offline", "content", `${language}.json`), "[]\n", force);
  await writeProjectFile(path.join(projectDir, ".vscode", "extensions.json"), JSON.stringify({
    recommendations: [
      "redhat.vscode-yaml",
      "amazonwebservices.aws-toolkit-vscode"
    ]
  }, null, 2) + "\n", force);
  await writeProjectFile(path.join(projectDir, "offline", "tests", "project.test.mjs"), "import test from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('placeholder project test', () => {\n  assert.equal(1, 1);\n});\n", force);

  return { projectName, variant, language };
}

export async function renderProject(projectDir, config, options = {}) {
  assertKnownEnvironment(config, options.environment);
  const templateRepository = new FileSystemTemplateRepository(projectDir, config);
  const contentRepository = await loadLocalContent(projectDir, config);
  const outputRoot = path.join(projectDir, options.outputDir ?? config.rendering.outputDir);
  const templateEntries = [];

  for (const variantName of Object.keys(config.variants)) {
    templateEntries.push(...await templateRepository.listVariantEntries(variantName));
  }

  const targets = createManualRenderTargets({
    config,
    templateEntries,
    environment: options.environment,
    variant: options.variant,
    language: options.language,
    entry: options.entry
  });

  const { statePath, state } = await loadRenderState(projectDir, options.environment);
  if (!options.entry) {
    await removeDirectory(path.join(outputRoot, options.environment));
    state.templates = {};
  }

  const renderedArtifacts = [];
  const deletedArtifacts = [];
  const warnings = [];

  for (const target of targets) {
    const results = await renderSourceTemplate({
      config,
      templateRepository,
      contentRepository,
      environment: target.environment,
      variantName: target.variant,
      languageCode: target.language,
      sourceKey: target.sourceKey
    });

    const renderedOutputKeys = new Set();
    for (const result of results) {
      warnings.push(...result.warnings);
      const targetPath = path.join(outputRoot, target.environment, target.variant, target.language, result.artifact.outputKey);
      await writeTextFile(targetPath, String(result.artifact.body));
      renderedArtifacts.push(normalizePath(path.relative(projectDir, targetPath)));
      renderedOutputKeys.add(result.artifact.outputKey);
    }

    const stateKey = renderStateKey(target);
    const previousOutputs = state.templates[stateKey] ?? [];
    for (const previousOutput of previousOutputs) {
      if (renderedOutputKeys.has(previousOutput)) {
        continue;
      }
      const previousPath = path.join(outputRoot, target.environment, target.variant, target.language, previousOutput);
      await fs.rm(previousPath, { force: true });
      deletedArtifacts.push(normalizePath(path.relative(projectDir, previousPath)));
    }
    state.templates[stateKey] = [...renderedOutputKeys].sort();
  }

  for (const variantName of options.variant ? [options.variant] : Object.keys(config.variants)) {
    const variantConfig = config.variants[variantName];
    const variantEntries = await templateRepository.listVariantEntries(variantName);
    for (const entry of variantEntries) {
      if (isRenderableKey(config, entry.key)) {
        continue;
      }

      const suffix = entry.key.slice(variantName.length + 1);
      const sourcePath = path.join(projectDir, variantConfig.sourceDir, suffix);
      for (const languageCode of options.language ? [options.language] : Object.keys(variantConfig.languages)) {
        const targetPath = path.join(outputRoot, options.environment, variantName, languageCode, suffix);
        await copyFile(sourcePath, targetPath);
        renderedArtifacts.push(normalizePath(path.relative(projectDir, targetPath)));
      }
    }
  }

  await saveRenderState(statePath, state);

  return {
    outputDir: normalizePath(path.relative(projectDir, outputRoot)),
    renderedArtifacts,
    deletedArtifacts,
    warnings
  };
}

export async function runProjectTests(projectDir) {
  const testsDir = await fileExists(path.join(projectDir, "offline", "tests"))
    ? "offline/tests"
    : "tests";
  const testFiles = await listProjectTestFiles(path.join(projectDir, testsDir));
  const testArgs = testFiles.length > 0
    ? testFiles.map((relativePath) => normalizePath(path.join(testsDir, relativePath)))
    : [testsDir];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", ...testArgs], {
      cwd: projectDir,
      stdio: "inherit"
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

export async function downloadProjectContent(projectDir, config, options = {}) {
  assertKnownEnvironment(config, options.environment);
  const runtimeConfig = buildEnvironmentRuntimeConfig(config, options.environment);
  const tableName = runtimeConfig.tables.content;
  const region = runtimeConfig.awsRegion;
  const outputPath = path.resolve(projectDir, options.out ?? path.join("offline", "content", "items.json"));
  const scanContentItemsFn = options.scanContentItemsFn ?? scanRemoteContentTable;

  const remoteItems = await scanContentItemsFn({
    tableName,
    region,
    profile: options.profile
  });
  const items = deduplicateContentItems(remoteItems);

  await writeTextFile(outputPath, JSON.stringify(items, null, 2) + "\n");

  return {
    environment: options.environment,
    region,
    tableName,
    outputPath: normalizePath(path.relative(projectDir, outputPath)),
    downloadedItems: remoteItems.length,
    writtenItems: items.length,
    deduplicatedItems: Math.max(0, remoteItems.length - items.length)
  };
}

export async function packageProject(projectDir, config, options = {}) {
  assertKnownEnvironment(config, options.environment);
  return packageAwsProject({
    projectDir,
    config,
    environment: options.environment,
    outDir: options.outDir,
    clean: Boolean(options.clean),
    features: options.features ?? []
  });
}

export async function deployProject(projectDir, config, options = {}) {
  assertKnownEnvironment(config, options.environment);
  return deployAwsProject({
    projectDir,
    config,
    environment: options.environment,
    packageDir: options.packageDir,
    features: options.features ?? [],
    profile: options.profile,
    plan: Boolean(options.plan),
    noSync: Boolean(options.noSync),
    stdio: options.stdio ?? "pipe"
  });
}

export async function syncProject(projectDir, config, options = {}) {
  assertKnownEnvironment(config, options.environment);
  return syncAwsProject({
    projectDir,
    config,
    environment: options.environment,
    outDir: options.outDir,
    profile: options.profile,
    stdio: options.stdio ?? "pipe"
  });
}

export async function doctorProject(projectDir, configPath, options = {}) {
  const ensureAwsCliAvailableFn = options.ensureAwsCliAvailableFn ?? ensureAwsCliAvailable;
  const ensureAwsCredentialsFn = options.ensureAwsCredentialsFn ?? ensureAwsCredentials;
  const runAwsCliFn = options.runAwsCliFn ?? runAwsCli;
  const checks = [];
  const majorVersion = Number(process.versions.node.split(".")[0]);

  checks.push({
    name: "node",
    ok: majorVersion >= 20,
    message: `Node version ${process.versions.node}`
  });

  try {
    await fs.stat(configPath);
    checks.push({ name: "config", ok: true, message: "s3te.config.json found" });
  } catch {
    checks.push({ name: "config", ok: false, message: "s3te.config.json missing" });
  }

  try {
    await fs.access(projectDir, fs.constants.W_OK);
    checks.push({ name: "write", ok: true, message: "Project is writable" });
  } catch {
    checks.push({ name: "write", ok: false, message: "Project is not writable" });
  }

  try {
    await ensureAwsCliAvailableFn({ cwd: projectDir });
    checks.push({ name: "aws-cli", ok: true, message: "AWS CLI available" });
  } catch (error) {
    checks.push({ name: "aws-cli", ok: false, message: error.message });
  }

  if (options.environment && options.config) {
    if (!options.config.environments?.[options.environment]) {
      checks.push({
        name: "environment",
        ok: false,
        message: unknownEnvironmentMessage(options.config, options.environment)
      });
      return checks;
    }

    try {
      await ensureAwsCredentialsFn({
        region: options.config.environments[options.environment].awsRegion,
        profile: options.profile,
        cwd: projectDir
      });
      checks.push({ name: "aws-auth", ok: true, message: `AWS credentials valid for ${options.environment}` });
    } catch (error) {
      checks.push({ name: "aws-auth", ok: false, message: error.message });
    }

    const environmentConfig = options.config.environments[options.environment];
    const awsAuthCheck = checks.at(-1);
    if (awsAuthCheck?.name === "aws-auth" && awsAuthCheck.ok) {
      try {
        const cloudFrontAliases = collectEnvironmentCloudFrontAliases(options.config, options.environment);
        const certificate = await describeAcmCertificate({
          certificateArn: environmentConfig.certificateArn,
          profile: options.profile,
          cwd: projectDir,
          runAwsCliFn
        });
        const certificateDomains = [
          certificate.DomainName,
          ...(certificate.SubjectAlternativeNames ?? [])
        ];
        const uncoveredAliases = findUncoveredCertificateHosts(cloudFrontAliases, certificateDomains);
        checks.push({
          name: "acm-certificate",
          ok: uncoveredAliases.length === 0,
          message: uncoveredAliases.length === 0
            ? `ACM certificate covers ${cloudFrontAliases.length} CloudFront alias(es) for ${options.environment}`
            : `ACM certificate ${environmentConfig.certificateArn} does not cover these CloudFront aliases for ${options.environment}: ${uncoveredAliases.join(", ")}.`
        });
      } catch (error) {
        checks.push({
          name: "acm-certificate",
          ok: false,
          message: `Could not inspect ACM certificate ${environmentConfig.certificateArn}: ${error.message}`
        });
      }
    }
  }

  return checks;
}

export async function configureProjectOption(configPath, rawConfig, optionConfiguration) {
  const options = typeof optionConfiguration === "object" && optionConfiguration !== null
    ? optionConfiguration
    : { writeChanges: optionConfiguration };
  const optionName = String(options.optionName ?? "").trim().toLowerCase();
  const targetEnvironment = options.environment ? String(options.environment).trim() : "";
  const nextConfig = {
    ...rawConfig,
    configVersion: rawConfig.configVersion ?? 1
  };
  const changes = [];

  if (!optionName) {
    throw new S3teError("CONFIG_CONFLICT_ERROR", "option requires an optionName such as webiny or sitemap.");
  }
  if (!["webiny", "sitemap"].includes(optionName)) {
    throw new S3teError("CONFIG_CONFLICT_ERROR", `Unknown option ${optionName}. Supported options: webiny, sitemap.`);
  }
  if (targetEnvironment && !nextConfig.environments?.[targetEnvironment]) {
    throw new S3teError("CONFIG_CONFLICT_ERROR", `Unknown environment for option ${optionName}: ${targetEnvironment}.`);
  }

  const enable = Boolean(options.enable);
  const disable = Boolean(options.disable);
  if (enable && disable) {
    throw new S3teError("CONFIG_CONFLICT_ERROR", `option ${optionName} does not allow --enable and --disable at the same time.`);
  }

  if (optionName === "webiny") {
    const webinySourceTable = options.sourceTable ? String(options.sourceTable).trim() : "";
    const webinyTenant = options.tenant ? String(options.tenant).trim() : "";
    const webinyModels = normalizeStringList(options.models);
    const touchesWebiny = enable || disable || Boolean(webinySourceTable) || Boolean(webinyTenant) || webinyModels.length > 0;

    if (touchesWebiny) {
      const existingIntegrations = nextConfig.integrations ?? {};
      const existingWebiny = existingIntegrations.webiny ?? {};
      const existingEnvironmentOverrides = existingWebiny.environments ?? {};
      const existingTargetWebiny = targetEnvironment
        ? (existingEnvironmentOverrides[targetEnvironment] ?? {})
        : existingWebiny;
      const inheritedModels = normalizeStringList(
        existingTargetWebiny.relevantModels
        ?? (targetEnvironment ? existingWebiny.relevantModels : undefined)
        ?? ["staticContent", "staticCodeContent"]
      );
      const shouldEnableWebiny = disable
        ? false
        : (enable || Boolean(webinySourceTable) || webinyModels.length > 0
            ? true
            : Boolean(targetEnvironment
                ? (existingTargetWebiny.enabled ?? existingWebiny.enabled)
                : existingWebiny.enabled));
      const nextSourceTableName = webinySourceTable
        || existingTargetWebiny.sourceTableName
        || (targetEnvironment ? existingWebiny.sourceTableName : "")
        || "";

      if (shouldEnableWebiny && !nextSourceTableName) {
        throw new S3teError(
          "CONFIG_CONFLICT_ERROR",
          targetEnvironment
            ? `Enabling Webiny for environment ${targetEnvironment} requires --source-table <table> or an existing sourceTableName.`
            : "Enabling Webiny requires --source-table <table> or an existing integrations.webiny.sourceTableName."
        );
      }

      const nextWebinyConfig = {
        enabled: shouldEnableWebiny,
        sourceTableName: nextSourceTableName || undefined,
        mirrorTableName: existingTargetWebiny.mirrorTableName
          ?? (targetEnvironment ? existingWebiny.mirrorTableName : undefined)
          ?? "{stackPrefix}_s3te_content_{project}",
        tenant: webinyTenant || existingTargetWebiny.tenant || (targetEnvironment ? existingWebiny.tenant : undefined) || undefined,
        relevantModels: normalizeStringList([
          ...(inheritedModels.length > 0 ? inheritedModels : ["staticContent", "staticCodeContent"]),
          ...webinyModels
        ])
      };

      nextConfig.integrations = {
        ...existingIntegrations,
        webiny: targetEnvironment
          ? {
              ...existingWebiny,
              environments: {
                ...existingEnvironmentOverrides,
                [targetEnvironment]: nextWebinyConfig
              }
            }
          : {
              ...existingWebiny,
              ...nextWebinyConfig,
              ...(Object.keys(existingEnvironmentOverrides).length > 0
                ? { environments: existingEnvironmentOverrides }
                : {})
            }
      };

      const scopeLabel = targetEnvironment ? ` for environment ${targetEnvironment}` : "";
      changes.push(shouldEnableWebiny ? `Enabled Webiny option${scopeLabel}.` : `Disabled Webiny option${scopeLabel}.`);
      if (webinySourceTable) {
        changes.push(`Set Webiny source table${scopeLabel} to ${webinySourceTable}.`);
      }
      if (webinyTenant) {
        changes.push(`Set Webiny tenant${scopeLabel} to ${webinyTenant}.`);
      }
      if (webinyModels.length > 0) {
        changes.push(`Added Webiny models${scopeLabel}: ${webinyModels.join(", ")}.`);
      }
    }
  }

  if (optionName === "sitemap") {
    const existingIntegrations = nextConfig.integrations ?? {};
    const existingSitemap = existingIntegrations.sitemap ?? {};
    const existingEnvironmentOverrides = existingSitemap.environments ?? {};
    const existingTargetSitemap = targetEnvironment
      ? (existingEnvironmentOverrides[targetEnvironment] ?? {})
      : existingSitemap;
    const nextEnabled = disable
      ? false
      : (enable || Boolean(targetEnvironment
          ? (existingTargetSitemap.enabled ?? existingSitemap.enabled)
          : existingSitemap.enabled));

    nextConfig.integrations = {
      ...existingIntegrations,
      sitemap: targetEnvironment
        ? {
            ...existingSitemap,
            environments: {
              ...existingEnvironmentOverrides,
              [targetEnvironment]: {
                ...existingTargetSitemap,
                enabled: nextEnabled
              }
            }
          }
        : {
            ...existingSitemap,
            enabled: nextEnabled,
            ...(Object.keys(existingEnvironmentOverrides).length > 0
              ? { environments: existingEnvironmentOverrides }
              : {})
          }
    };

    const scopeLabel = targetEnvironment ? ` for environment ${targetEnvironment}` : "";
    changes.push(nextEnabled ? `Enabled sitemap option${scopeLabel}.` : `Disabled sitemap option${scopeLabel}.`);
  }

  if (options.writeChanges) {
    await writeTextFile(configPath, JSON.stringify(nextConfig, null, 2) + "\n");
  }

  return {
    config: nextConfig,
    changes
  };
}
