import fs from "node:fs/promises";
import path from "node:path";

import { assert, S3teError } from "./errors.mjs";

const KNOWN_PLACEHOLDERS = new Set(["env", "envPrefix", "stackPrefix", "project", "variant", "lang"]);

function upperSnakeCase(value) {
  return value.replace(/-/g, "_").toUpperCase();
}

function findPlaceholders(input) {
  return [...String(input).matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

function ensureKnownPlaceholders(input, fieldPath, errors) {
  for (const token of findPlaceholders(input)) {
    if (KNOWN_PLACEHOLDERS.has(token)) {
      continue;
    }

    errors.push({
      code: "CONFIG_PLACEHOLDER_ERROR",
      message: `Unknown placeholder {${token}} in ${fieldPath}.`,
      details: { fieldPath, token }
    });
  }
}

function replacePlaceholders(input, values) {
  return String(input).replace(/\{(env|envPrefix|stackPrefix|project|variant|lang)\}/g, (_, token) => values[token]);
}

function normalizeRelativeProjectPath(relativePath) {
  const normalized = String(relativePath).replace(/\\/g, "/");
  assert(!path.isAbsolute(normalized), "CONFIG_PATH_ERROR", "Absolute project paths are not allowed.", { relativePath });
  assert(!normalized.split("/").includes(".."), "CONFIG_PATH_ERROR", "Parent traversal is not allowed in project paths.", { relativePath });
  return normalized;
}

function isValidProjectName(name) {
  return /^[a-z0-9-]+$/.test(name);
}

function isValidUpperSnake(value) {
  return /^[A-Z0-9_]+$/.test(value);
}

function normalizeStringList(values, fallback = []) {
  const source = values ?? fallback;
  const items = Array.isArray(source) ? source : [source];
  return [...new Set(items
    .map((value) => String(value).trim())
    .filter(Boolean))];
}

function isProductionEnvironment(environmentName) {
  return String(environmentName).trim().toLowerCase() === "prod";
}

function hasProductionEnvironment(config) {
  return Object.keys(config.environments ?? {}).some((environmentName) => isProductionEnvironment(environmentName));
}

function environmentResourcePrefix(environmentName) {
  return isProductionEnvironment(environmentName) ? "" : `${environmentName}-`;
}

function environmentHostPrefix(config, environmentName) {
  if (!hasProductionEnvironment(config) || isProductionEnvironment(environmentName)) {
    return "";
  }

  return `${environmentName}.`;
}

function prefixHostForEnvironment(config, host, environmentName) {
  const prefix = environmentHostPrefix(config, environmentName);
  if (!prefix) {
    return host;
  }

  return host.startsWith(prefix) ? host : `${prefix}${host}`;
}

function isValidConfiguredHost(value) {
  const candidate = String(value).trim();
  if (!candidate || candidate.includes("://") || candidate.includes("/") || candidate.includes(":")) {
    return false;
  }

  return /^[A-Za-z0-9.-]+$/.test(candidate);
}

function defaultTargetBucketPattern({ variant, language, languageCount, isDefaultLanguage, project }) {
  if (languageCount === 1 || isDefaultLanguage) {
    return `{envPrefix}${variant}-${project}`;
  }

  return `{envPrefix}${variant}-${project}-${language}`;
}

async function ensureDirectoryExists(projectDir, relativePath, errors) {
  const targetPath = path.join(projectDir, relativePath);
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      errors.push({
        code: "CONFIG_PATH_ERROR",
        message: `Expected directory but found file: ${relativePath}`,
        details: { relativePath }
      });
    }
  } catch {
    errors.push({
      code: "CONFIG_PATH_ERROR",
      message: `Missing directory: ${relativePath}`,
      details: { relativePath }
    });
  }
}

function createPlaceholderContext(config, environmentName, variantName, languageCode) {
  const environmentConfig = config.environments[environmentName];
  const variantConfig = variantName ? config.variants[variantName] : null;
  return {
    env: environmentName,
    envPrefix: environmentResourcePrefix(environmentName),
    stackPrefix: environmentConfig.stackPrefix,
    project: config.project.name,
    variant: variantName ?? "website",
    lang: languageCode ?? variantConfig?.defaultLanguage ?? "en"
  };
}

