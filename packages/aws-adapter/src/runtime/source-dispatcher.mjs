import {
  buildInvalidationRequest,
  createAwsClients,
  createBuildId,
  decodeS3Key,
  invokeLambdaEvent,
  isRenderableBucketKey,
  loadEnvironmentManifest
} from "./common.mjs";

function variantFromBucket(environmentManifest, bucketName) {
  return Object.keys(environmentManifest.variants).find((variantName) => (
    environmentManifest.variants[variantName].codeBucket === bucketName
  ));
}

function outputKeyFromAssetKey(variantName, key) {
  if (key.startsWith(`${variantName}/`)) {
    return key.slice(variantName.length + 1);
  }
  return key;
}

export async function handler(event) {
  const environmentName = process.env.S3TE_ENVIRONMENT;
  const runtimeParameter = process.env.S3TE_RUNTIME_PARAMETER;
  const renderWorkerName = process.env.S3TE_RENDER_WORKER_NAME;
  const renderExtensions = String(process.env.S3TE_RENDER_EXTENSIONS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const clients = createAwsClients();
  const { environment: environmentManifest } = await loadEnvironmentManifest(
    clients.ssm,
    runtimeParameter,
    environmentName
  );

  let copiedAssets = 0;
  let deletedAssets = 0;
  let dispatchedBuilds = 0;

  for (const record of event.Records ?? []) {
    const bucketName = record.s3?.bucket?.name;
    const key = decodeS3Key(record.s3?.object?.key ?? "");
    const variantName = variantFromBucket(environmentManifest, bucketName);
    if (!variantName || !key) {
      continue;
    }

    const action = String(record.eventName).startsWith("ObjectRemoved:") ? "delete" : "upsert";
    const buildId = createBuildId("source");

    if (isRenderableBucketKey(environmentManifest, variantName, key, renderExtensions)) {
      await invokeLambdaEvent(clients.lambda, renderWorkerName, {
        type: "source-object",
        action,
        bucket: bucketName,
        key,
        environment: environmentName,
        variant: variantName,
        buildId
      });
      dispatchedBuilds += 1;
      continue;
    }

    const outputKey = outputKeyFromAssetKey(variantName, key);
    for (const languageCode of Object.keys(environmentManifest.variants[variantName].languages)) {
      const targetBucket = environmentManifest.variants[variantName].languages[languageCode].targetBucket;
      if (action === "upsert") {
        await clients.s3.copyObject({
          Bucket: targetBucket,
          Key: outputKey,
          CopySource: `${bucketName}/${key.split("/").map(encodeURIComponent).join("/")}`
        }).promise();
        copiedAssets += 1;
      } else {
        await clients.s3.deleteObject({
          Bucket: targetBucket,
          Key: outputKey
        }).promise();
        deletedAssets += 1;
      }

      await invokeLambdaEvent(
        clients.lambda,
        environmentManifest.functions.invalidationScheduler,
        buildInvalidationRequest(
          environmentName,
          environmentManifest,
          variantName,
          languageCode,
          buildId
        )
      );
    }
  }

  return {
    copiedAssets,
    deletedAssets,
    dispatchedBuilds
  };
}
