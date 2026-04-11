import fs from "node:fs/promises";
import path from "node:path";

import { buildEnvironmentRuntimeConfig } from "../../core/src/index.mjs";
import { ensureAwsCliAvailable, ensureAwsCredentials, runAwsCli } from "./aws-cli.mjs";

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
      files.push(...await listFiles(rootDir, fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(rootDir, fullPath).replace(/\\/g, "/"));
    }
  }

  return files.sort();
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

function normalizeRelative(projectDir, targetPath) {
  return path.relative(projectDir, targetPath).replace(/\\/g, "/");
}

async function stageVariantSources(projectDir, runtimeConfig, variantName, syncRoot) {
  const variantConfig = runtimeConfig.variants[variantName];
  const variantRoot = path.join(syncRoot, variantName);
  await removeDirectory(variantRoot);
  await ensureDirectory(variantRoot);

  await copyDirectory(path.join(projectDir, variantConfig.partDir), path.join(variantRoot, "part"));
  await copyDirectory(path.join(projectDir, variantConfig.sourceDir), path.join(variantRoot, variantName));

  return variantRoot;
}

export async function stageProjectSources({
  projectDir,
  config,
  environment,
  outDir
}) {
  const runtimeConfig = buildEnvironmentRuntimeConfig(config, environment);
  const syncRoot = outDir
    ? path.join(projectDir, outDir)
    : path.join(projectDir, "offline", "IAAS", "sync", environment);

  await ensureDirectory(syncRoot);

  const syncDirectories = {};
  for (const variantName of Object.keys(runtimeConfig.variants)) {
    const variantRoot = await stageVariantSources(projectDir, runtimeConfig, variantName, syncRoot);
    syncDirectories[variantName] = normalizeRelative(projectDir, variantRoot);
  }

  return {
    runtimeConfig,
    syncRoot: normalizeRelative(projectDir, syncRoot),
    syncDirectories
  };
}

export async function syncPreparedSources({
  projectDir,
  runtimeConfig,
  syncDirectories,
  profile,
  stdio = "pipe",
  ensureAwsCliAvailableFn = ensureAwsCliAvailable,
  ensureAwsCredentialsFn = ensureAwsCredentials,
  runAwsCliFn = runAwsCli
}) {
  await ensureAwsCliAvailableFn({ cwd: projectDir });
  await ensureAwsCredentialsFn({
    region: runtimeConfig.awsRegion,
    profile,
    cwd: projectDir
  });

  const syncedCodeBuckets = [];
  for (const [variantName, variantConfig] of Object.entries(runtimeConfig.variants)) {
    const syncDir = path.join(projectDir, syncDirectories[variantName]);
    await runAwsCliFn(["s3", "sync", syncDir, `s3://${variantConfig.codeBucket}`, "--delete"], {
      region: runtimeConfig.awsRegion,
      profile,
      cwd: projectDir,
      stdio,
      errorCode: "ADAPTER_ERROR"
    });
    syncedCodeBuckets.push(variantConfig.codeBucket);
  }

  return {
    syncedCodeBuckets
  };
}

export async function syncAwsProject({
  projectDir,
  config,
  environment,
  outDir,
  profile,
  stdio = "pipe",
  ensureAwsCliAvailableFn = ensureAwsCliAvailable,
  ensureAwsCredentialsFn = ensureAwsCredentials,
  runAwsCliFn = runAwsCli
}) {
  const prepared = await stageProjectSources({
    projectDir,
    config,
    environment,
    outDir
  });

  const synced = await syncPreparedSources({
    projectDir,
    runtimeConfig: prepared.runtimeConfig,
    syncDirectories: prepared.syncDirectories,
    profile,
    stdio,
    ensureAwsCliAvailableFn,
    ensureAwsCredentialsFn,
    runAwsCliFn
  });

  return {
    syncRoot: prepared.syncRoot,
    syncDirectories: prepared.syncDirectories,
    syncedCodeBuckets: synced.syncedCodeBuckets
  };
}