function resolveWebinyConfigDefaults(webinyConfig = {}) {
  return {
    enabled: webinyConfig.enabled ?? false,
    sourceTableName: webinyConfig.sourceTableName,
    mirrorTableName: webinyConfig.mirrorTableName ?? "{stackPrefix}_s3te_content_{project}",
    relevantModels: normalizeStringList(webinyConfig.relevantModels, ["staticContent", "staticCodeContent"]),
    tenant: webinyConfig.tenant
  };
}

function resolveProjectWebinyConfig(projectConfig) {
  const baseConfig = resolveWebinyConfigDefaults(projectConfig.integrations?.webiny ?? {});
  const environmentConfigs = Object.fromEntries(Object.entries(projectConfig.integrations?.webiny?.environments ?? {}).map(([environmentName, webinyConfig]) => ([
    environmentName,
    {
      enabled: webinyConfig.enabled,
      sourceTableName: webinyConfig.sourceTableName,
      mirrorTableName: webinyConfig.mirrorTableName,
      relevantModels: webinyConfig.relevantModels ? normalizeStringList(webinyConfig.relevantModels) : undefined,
      tenant: webinyConfig.tenant
    }
  ])));

  return {
    ...baseConfig,
    environments: environmentConfigs
  };
}

export async function loadProjectConfig(configPath) {
  const raw = await fs.readFile(configPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new S3teError("CONFIG_SCHEMA_ERROR", "Config file is not valid JSON.", { configPath, cause: error.message });
  }
}

export function resolveProjectConfig(projectConfig) {
  const configVersion = projectConfig.configVersion ?? 1;
  const project = {
    name: projectConfig.project?.name,
    displayName: projectConfig.project?.displayName
  };

  const rendering = {
    minifyHtml: projectConfig.rendering?.minifyHtml ?? true,
    renderExtensions: projectConfig.rendering?.renderExtensions ?? [".html", ".htm", ".part"],
    outputDir: projectConfig.rendering?.outputDir ?? "offline/S3TELocal/preview",
    maxRenderDepth: projectConfig.rendering?.maxRenderDepth ?? 50
  };

  const environments = {};
  for (const [environmentName, environmentConfig] of Object.entries(projectConfig.environments ?? {})) {
    environments[environmentName] = {
      name: environmentName,
      awsRegion: environmentConfig.awsRegion,
      stackPrefix: environmentConfig.stackPrefix ?? upperSnakeCase(environmentName),
      certificateArn: environmentConfig.certificateArn,
      route53HostedZoneId: environmentConfig.route53HostedZoneId
    };
  }

  const variants = {};
  const awsCodeBuckets = { ...(projectConfig.aws?.codeBuckets ?? {}) };

  for (const [variantName, variantConfig] of Object.entries(projectConfig.variants ?? {})) {
    const languages = {};
    const languageEntries = Object.entries(variantConfig.languages ?? {});
    for (const [languageCode, languageConfig] of languageEntries) {
      languages[languageCode] = {
        code: languageCode,
        baseUrl: languageConfig.baseUrl,
        targetBucket: languageConfig.targetBucket,
        cloudFrontAliases: [...(languageConfig.cloudFrontAliases ?? [])],
        webinyLocale: languageConfig.webinyLocale ?? languageCode
      };
    }

    variants[variantName] = {
      name: variantName,
      sourceDir: normalizeRelativeProjectPath(variantConfig.sourceDir ?? `app/${variantName}`),
      partDir: normalizeRelativeProjectPath(variantConfig.partDir ?? "app/part"),
      defaultLanguage: variantConfig.defaultLanguage,
      routing: {
        indexDocument: variantConfig.routing?.indexDocument ?? "index.html",
        notFoundDocument: variantConfig.routing?.notFoundDocument ?? "404.html"
      },
      languages
    };

    awsCodeBuckets[variantName] = awsCodeBuckets[variantName] ?? "{envPrefix}{variant}-code-{project}";
  }

  const aws = {
    codeBuckets: awsCodeBuckets,
    dependencyStore: {
      tableName: projectConfig.aws?.dependencyStore?.tableName ?? "{stackPrefix}_s3te_dependencies_{project}"
    },
    contentStore: {
      tableName: projectConfig.aws?.contentStore?.tableName ?? "{stackPrefix}_s3te_content_{project}",
      contentIdIndexName: projectConfig.aws?.contentStore?.contentIdIndexName ?? "contentid"
    },
    invalidationStore: {
      tableName: projectConfig.aws?.invalidationStore?.tableName ?? "{stackPrefix}_s3te_invalidations_{project}",
      debounceSeconds: projectConfig.aws?.invalidationStore?.debounceSeconds ?? 60
    },
    lambda: {
      runtime: projectConfig.aws?.lambda?.runtime ?? "nodejs22.x",
      architecture: projectConfig.aws?.lambda?.architecture ?? "arm64"
    }
  };

  const integrations = {
    webiny: resolveProjectWebinyConfig(projectConfig)
  };

  for (const [variantName, variantConfig] of Object.entries(variants)) {
    const languageEntries = Object.values(variantConfig.languages);
    const languageCount = languageEntries.length;
    for (const languageConfig of languageEntries) {
      languageConfig.targetBucket = languageConfig.targetBucket ?? defaultTargetBucketPattern({
        variant: variantName,
        language: languageConfig.code,
        languageCount,
        isDefaultLanguage: languageConfig.code === variantConfig.defaultLanguage,
        project: project.name
      });
    }
  }

  return {
    configVersion,
    project,
    environments,
    rendering,
    variants,
    aws,
    integrations
  };
}

