import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  S3teError,
  buildEnvironmentRuntimeConfig,
  resolveStackName
} from "../../core/src/index.mjs";

import { buildAwsRuntimeManifest } from "./manifest.mjs";
import { resolveRequestedFeatures } from "./features.mjs";
import { buildCloudFormationTemplate } from "./template.mjs";
import { writeZipArchive } from "./zip.mjs";

const ZIP_DATE = new Date("2020-01-01T00:00:00.000Z");
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const RUNTIME_PACKAGE_DEPENDENCIES = [
  "@aws-sdk/client-cloudfront",
  "@aws-sdk/client-dynamodb",
  "@aws-sdk/client-lambda",
  "@aws-sdk/client-s3",
  "@aws-sdk/client-sfn",
  "@aws-sdk/client-ssm",
  "@aws-sdk/lib-dynamodb",
  "@aws-sdk/util-dynamodb"
];
const INTERNAL_RUNTIME_DIRECTORIES = [
  {
    sourceDir: path.resolve(PACKAGE_ROOT, "..", "core", "src"),
    archivePrefix: "packages/core/src"
  }
];

function normalizeArchivePath(value) {
  return String(value).replace(/\\/g, "/");
}

async function ensureDirectory(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
}

async function removeDirectory(targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
}

async function listFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
      files.push(...await listFiles(rootDir, fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(rootDir, fullPath).replace(/\\/g, "/"));
    }
  }

  return files.sort();
}

async function findPackageRoot(startPath) {
  let currentPath = startPath;

  while (true) {
    const candidate = path.join(currentPath, "package.json");
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return currentPath;
      }
    } catch {
      // continue walking upwards
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`Unable to locate package root from ${startPath}.`);
    }
    currentPath = parentPath;
  }
}

async function resolveInstalledPackageRoot(packageName) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    return path.dirname(packageJsonPath);
  } catch (error) {
    try {
      const entryPath = require.resolve(packageName);
      return await findPackageRoot(path.dirname(entryPath));
    } catch (fallbackError) {
      throw new S3teError(
        "ADAPTER_ERROR",
        `Required runtime dependency ${packageName} is not installed. Run npm install before packaging or deploying.`,
        { packageName, cause: fallbackError.message || error.message }
      );
    }
  }
}

async function listPackageFiles(packageRoot) {
  const files = await listFiles(packageRoot);
  return files.sort();
}

async function readPackageJson(packageRoot) {
  const raw = await fs.readFile(path.join(packageRoot, "package.json"), "utf8");
  return JSON.parse(raw);
}

async function collectInstalledPackageEntries(packageName, targetPrefix, seenPackages = new Set()) {
  if (seenPackages.has(packageName)) {
    return [];
  }
  seenPackages.add(packageName);

  const packageRoot = await resolveInstalledPackageRoot(packageName);
  const packageJson = await readPackageJson(packageRoot);
  const files = await listPackageFiles(packageRoot);
  const entries = [];

  for (const relativePath of files) {
    const absolutePath = path.join(packageRoot, relativePath);
    const data = await fs.readFile(absolutePath);
    entries.push({
      name: normalizeArchivePath(path.join(targetPrefix, relativePath)),
      data,
      modifiedAt: ZIP_DATE
    });
  }

  for (const dependencyName of Object.keys(packageJson.dependencies ?? {}).sort()) {
    const nestedPrefix = normalizeArchivePath(path.join("node_modules", dependencyName));
    entries.push(...await collectInstalledPackageEntries(dependencyName, nestedPrefix, seenPackages));
  }

  return entries;
}

