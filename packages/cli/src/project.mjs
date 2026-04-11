import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  S3teError,
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
  packageAwsProject
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
      variants: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: true,
          properties: {
            languages: {
              type: "object",
              additionalProperties: {
                type: "object",
                additionalProperties: false,
                properties: {
                  baseUrl: { type: "string" },
                  targetBucket: { type: "string" },
                  cloudFrontAliases: {
                    type: "array",
                    items: { type: "string" }
                  },
                  webinyLocale: { type: "string" }
                }
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
              }
            }
          }
        }
      }
    }
  };
}

async function fileExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeProjectFile(targetPath, body, force = false) {
  if (!force && await fileExists(targetPath)) {
    throw new Error(`Refusing to overwrite existing file: ${targetPath}`);
  }
  await writeTextFile(targetPath, body);
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

export async function loadResolvedConfig(projectDir, configPath) {
  const rawConfig = await loadProjectConfig(configPath);
  const result = await validateAndResolveProjectConfig(rawConfig, { projectDir });
  return { rawConfig, ...result };
}

export async function validateProject(projectDir, config, options = {}) {
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
  const baseUrl = options.baseUrl ?? "example.com";
  const variant = options.variant ?? "website";
  const language = options.language ?? "en";
  const force = Boolean(options.force);

  await ensureDirectory(path.join(projectDir, "app", "part"));
  await ensureDirectory(path.join(projectDir, "app", variant));
  await ensureDirectory(path.join(projectDir, "offline", "tests"));
  await ensureDirectory(path.join(projectDir, "offline", "content"));
  await ensureDirectory(path.join(projectDir, "offline", "schemas"));
  await ensureDirectory(path.join(projectDir, ".vscode"));

  const projectPackageJson = {
    name: projectName,
    private: true,
    type: "module",
    scripts: {
      validate: "s3te validate",
      render: "s3te render --env dev",
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

  await writeProjectFile(path.join(projectDir, "package.json"), JSON.stringify(projectPackageJson, null, 2) + "\n", force);
  await writeProjectFile(path.join(projectDir, "s3te.config.json"), JSON.stringify(config, null, 2) + "\n", force);
  await writeProjectFile(path.join(projectDir, "offline", "schemas", "s3te.config.schema.json"), JSON.stringify(schemaTemplate(), null, 2) + "\n", force);
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
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", testsDir], {
      cwd: projectDir,
      stdio: "inherit"
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

export async function packageProject(projectDir, config, options = {}) {
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

export async function doctorProject(projectDir, configPath, options = {}) {
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
    await ensureAwsCliAvailable({ cwd: projectDir });
    checks.push({ name: "aws-cli", ok: true, message: "AWS CLI available" });
  } catch (error) {
    checks.push({ name: "aws-cli", ok: false, message: error.message });
  }

  if (options.environment && options.config) {
    try {
      await ensureAwsCredentials({
        region: options.config.environments[options.environment].awsRegion,
        profile: options.profile,
        cwd: projectDir
      });
      checks.push({ name: "aws-auth", ok: true, message: `AWS credentials valid for ${options.environment}` });
    } catch (error) {
      checks.push({ name: "aws-auth", ok: false, message: error.message });
    }
  }

  return checks;
}

export async function migrateProject(configPath, rawConfig, writeChanges) {
  const options = typeof writeChanges === "object" && writeChanges !== null
    ? writeChanges
    : { writeChanges };
  const nextConfig = {
    ...rawConfig,
    configVersion: rawConfig.configVersion ?? 1
  };
  const changes = [];

  const enableWebiny = Boolean(options.enableWebiny);
  const disableWebiny = Boolean(options.disableWebiny);
  const webinySourceTable = options.webinySourceTable ? String(options.webinySourceTable).trim() : "";
  const webinyTenant = options.webinyTenant ? String(options.webinyTenant).trim() : "";
  const webinyModels = normalizeStringList(options.webinyModels);

  if (enableWebiny && disableWebiny) {
    throw new S3teError("CONFIG_CONFLICT_ERROR", "migrate does not allow --enable-webiny and --disable-webiny at the same time.");
  }

  const touchesWebiny = enableWebiny || disableWebiny || Boolean(webinySourceTable) || webinyModels.length > 0;
  if (touchesWebiny) {
    const existingIntegrations = nextConfig.integrations ?? {};
    const existingWebiny = existingIntegrations.webiny ?? {};
    const existingModels = normalizeStringList(existingWebiny.relevantModels ?? ["staticContent", "staticCodeContent"]);
    const shouldEnableWebiny = disableWebiny
      ? false
      : (enableWebiny || Boolean(webinySourceTable) || webinyModels.length > 0
          ? true
          : Boolean(existingWebiny.enabled));
    const nextSourceTableName = webinySourceTable || existingWebiny.sourceTableName || "";

    if (shouldEnableWebiny && !nextSourceTableName) {
      throw new S3teError("CONFIG_CONFLICT_ERROR", "Enabling Webiny requires --webiny-source-table <table> or an existing integrations.webiny.sourceTableName.");
    }

    nextConfig.integrations = {
      ...existingIntegrations,
      webiny: {
        enabled: shouldEnableWebiny,
        sourceTableName: nextSourceTableName || undefined,
        mirrorTableName: existingWebiny.mirrorTableName ?? "{stackPrefix}_s3te_content_{project}",
        tenant: webinyTenant || existingWebiny.tenant || undefined,
        relevantModels: normalizeStringList([
          ...(existingModels.length > 0 ? existingModels : ["staticContent", "staticCodeContent"]),
          ...webinyModels
        ])
      }
    };

    changes.push(shouldEnableWebiny ? "Enabled Webiny integration." : "Disabled Webiny integration.");
    if (webinySourceTable) {
      changes.push(`Set Webiny source table to ${webinySourceTable}.`);
    }
    if (webinyTenant) {
      changes.push(`Set Webiny tenant to ${webinyTenant}.`);
    }
    if (webinyModels.length > 0) {
      changes.push(`Added Webiny models: ${webinyModels.join(", ")}.`);
    }
  }

  if (options.writeChanges) {
    await writeTextFile(configPath, JSON.stringify(nextConfig, null, 2) + "\n");
  }

  return {
    config: nextConfig,
    changes
  };
}