export function resolveCodeBucketName(config, environmentName, variantName) {
  return replacePlaceholders(
    config.aws.codeBuckets[variantName],
    createPlaceholderContext(config, environmentName, variantName)
  );
}

export function resolveTargetBucketName(config, environmentName, variantName, languageCode) {
  return replacePlaceholders(
    config.variants[variantName].languages[languageCode].targetBucket,
    createPlaceholderContext(config, environmentName, variantName, languageCode)
  );
}

export function resolveBaseUrl(config, environmentName, variantName, languageCode) {
  return prefixHostForEnvironment(
    config,
    config.variants[variantName].languages[languageCode].baseUrl,
    environmentName
  );
}

export function resolveCloudFrontAliases(config, environmentName, variantName, languageCode) {
  return config.variants[variantName].languages[languageCode].cloudFrontAliases
    .map((alias) => prefixHostForEnvironment(config, alias, environmentName));
}

export function resolveEnvironmentWebinyIntegration(config, environmentName) {
  const baseConfig = resolveWebinyConfigDefaults(config.integrations?.webiny ?? {});
  const environmentOverride = config.integrations?.webiny?.environments?.[environmentName] ?? {};

  return {
    enabled: environmentOverride.enabled ?? baseConfig.enabled,
    sourceTableName: environmentOverride.sourceTableName ?? baseConfig.sourceTableName,
    mirrorTableName: environmentOverride.mirrorTableName ?? baseConfig.mirrorTableName,
    relevantModels: environmentOverride.relevantModels
      ? normalizeStringList(environmentOverride.relevantModels)
      : [...baseConfig.relevantModels],
    tenant: environmentOverride.tenant ?? baseConfig.tenant
  };
}

export function resolveTableNames(config, environmentName) {
  const context = createPlaceholderContext(config, environmentName);
  const webinyConfig = resolveEnvironmentWebinyIntegration(config, environmentName);
  return {
    dependency: replacePlaceholders(config.aws.dependencyStore.tableName, context),
    content: replacePlaceholders(config.aws.contentStore.tableName, context),
    invalidation: replacePlaceholders(config.aws.invalidationStore.tableName, context),
    webinyMirror: replacePlaceholders(webinyConfig.mirrorTableName, context)
  };
}

