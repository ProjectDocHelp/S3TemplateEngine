import fs from "node:fs/promises";
import path from "node:path";

import {
  buildEnvironmentRuntimeConfig,
  resolveStackName,
  S3teError
} from "../../core/src/index.mjs";
import { ensureAwsCliAvailable, ensureAwsCredentials, runAwsCli } from "./aws-cli.mjs";
import { resolveRequestedFeatures } from "./features.mjs";
import { buildAwsRuntimeManifest, extractStackOutputsMap } from "./manifest.mjs";
import { packageAwsProject } from "./package.mjs";
import { syncPreparedSources } from "./sync.mjs";
import { buildTemporaryDeployStackTemplate } from "./template.mjs";

function normalizeRelative(projectDir, targetPath) {
  return path.relative(projectDir, targetPath).replace(/\\/g, "/");
}

async function ensureDirectory(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJsonFile(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function temporaryStackName(stackName) {
  return `${stackName}-deploy-temp`;
}

async function uploadArtifact({ bucketName, key, bodyPath, region, profile, cwd }) {
  await runAwsCli(["s3api", "put-object", "--bucket", bucketName, "--key", key, "--body", bodyPath], {
    region,
    profile,
    cwd,
    errorCode: "ADAPTER_ERROR"
  });
}

async function describeStack({ stackName, region, profile, cwd }) {
  const describedStack = await runAwsCli(["cloudformation", "describe-stacks", "--stack-name", stackName, "--output", "json"], {
    region,
    profile,
    cwd,
    errorCode: "ADAPTER_ERROR"
  });
  return JSON.parse(describedStack.stdout).Stacks?.[0];
}

async function describeStackEvents({ stackName, region, profile, cwd }) {
  const describedEvents = await runAwsCli(["cloudformation", "describe-stack-events", "--stack-name", stackName, "--output", "json"], {
    region,
    profile,
    cwd,
    errorCode: "ADAPTER_ERROR"
  });
  return JSON.parse(describedEvents.stdout).StackEvents ?? [];
}

export function summarizeStackFailureEvents(stackEvents = [], limit = 8) {
  return stackEvents
    .filter((event) => (
      String(event.ResourceStatus ?? "").includes("FAILED")
      || String(event.ResourceStatus ?? "").includes("ROLLBACK")
    ))
    .map((event) => ({
      timestamp: event.Timestamp,
      logicalResourceId: event.LogicalResourceId,
      resourceType: event.ResourceType,
      resourceStatus: event.ResourceStatus,
      resourceStatusReason: event.ResourceStatusReason
    }))
    .slice(0, limit);
}

async function attachStackFailureDetails(error, { stackName, region, profile, cwd }) {
  try {
    const stackEvents = await describeStackEvents({ stackName, region, profile, cwd });
    const summarizedEvents = summarizeStackFailureEvents(stackEvents);
    if (summarizedEvents.length > 0) {
      error.details = {
        ...(error.details ?? {}),
        stackFailureEvents: summarizedEvents
      };
    }
  } catch (stackEventsError) {
    error.details = {
      ...(error.details ?? {}),
      stackFailureEventsError: stackEventsError.message
    };
  }

  return error;
}

async function deployCloudFormationStack({
  stackName,
  templatePath,
  region,
  profile,
  cwd,
  capabilities = [],
  parameterOverrides = [],
  noExecute = false,
  stdio = "pipe"
}) {
  const args = [
    "cloudformation",
    "deploy",
    "--stack-name",
    stackName,
    "--template-file",
    templatePath
  ];

  if (capabilities.length > 0) {
    args.push("--capabilities", ...capabilities);
  }

  if (parameterOverrides.length > 0) {
    args.push("--parameter-overrides", ...parameterOverrides);
  }

  if (noExecute) {
    args.push("--no-execute-changeset");
  }

  try {
    await runAwsCli(args, {
      region,
      profile,
      cwd,
      stdio,
      errorCode: "ADAPTER_ERROR"
    });
  } catch (error) {
    throw await attachStackFailureDetails(error, {
      stackName,
      region,
      profile,
      cwd
    });
  }
}

async function resolveWebinyStreamArn({ runtimeConfig, region, profile, cwd }) {
  const tableName = runtimeConfig.integrations.webiny.sourceTableName;
  if (!tableName) {
    throw new S3teError("ADAPTER_ERROR", "Webiny feature requires integrations.webiny.sourceTableName.");
  }

  const response = await runAwsCli(["dynamodb", "describe-table", "--table-name", tableName, "--output", "json"], {
    region,
    profile,
    cwd,
    errorCode: "ADAPTER_ERROR"
  });
  const tableDescription = JSON.parse(response.stdout);
  const streamArn = tableDescription?.Table?.LatestStreamArn;
  if (!streamArn) {
    throw new S3teError("ADAPTER_ERROR", `DynamoDB table ${tableName} has no stream enabled.`);
  }
  return streamArn;
}

async function loadOrCreatePackage({ projectDir, config, environment, packageDir, features }) {
  if (packageDir) {
    const manifestPath = path.join(projectDir, packageDir, "manifest.json");
    return {
      packageDir: packageDir.replace(/\\/g, "/"),
      manifest: await readJsonFile(manifestPath),
      manifestPath
    };
  }

  const result = await packageAwsProject({
    projectDir,
    config,
    environment,
    features
  });
  return {
    packageDir: result.packageDir,
    manifest: result.manifest,
    manifestPath: path.join(projectDir, result.manifestPath)
  };
}

async function deployTemporaryArtifactsStack({
  projectDir,
  packageDir,
  stackName,
  region,
  profile,
  stdio
}) {
  const templatePath = path.join(projectDir, packageDir, "temporary-deploy-stack.template.json");
  await writeJsonFile(templatePath, buildTemporaryDeployStackTemplate());

  await deployCloudFormationStack({
    stackName,
    templatePath,
    region,
    profile,
    cwd: projectDir,
    stdio
  });

  const stackDescription = await describeStack({
    stackName,
    region,
    profile,
    cwd: projectDir
  });
  const outputs = extractStackOutputsMap(stackDescription);
  const artifactBucket = outputs.ArtifactBucketName;
  if (!artifactBucket) {
    throw new S3teError("ADAPTER_ERROR", `Temporary deploy stack ${stackName} did not return ArtifactBucketName.`);
  }

  return {
    stackName,
    templatePath,
    artifactBucket
  };
}

export function collectBucketObjectVersions(payload = {}) {
  return [
    ...(payload.Versions ?? []),
    ...(payload.DeleteMarkers ?? [])
  ].map((entry) => ({
    Key: entry.Key,
    VersionId: entry.VersionId
  })).filter((entry) => entry.Key && entry.VersionId);
}

function chunkItems(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function deleteBucketObjectVersions({
  bucketName,
  region,
  profile,
  cwd
}) {
  while (true) {
    const listedVersions = await runAwsCli(["s3api", "list-object-versions", "--bucket", bucketName, "--output", "json"], {
      region,
      profile,
      cwd,
      errorCode: "ADAPTER_ERROR"
    });
    const objects = collectBucketObjectVersions(JSON.parse(listedVersions.stdout || "{}"));
    if (objects.length === 0) {
      return;
    }

    for (const batch of chunkItems(objects, 250)) {
      await runAwsCli([
        "s3api",
        "delete-objects",
        "--bucket",
        bucketName,
        "--delete",
        JSON.stringify({
          Objects: batch,
          Quiet: true
        })
      ], {
        region,
        profile,
        cwd,
        errorCode: "ADAPTER_ERROR"
      });
    }
  }
}

async function cleanupTemporaryArtifactsStack({
  stackName,
  artifactBucket,
  region,
  profile,
  cwd
}) {
  if (artifactBucket) {
    try {
      await runAwsCli(["s3", "rm", `s3://${artifactBucket}`, "--recursive"], {
        region,
        profile,
        cwd,
        errorCode: "ADAPTER_ERROR"
      });
      await deleteBucketObjectVersions({
        bucketName: artifactBucket,
        region,
        profile,
        cwd
      });
    } catch (error) {
      if (!String(error.message).includes("NoSuchBucket")) {
        throw error;
      }
    }
  }

  await runAwsCli(["cloudformation", "delete-stack", "--stack-name", stackName], {
    region,
    profile,
    cwd,
    errorCode: "ADAPTER_ERROR"
  });

  await runAwsCli(["cloudformation", "wait", "stack-delete-complete", "--stack-name", stackName], {
    region,
    profile,
    cwd,
    errorCode: "ADAPTER_ERROR"
  });
}

function buildEnvironmentStackParameters({
  artifactBucket,
  uploadedArtifacts,
  runtimeManifestValue,
  webinyStreamArn = ""
}) {
  return [
    `ArtifactBucket=${artifactBucket}`,
    `SourceDispatcherArtifactKey=${uploadedArtifacts.sourceDispatcher}`,
    `RenderWorkerArtifactKey=${uploadedArtifacts.renderWorker}`,
    `InvalidationSchedulerArtifactKey=${uploadedArtifacts.invalidationScheduler}`,
    `InvalidationExecutorArtifactKey=${uploadedArtifacts.invalidationExecutor}`,
    `ContentMirrorArtifactKey=${uploadedArtifacts.contentMirror}`,
    `SitemapUpdaterArtifactKey=${uploadedArtifacts.sitemapUpdater}`,
    `RuntimeManifestValue=${runtimeManifestValue}`,
    `WebinySourceTableStreamArn=${webinyStreamArn}`
  ];
}

export async function deployAwsProject({
  projectDir,
  config,
  environment,
  packageDir,
  features = [],
  profile,
  plan = false,
  noSync = false,
  stdio = "pipe"
}) {
  const runtimeConfig = buildEnvironmentRuntimeConfig(config, environment);
  const requestedFeatureSet = new Set(features);
  const featureSet = new Set(resolveRequestedFeatures(config, features, environment));
  const stackName = resolveStackName(config, environment);
  const tempStackName = temporaryStackName(stackName);
  const runtimeManifestPath = path.join(projectDir, packageDir ?? path.join("offline", "IAAS", "package", environment), "runtime-manifest.json");

  if (requestedFeatureSet.has("webiny") && !runtimeConfig.integrations.webiny.enabled) {
    throw new S3teError("ADAPTER_ERROR", "Feature webiny was requested but is not enabled in s3te.config.json.");
  }
  if (requestedFeatureSet.has("sitemap") && !runtimeConfig.integrations.sitemap.enabled) {
    throw new S3teError("ADAPTER_ERROR", "Feature sitemap was requested but is not enabled in s3te.config.json.");
  }

  await ensureAwsCliAvailable({ cwd: projectDir });
  await ensureAwsCredentials({
    region: runtimeConfig.awsRegion,
    profile,
    cwd: projectDir
  });

  const packaged = await loadOrCreatePackage({
    projectDir,
    config,
    environment,
    packageDir,
    features: [...featureSet]
  });

  let tempStack = null;
  let cleanupError = null;
  let primaryError = null;

  try {
    tempStack = await deployTemporaryArtifactsStack({
      projectDir,
      packageDir: packaged.manifest.packageDir,
      stackName: tempStackName,
      region: runtimeConfig.awsRegion,
      profile,
      stdio
    });

    const uploadedArtifacts = {};
    for (const [artifactName, artifact] of Object.entries(packaged.manifest.lambdaArtifacts)) {
      const bodyPath = path.join(projectDir, artifact.archive);
      const key = `${config.project.name}/${environment}/${artifact.s3Key}`;
      await uploadArtifact({
        bucketName: tempStack.artifactBucket,
        key,
        bodyPath,
        region: runtimeConfig.awsRegion,
        profile,
        cwd: projectDir
      });
      uploadedArtifacts[artifactName] = key;
    }

    let webinyStreamArn = "";
    if (featureSet.has("webiny")) {
      webinyStreamArn = await resolveWebinyStreamArn({
        runtimeConfig,
        region: runtimeConfig.awsRegion,
        profile,
        cwd: projectDir
      });
    }

    await deployCloudFormationStack({
      stackName,
      templatePath: path.join(projectDir, packaged.manifest.cloudFormationTemplate),
      region: runtimeConfig.awsRegion,
      profile,
      cwd: projectDir,
      capabilities: ["CAPABILITY_NAMED_IAM"],
      parameterOverrides: buildEnvironmentStackParameters({
        artifactBucket: tempStack.artifactBucket,
        uploadedArtifacts,
        runtimeManifestValue: "{}",
        webinyStreamArn
      }),
      noExecute: plan,
      stdio
    });

    if (plan) {
      return {
        stackName,
        packageDir: packaged.manifest.packageDir,
        runtimeManifestPath: normalizeRelative(projectDir, runtimeManifestPath),
        syncedCodeBuckets: [],
        distributions: [],
        temporaryStackName: tempStackName,
        temporaryStackDeleted: false
      };
    }

    const stackDescription = await describeStack({
      stackName,
      region: runtimeConfig.awsRegion,
      profile,
      cwd: projectDir
    });
    const stackOutputs = extractStackOutputsMap(stackDescription);
    const runtimeManifest = buildAwsRuntimeManifest({
      config,
      environment,
      stackOutputs
    });
    await writeJsonFile(runtimeManifestPath, runtimeManifest);

    await deployCloudFormationStack({
      stackName,
      templatePath: path.join(projectDir, packaged.manifest.cloudFormationTemplate),
      region: runtimeConfig.awsRegion,
      profile,
      cwd: projectDir,
      capabilities: ["CAPABILITY_NAMED_IAM"],
      parameterOverrides: buildEnvironmentStackParameters({
        artifactBucket: tempStack.artifactBucket,
        uploadedArtifacts,
        runtimeManifestValue: JSON.stringify(runtimeManifest),
        webinyStreamArn
      }),
      stdio
    });

    const syncedCodeBuckets = noSync
      ? []
      : (await syncPreparedSources({
          projectDir,
          runtimeConfig,
          syncDirectories: packaged.manifest.syncDirectories,
          profile,
          stdio
        })).syncedCodeBuckets;

    const distributions = [];
    for (const [variantName, variantConfig] of Object.entries(runtimeConfig.variants)) {
      for (const languageCode of Object.keys(variantConfig.languages)) {
        distributions.push({
          variant: variantName,
          language: languageCode,
          distributionId: runtimeManifest.environments[environment].variants[variantName].languages[languageCode].distributionId
        });
      }
    }

    return {
      stackName,
      packageDir: packaged.manifest.packageDir,
      runtimeManifestPath: normalizeRelative(projectDir, runtimeManifestPath),
      syncedCodeBuckets,
      distributions,
      temporaryStackName: tempStackName,
      temporaryStackDeleted: true
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (tempStack && !plan) {
      try {
        await cleanupTemporaryArtifactsStack({
          stackName: tempStackName,
          artifactBucket: tempStack.artifactBucket,
          region: runtimeConfig.awsRegion,
          profile,
          cwd: projectDir
        });
      } catch (error) {
        cleanupError = error;
      }
    }

    if (cleanupError) {
      if (primaryError) {
        primaryError.details = {
          ...(primaryError.details ?? {}),
          cleanupError: cleanupError.message,
          temporaryStackName: tempStackName
        };
      } else {
        throw cleanupError;
      }
    }
  }
}