async function copyDirectory(sourceDir, targetDir) {
  const files = await listFiles(sourceDir);
  for (const relativePath of files) {
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(targetDir, relativePath);
    await ensureDirectory(path.dirname(targetPath));
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function collectLambdaArchiveEntries() {
  const entries = [];

  const runtimeRoot = path.join(PACKAGE_ROOT, "src", "runtime");
  const runtimeFiles = await listFiles(runtimeRoot);
  for (const relativePath of runtimeFiles) {
    const absolutePath = path.join(runtimeRoot, relativePath);
    const data = await fs.readFile(absolutePath);
    entries.push({
      name: normalizeArchivePath(path.join("packages/aws-adapter/src/runtime", relativePath)),
      data,
      modifiedAt: ZIP_DATE
    });
  }

  for (const { sourceDir, archivePrefix } of INTERNAL_RUNTIME_DIRECTORIES) {
    const sourceFiles = await listFiles(sourceDir);
    for (const relativePath of sourceFiles) {
      const absolutePath = path.join(sourceDir, relativePath);
      const data = await fs.readFile(absolutePath);
      entries.push({
        name: normalizeArchivePath(path.join(archivePrefix, relativePath)),
        data,
        modifiedAt: ZIP_DATE
      });
    }
  }

  for (const packageName of RUNTIME_PACKAGE_DEPENDENCIES) {
    entries.push(...await collectInstalledPackageEntries(packageName, normalizeArchivePath(path.join("node_modules", packageName))));
  }

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

async function writeJsonFile(targetPath, value) {
  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function prepareVariantSyncDirectory(projectDir, packageDir, runtimeConfig, variantName) {
  const variantConfig = runtimeConfig.variants[variantName];
  const syncRoot = path.join(packageDir, "sync", variantName);
  await removeDirectory(syncRoot);
  await ensureDirectory(syncRoot);

  await copyDirectory(path.join(projectDir, variantConfig.partDir), path.join(syncRoot, "part"));
  await copyDirectory(path.join(projectDir, variantConfig.sourceDir), path.join(syncRoot, variantName));

  return syncRoot;
}

function normalizeRelative(projectDir, targetPath) {
  return path.relative(projectDir, targetPath).replace(/\\/g, "/");
}

export async function packageAwsProject({
  projectDir,
  config,
  environment,
  outDir,
  clean = false,
  features = []
}) {
  const runtimeConfig = buildEnvironmentRuntimeConfig(config, environment);

  if (features.includes("webiny") && !runtimeConfig.integrations.webiny.enabled) {
    throw new S3teError("ADAPTER_ERROR", "Feature webiny was requested but is not enabled in s3te.config.json.");
  }

  const resolvedFeatures = resolveRequestedFeatures(config, features, environment);
  const packageDir = outDir
    ? path.join(projectDir, outDir)
    : path.join(projectDir, "offline", "IAAS", "package", environment);
  if (clean) {
    await removeDirectory(packageDir);
  }
  await ensureDirectory(packageDir);

  const lambdaDir = path.join(packageDir, "lambda");
  const templatePath = path.join(packageDir, "cloudformation.template.json");
  const packagingManifestPath = path.join(packageDir, "manifest.json");
  const runtimeManifestSeedPath = path.join(packageDir, "runtime-manifest.base.json");
  const lambdaEntries = await collectLambdaArchiveEntries();

  const lambdaArtifacts = {
    sourceDispatcher: {
      archive: path.join(lambdaDir, "source-dispatcher.zip"),
      parameter: "SourceDispatcherArtifactKey",
      s3Key: `lambda/source-dispatcher.zip`
    },
    renderWorker: {
      archive: path.join(lambdaDir, "render-worker.zip"),
      parameter: "RenderWorkerArtifactKey",
      s3Key: `lambda/render-worker.zip`
    },
    invalidationScheduler: {
      archive: path.join(lambdaDir, "invalidation-scheduler.zip"),
      parameter: "InvalidationSchedulerArtifactKey",
      s3Key: `lambda/invalidation-scheduler.zip`
    },
    invalidationExecutor: {
      archive: path.join(lambdaDir, "invalidation-executor.zip"),
      parameter: "InvalidationExecutorArtifactKey",
      s3Key: `lambda/invalidation-executor.zip`
    },
    contentMirror: {
      archive: path.join(lambdaDir, "content-mirror.zip"),
      parameter: "ContentMirrorArtifactKey",
      s3Key: `lambda/content-mirror.zip`
    }
  };

  for (const artifact of Object.values(lambdaArtifacts)) {
    await writeZipArchive(artifact.archive, lambdaEntries);
  }

  const syncDirectories = {};
  for (const variantName of Object.keys(config.variants)) {
    syncDirectories[variantName] = await prepareVariantSyncDirectory(projectDir, packageDir, runtimeConfig, variantName);
  }

  const template = buildCloudFormationTemplate({ config, environment, features: resolvedFeatures });
  const runtimeManifestSeed = buildAwsRuntimeManifest({ config, environment });

  await writeJsonFile(templatePath, template);
  await writeJsonFile(runtimeManifestSeedPath, runtimeManifestSeed);

  const manifest = {
    version: 1,
    environment,
    generatedAt: new Date().toISOString(),
    stackName: resolveStackName(config, environment),
    runtimeParameterName: runtimeConfig.runtimeParameterName,
    packageDir: normalizeRelative(projectDir, packageDir),
    cloudFormationTemplate: normalizeRelative(projectDir, templatePath),
    runtimeManifestSeed: normalizeRelative(projectDir, runtimeManifestSeedPath),
    lambdaArtifacts: Object.fromEntries(Object.entries(lambdaArtifacts).map(([name, artifact]) => [
      name,
      {
        parameter: artifact.parameter,
        archive: normalizeRelative(projectDir, artifact.archive),
        s3Key: artifact.s3Key
      }
    ])),
    syncDirectories: Object.fromEntries(Object.entries(syncDirectories).map(([variantName, syncRoot]) => [
      variantName,
      normalizeRelative(projectDir, syncRoot)
    ])),
    features: {
      available: [...resolvedFeatures],
      requested: [...features]
    }
  };

  await writeJsonFile(packagingManifestPath, manifest);

  return {
    packageDir: manifest.packageDir,
    manifestPath: normalizeRelative(projectDir, packagingManifestPath),
    lambdaArtifacts: Object.values(manifest.lambdaArtifacts).map((artifact) => artifact.archive),
    cloudFormationTemplate: manifest.cloudFormationTemplate,
    manifest
  };
}