export function resolveRuntimeManifestParameterName(config, environmentName) {
  const environmentConfig = config.environments[environmentName];
  return `/${environmentConfig.stackPrefix}/s3te/${config.project.name}/runtime-manifest`;
}

export function resolveStackName(config, environmentName) {
  return `${config.environments[environmentName].stackPrefix}-s3te-${config.project.name}`;
}

export function buildEnvironmentRuntimeConfig(config, environmentName, stackOutputs = {}) {
  const environmentConfig = config.environments[environmentName];
  const webinyConfig = resolveEnvironmentWebinyIntegration(config, environmentName);
  const tables = resolveTableNames(config, environmentName);
  const runtimeParameterName = resolveRuntimeManifestParameterName(config, environmentName);
  const stackName = resolveStackName(config, environmentName);
  const variants = {};

  for (const [variantName, variantConfig] of Object.entries(config.variants)) {
    const languages = {};
    for (const [languageCode, languageConfig] of Object.entries(variantConfig.languages)) {
      const targetBucket = resolveTargetBucketName(config, environmentName, variantName, languageCode);
      const baseUrl = resolveBaseUrl(config, environmentName, variantName, languageCode);
      const cloudFrontAliases = resolveCloudFrontAliases(config, environmentName, variantName, languageCode);
      languages[languageCode] = {
        code: languageCode,
        baseUrl,
        targetBucket,
        cloudFrontAliases,
        webinyLocale: languageConfig.webinyLocale,
        distributionId: stackOutputs.distributionIds?.[variantName]?.[languageCode] ?? "",
        distributionDomainName: stackOutputs.distributionDomains?.[variantName]?.[languageCode] ?? ""
      };
    }

    variants[variantName] = {
      name: variantName,
      sourceDir: variantConfig.sourceDir,
      partDir: variantConfig.partDir,
      defaultLanguage: variantConfig.defaultLanguage,
      routing: { ...variantConfig.routing },
      codeBucket: resolveCodeBucketName(config, environmentName, variantName),
      languages
    };
  }

  return {
    name: environmentName,
    awsRegion: environmentConfig.awsRegion,
    stackPrefix: environmentConfig.stackPrefix,
    certificateArn: environmentConfig.certificateArn,
    route53HostedZoneId: environmentConfig.route53HostedZoneId,
    stackName,
    runtimeParameterName,
    tables,
    lambda: { ...config.aws.lambda },
    rendering: { ...config.rendering },
    integrations: {
      webiny: {
        ...webinyConfig,
        mirrorTableName: tables.webinyMirror
      }
    },
    variants
  };
}

