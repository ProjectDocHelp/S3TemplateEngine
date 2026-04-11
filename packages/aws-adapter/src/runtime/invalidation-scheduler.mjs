import { createAwsClients } from "./common.mjs";

export async function handler(event) {
  const clients = createAwsClients();
  const tableName = process.env.S3TE_INVALIDATION_TABLE;
  const stateMachineArn = process.env.S3TE_INVALIDATION_STATE_MACHINE_ARN;

  const requestId = `${event.requestedAt ?? new Date().toISOString()}#${event.buildId ?? "build"}`;
  await clients.dynamo.put({
    TableName: tableName,
    Item: {
      distributionId: event.distributionId,
      requestId,
      type: "request",
      environment: event.environment,
      variant: event.variant,
      language: event.language,
      distributionAliases: event.distributionAliases ?? [],
      paths: event.paths ?? ["/*"],
      requestedAt: event.requestedAt ?? new Date().toISOString(),
      status: "pending"
    }
  }).promise();

  let windowOpened = false;
  try {
    await clients.dynamo.put({
      TableName: tableName,
      Item: {
        distributionId: event.distributionId,
        requestId: "__window__",
        type: "window",
        windowOpenedAt: new Date().toISOString()
      },
      ConditionExpression: "attribute_not_exists(distributionId)"
    }).promise();
    windowOpened = true;
  } catch (error) {
    const errorCode = error?.name ?? error?.Code ?? error?.code;
    if (errorCode !== "ConditionalCheckFailedException") {
      throw error;
    }
  }

  if (windowOpened) {
    await clients.stepFunctions.startExecution({
      stateMachineArn,
      input: JSON.stringify({
        distributionId: event.distributionId
      })
    }).promise();
  }

  return {
    distributionId: event.distributionId,
    requestId,
    windowOpened
  };
}
