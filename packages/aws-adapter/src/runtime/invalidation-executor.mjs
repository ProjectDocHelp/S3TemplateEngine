import { createAwsClients } from "./common.mjs";

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function handler(event) {
  const clients = createAwsClients();
  const tableName = process.env.S3TE_INVALIDATION_TABLE;
  const distributionId = event.distributionId;

  const response = await clients.dynamo.query({
    TableName: tableName,
    KeyConditionExpression: "distributionId = :distributionId",
    ExpressionAttributeValues: {
      ":distributionId": distributionId
    }
  }).promise();

  const items = response.Items ?? [];
  const requests = items.filter((item) => item.requestId !== "__window__" && item.type === "request");
  if (requests.length > 0) {
    await clients.cloudFront.createInvalidation({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `${distributionId}-${Date.now()}`,
        Paths: {
          Quantity: 1,
          Items: ["/*"]
        }
      }
    }).promise();
  }

  const deletions = items.map((item) => ({
    DeleteRequest: {
      Key: {
        distributionId: item.distributionId,
        requestId: item.requestId
      }
    }
  }));

  for (const batch of chunk(deletions, 25)) {
    await clients.dynamo.batchWrite({
      RequestItems: {
        [tableName]: batch
      }
    }).promise();
  }

  return {
    distributionId,
    invalidated: requests.length > 0,
    deletedRecords: deletions.length
  };
}