export async function validateAndResolveProjectConfig(projectConfig, options = {}) {
  const projectDir = options.projectDir ?? process.cwd();
  const errors = [];
  const warnings = [];

  if (!projectConfig || typeof projectConfig !== "object") {
    throw new S3teError("CONFIG_SCHEMA_ERROR", "Project config must be an object.");
  }

  if (!projectConfig.project || typeof projectConfig.project !== "object") {
    errors.push({ code: "CONFIG_SCHEMA_ERROR", message: "Missing project block." });
  } else if (!isValidProjectName(projectConfig.project.name ?? "")) {
    errors.push({
      code: "CONFIG_SCHEMA_ERROR",
      message: "project.name must match ^[a-z0-9-]+$.",
      details: { value: projectConfig.project.name }
    });
  }

  const environmentEntries = Object.entries(projectConfig.environments ?? {});
  if (environmentEntries.length === 0) {
    errors.push({ code: "CONFIG_SCHEMA_ERROR", message: "At least one environment is required." });
  }

  for (const [environmentName, environmentConfig] of environmentEntries) {
    if (!environmentConfig.awsRegion) {
      errors.push({ code: "CONFIG_SCHEMA_ERROR", message: `Environment ${environmentName} is missing awsRegion.` });
    }
    if (!environmentConfig.certificateArn) {
      errors.push({ code: "CONFIG_SCHEMA_ERROR", message: `Environment ${environmentName} is missing certificateArn.` });
    } else if (!/^arn:aws:acm:us-east-1:\d{12}:certificate\/.+$/.test(environmentConfig.certificateArn)) {
      errors.push({
        code: "CONFIG_CONFLICT_ERROR",
        message: `Environment ${environmentName} certificateArn must point to ACM in us-east-1.`,
        details: { certificateArn: environmentConfig.certificateArn }
      });
    }
    if (environmentConfig.stackPrefix && !isValidUpperSnake(environmentConfig.stackPrefix)) {
      errors.push({
        code: "CONFIG_SCHEMA_ERROR",
        message: `Environment ${environmentName} stackPrefix must match ^[A-Z0-9_]+$.`,
        details: { stackPrefix: environmentConfig.stackPrefix }
      });
    }
  }

  const variantEntries = Object.entries(projectConfig.variants ?? {});
  if (variantEntries.length === 0) {
    errors.push({ code: "CONFIG_SCHEMA_ERROR", message: "At least one variant is required." });
  }

  for (const [variantName, variantConfig] of variantEntries) {
    const languageEntries = Object.entries(variantConfig.languages ?? {});
    if (languageEntries.length === 0) {
      errors.push({ code: "CONFIG_SCHEMA_ERROR", message: `Variant ${variantName} needs at least one language.` });
      continue;
    }

    if (!variantConfig.defaultLanguage || !variantConfig.languages?.[variantConfig.defaultLanguage]) {
      errors.push({
        code: "CONFIG_CONFLICT_ERROR",
        message: `Variant ${variantName} defaultLanguage must exist in languages.`
      });
    }

    for (const [languageCode, languageConfig] of languageEntries) {
      if (!languageConfig.baseUrl) {
        errors.push({
          code: "CONFIG_SCHEMA_ERROR",
          message: `Variant ${variantName} language ${languageCode} is missing baseUrl.`
        });
      } else if (!isValidConfiguredHost(languageConfig.baseUrl)) {
        errors.push({
          code: "CONFIG_SCHEMA_ERROR",
          message: `Variant ${variantName} language ${languageCode} baseUrl must be a hostname without protocol or path.`,
          details: { value: languageConfig.baseUrl }
        });
      }
      if (!Array.isArray(languageConfig.cloudFrontAliases) || languageConfig.cloudFrontAliases.length === 0) {
        errors.push({
          code: "CONFIG_SCHEMA_ERROR",
          message: `Variant ${variantName} language ${languageCode} needs at least one cloudFrontAlias.`
        });
      } else {
        for (const alias of languageConfig.cloudFrontAliases) {
          if (!isValidConfiguredHost(alias)) {
            errors.push({
              code: "CONFIG_SCHEMA_ERROR",
              message: `Variant ${variantName} language ${languageCode} cloudFrontAliases must contain hostnames without protocol or path.`,
              details: { value: alias }
            });
          }
        }
      }
      if (languageConfig.webinyLocale !== undefined && typeof languageConfig.webinyLocale !== "string") {
        errors.push({
          code: "CONFIG_SCHEMA_ERROR",
          message: `Variant ${variantName} language ${languageCode} webinyLocale must be a string.`,
          details: { value: languageConfig.webinyLocale }
        });
      }
      if (languageConfig.targetBucket) {
        ensureKnownPlaceholders(languageConfig.targetBucket, `variants.${variantName}.languages.${languageCode}.targetBucket`, errors);
      }
    }
  }

  const configuredWebiny = projectConfig.integrations?.webiny;
  for (const [environmentName] of environmentEntries) {
    const environmentWebinyConfig = resolveEnvironmentWebinyIntegration(resolveProjectConfig({
      ...projectConfig,
      environments: Object.fromEntries(environmentEntries)
    }), environmentName);
    if (environmentWebinyConfig.enabled && !environmentWebinyConfig.sourceTableName) {
      errors.push({
        code: "CONFIG_CONFLICT_ERROR",
        message: `Webiny integration requires sourceTableName when enabled for environment ${environmentName}.`
      });
    }
  }

  for (const environmentName of Object.keys(configuredWebiny?.environments ?? {})) {
    if (!projectConfig.environments?.[environmentName]) {
      errors.push({
        code: "CONFIG_CONFLICT_ERROR",
        message: `integrations.webiny.environments.${environmentName} does not match a configured environment.`
      });
    }
  }

  for (const [variantName, pattern] of Object.entries(projectConfig.aws?.codeBuckets ?? {})) {
    ensureKnownPlaceholders(pattern, `aws.codeBuckets.${variantName}`, errors);
  }

  if (projectConfig.aws?.dependencyStore?.tableName) {
    ensureKnownPlaceholders(projectConfig.aws.dependencyStore.tableName, "aws.dependencyStore.tableName", errors);
  }
  if (projectConfig.aws?.contentStore?.tableName) {
    ensureKnownPlaceholders(projectConfig.aws.contentStore.tableName, "aws.contentStore.tableName", errors);
  }
  if (projectConfig.aws?.invalidationStore?.tableName) {
    ensureKnownPlaceholders(projectConfig.aws.invalidationStore.tableName, "aws.invalidationStore.tableName", errors);
  }
  if (configuredWebiny?.mirrorTableName) {
    ensureKnownPlaceholders(configuredWebiny.mirrorTableName, "integrations.webiny.mirrorTableName", errors);
  }
  for (const [environmentName, webinyConfig] of Object.entries(configuredWebiny?.environments ?? {})) {
    if (webinyConfig.mirrorTableName) {
      ensureKnownPlaceholders(webinyConfig.mirrorTableName, `integrations.webiny.environments.${environmentName}.mirrorTableName`, errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, config: null };
  }

  const resolvedConfig = resolveProjectConfig(projectConfig);
  const seenTargetBuckets = new Set();
  const seenCodeBuckets = new Set();
  const seenCloudFrontAliases = new Set();

  for (const variantConfig of Object.values(resolvedConfig.variants)) {
    await ensureDirectoryExists(projectDir, variantConfig.sourceDir, errors);
    await ensureDirectoryExists(projectDir, variantConfig.partDir, errors);
  }

  for (const environmentName of Object.keys(resolvedConfig.environments)) {
    const tables = resolveTableNames(resolvedConfig, environmentName);

    const tableNames = [tables.dependency, tables.content, tables.invalidation];
    for (const tableName of tableNames) {
      if (!/^[A-Za-z0-9_.-]+$/.test(tableName)) {
        errors.push({
          code: "CONFIG_CONFLICT_ERROR",
          message: `Resolved table name ${tableName} contains invalid characters.`
        });
      }
    }

    for (const [variantName, variantConfig] of Object.entries(resolvedConfig.variants)) {
      const codeBucket = resolveCodeBucketName(resolvedConfig, environmentName, variantName);
      if (seenCodeBuckets.has(codeBucket)) {
        errors.push({
          code: "CONFIG_CONFLICT_ERROR",
          message: `Duplicate code bucket ${codeBucket}.`
        });
      }
      seenCodeBuckets.add(codeBucket);

      for (const languageCode of Object.keys(variantConfig.languages)) {
        const targetBucket = resolveTargetBucketName(resolvedConfig, environmentName, variantName, languageCode);
        if (seenTargetBuckets.has(targetBucket)) {
          errors.push({
            code: "CONFIG_CONFLICT_ERROR",
            message: `Duplicate target bucket ${targetBucket}.`
          });
        }
        seenTargetBuckets.add(targetBucket);

        for (const alias of resolveCloudFrontAliases(resolvedConfig, environmentName, variantName, languageCode)) {
          if (seenCloudFrontAliases.has(alias)) {
            errors.push({
              code: "CONFIG_CONFLICT_ERROR",
              message: `Duplicate cloudFrontAlias ${alias}.`
            });
          }
          seenCloudFrontAliases.add(alias);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, config: null };
  }

  return { ok: true, errors, warnings, config: resolvedConfig };
}
