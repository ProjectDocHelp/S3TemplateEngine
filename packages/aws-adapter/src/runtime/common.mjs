import path from "node:path";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import {
  applyContentQuery,
  createManualRenderTargets,
  getContentTypeForPath,
  isRenderableKey,
  renderSourceTemplate
} from "../../../core/src/index.mjs";

function normalizeKey(value) {
  return String(value).replace(/\\/g, "/");
}

function buildSourceId(environment, variant, language, outputKey) {
  return `${environment}#${variant}#${language}#${outputKey}`;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeLocale(value) {
  return String(value).trim().toLowerCase();
}

function buildLocaleCandidates(language, languageLocaleMap) {
  const requested = String(language ?? "").trim();
  const configured = String(languageLocaleMap?.[requested] ?? requested).trim();
  return [...new Set([configured, requested].filter(Boolean).map(normalizeLocale))];
}

function localeMatchScore(itemLocale, language, languageLocaleMap) {
  if (!itemLocale) {
    return 1;
  }

  const normalizedItemLocale = normalizeLocale(itemLocale);
  const candidates = buildLocaleCandidates(language, languageLocaleMap);
  if (candidates.includes(normalizedItemLocale)) {
    return 3;
  }

  if (candidates.some((candidate) => candidate.length >= 2 && normalizedItemLocale.startsWith(`${candidate}-`))) {
    return 2;
  }

  return 0;
}

function matchesRequestedLocale(item, language, languageLocaleMap) {
  return localeMatchScore(item?.locale, language, languageLocaleMap) > 0;
}

function filterItemsByRequestedLocale(items, language, languageLocaleMap) {
  const grouped = new Map();

  for (const item of items) {
    const groupKey = item.contentId ?? item.id ?? JSON.stringify(item);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push(item);
  }

  return [...grouped.values()].flatMap((groupItems) => {
    const scored = groupItems
      .map((item) => ({
        item,
        score: localeMatchScore(item.locale, language, languageLocaleMap)
      }))
      .filter((entry) => entry.score > 0);
    if (scored.length === 0) {
      return [];
    }

    const bestScore = Math.max(...scored.map((entry) => entry.score));
    return scored.filter((entry) => entry.score === bestScore).map((entry) => entry.item);
  });
}

function wrapCommandClient(client, mapping) {
  return Object.fromEntries(Object.entries(mapping).map(([name, CommandType]) => [
    name,
    (input) => ({
      promise: () => client.send(new CommandType(input))
    })
  ]));
}

export function createAwsClients(region = process.env.AWS_REGION) {
  const clientConfig = region ? { region } : {};
  const dynamoBaseClient = new DynamoDBClient(clientConfig);
  const dynamoDocumentClient = DynamoDBDocumentClient.from(dynamoBaseClient);

  return {
    AWS: {
      DynamoDB: {
        Converter: {
          unmarshall
        }
      }
    },
    s3: wrapCommandClient(new S3Client(clientConfig), {
      getObject: GetObjectCommand,
      headObject: HeadObjectCommand,
      listObjectsV2: ListObjectsV2Command,
      putObject: PutObjectCommand,
      copyObject: CopyObjectCommand,
      deleteObject: DeleteObjectCommand
    }),
    ssm: wrapCommandClient(new SSMClient(clientConfig), {
      getParameter: GetParameterCommand
    }),
    lambda: wrapCommandClient(new LambdaClient(clientConfig), {
      invoke: InvokeCommand
    }),
    dynamo: wrapCommandClient(dynamoDocumentClient, {
      get: GetCommand,
      query: QueryCommand,
      scan: ScanCommand,
      batchWrite: BatchWriteCommand,
      put: PutCommand,
      delete: DeleteCommand
    }),
    stepFunctions: wrapCommandClient(new SFNClient(clientConfig), {
      startExecution: StartExecutionCommand
    }),
    cloudFront: wrapCommandClient(new CloudFrontClient(clientConfig), {
      createInvalidation: CreateInvalidationCommand
    })
  };
}

export async function loadEnvironmentManifest(ssm, parameterName, environmentName) {
  const response = await ssm.getParameter({ Name: parameterName }).promise();
  const manifest = JSON.parse(response.Parameter.Value);
  const environment = manifest.environments?.[environmentName];
  if (!environment) {
    throw new Error(`Runtime manifest does not contain environment ${environmentName}.`);
  }
  return {
    manifest,
    environment
  };
}

export function decodeS3Key(value) {
  return decodeURIComponent(String(value).replace(/\+/g, " "));
}

async function bodyToUtf8(body) {
  if (typeof body?.transformToString === "function") {
    return body.transformToString("utf8");
  }

  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }

  return String(body ?? "");
}

export function buildCoreConfigFromEnvironment(manifest, environmentName) {
  const environment = manifest.environments[environmentName];
  return {
    project: {
      name: manifest.project.name,
      displayName: manifest.project.displayName
    },
    environments: {
      [environmentName]: {
        name: environment.name,
        awsRegion: environment.awsRegion,
        stackPrefix: environment.stackPrefix,
        certificateArn: "",
        route53HostedZoneId: undefined
      }
    },
    rendering: {
      ...environment.rendering
    },
    variants: Object.fromEntries(Object.entries(environment.variants).map(([variantName, variantConfig]) => [
      variantName,
      {
        name: variantName,
        sourceDir: variantConfig.sourceDir,
        partDir: variantConfig.partDir,
        defaultLanguage: variantConfig.defaultLanguage,
        routing: { ...variantConfig.routing },
        languages: Object.fromEntries(Object.entries(variantConfig.languages).map(([languageCode, languageConfig]) => [
          languageCode,
          {
            code: languageCode,
            baseUrl: languageConfig.baseUrl,
            targetBucket: languageConfig.targetBucket,
            cloudFrontAliases: [...languageConfig.cloudFrontAliases],
            webinyLocale: languageConfig.webinyLocale ?? languageCode
          }
        ]))
      }
    ])),
    aws: {
      codeBuckets: Object.fromEntries(Object.entries(environment.variants).map(([variantName, variantConfig]) => [
        variantName,
        variantConfig.codeBucket
      ])),
      dependencyStore: {
        tableName: environment.tables.dependency
      },
      contentStore: {
        tableName: environment.tables.content,
        contentIdIndexName: environment.tables.contentIdIndexName ?? "contentid"
      },
      invalidationStore: {
        tableName: environment.tables.invalidation,
        debounceSeconds: 60
      },
      lambda: {
        runtime: "nodejs24.x",
        architecture: "arm64"
      }
    },
    integrations: {
      webiny: {
        enabled: environment.integrations.webiny.enabled,
        sourceTableName: environment.integrations.webiny.sourceTableName,
        mirrorTableName: environment.integrations.webiny.mirrorTableName,
        relevantModels: [...environment.integrations.webiny.relevantModels],
        tenant: environment.integrations.webiny.tenant
      },
      sitemap: {
        enabled: environment.integrations.sitemap?.enabled ?? false
      }
    }
  };
}

export class S3TemplateRepository {
  constructor({ s3, environmentManifest, activeVariantName }) {
    this.s3 = s3;
    this.environmentManifest = environmentManifest;
    this.activeVariantName = activeVariantName;
  }

  resolveLogicalKey(key) {
    const normalized = normalizeKey(key);
    const activeVariant = this.environmentManifest.variants[this.activeVariantName];

    if (normalized.startsWith(`${this.activeVariantName}/`)) {
      return {
        bucket: activeVariant.codeBucket,
        objectKey: normalized
      };
    }

    if (normalized.startsWith(`${activeVariant.partDir}/`)) {
      return {
        bucket: activeVariant.codeBucket,
        objectKey: `part/${normalized.slice(activeVariant.partDir.length + 1)}`
      };
    }

    if (normalized.startsWith("part/")) {
      return {
        bucket: activeVariant.codeBucket,
        objectKey: normalized
      };
    }

    return {
      bucket: activeVariant.codeBucket,
      objectKey: normalized
    };
  }

  async get(key) {
    const resolved = this.resolveLogicalKey(key);
    try {
      const response = await this.s3.getObject({
        Bucket: resolved.bucket,
        Key: resolved.objectKey
      }).promise();

      return {
        key: normalizeKey(key),
        body: await bodyToUtf8(response.Body),
        contentType: response.ContentType ?? getContentTypeForPath(resolved.objectKey),
        lastModified: response.LastModified?.toISOString?.()
      };
    } catch (error) {
      const errorCode = error?.name ?? error?.Code ?? error?.code;
      if (errorCode === "NoSuchKey" || errorCode === "NoSuchBucket") {
        return null;
      }
      throw error;
    }
  }

  async listVariantEntries(variantName) {
    const variant = this.environmentManifest.variants[variantName];
    const entries = [];
    let continuationToken;

    do {
      const response = await this.s3.listObjectsV2({
        Bucket: variant.codeBucket,
        Prefix: `${variantName}/`,
        ContinuationToken: continuationToken
      }).promise();

      for (const item of response.Contents ?? []) {
        if (!item.Key.endsWith("/")) {
          entries.push({
            key: item.Key,
            body: null,
            contentType: getContentTypeForPath(item.Key),
            lastModified: item.LastModified?.toISOString?.()
          });
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return entries;
  }

  async exists(key) {
    const resolved = this.resolveLogicalKey(key);
    try {
      await this.s3.headObject({
        Bucket: resolved.bucket,
        Key: resolved.objectKey
      }).promise();
      return true;
    } catch {
      return false;
    }
  }
}

export class DynamoContentRepository {
  constructor({ dynamo, tableName, indexName, languageLocaleMap = {} }) {
    this.dynamo = dynamo;
    this.tableName = tableName;
    this.indexName = indexName;
    this.languageLocaleMap = languageLocaleMap;
  }

  async getByContentId(contentId, language) {
    const response = await this.dynamo.query({
      TableName: this.tableName,
      IndexName: this.indexName,
      KeyConditionExpression: "contentId = :contentId",
      ExpressionAttributeValues: {
        ":contentId": contentId
      }
    }).promise();
    const items = response.Items ?? [];
    const candidates = items
      .map((item) => ({
        item,
        score: localeMatchScore(item.locale, language, this.languageLocaleMap)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || String(left.item.id).localeCompare(String(right.item.id)));
    return candidates[0]?.item ?? null;
  }

  async query(query, language) {
    let lastEvaluatedKey;
    const items = [];

    do {
      const response = await this.dynamo.scan({
        TableName: this.tableName,
        ExclusiveStartKey: lastEvaluatedKey
      }).promise();
      items.push(...(response.Items ?? []));
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return applyContentQuery(filterItemsByRequestedLocale(items, language, this.languageLocaleMap), query);
  }
}

export class DynamoDependencyStore {
  constructor({ dynamo, tableName }) {
    this.dynamo = dynamo;
    this.tableName = tableName;
  }

  async queryBySourceId(sourceId) {
    const response = await this.dynamo.query({
      TableName: this.tableName,
      KeyConditionExpression: "sourceId = :sourceId",
      ExpressionAttributeValues: {
        ":sourceId": sourceId
      }
    }).promise();
    return response.Items ?? [];
  }

  async batchWrite(requests) {
    for (const batch of chunk(requests, 25)) {
      await this.dynamo.batchWrite({
        RequestItems: {
          [this.tableName]: batch
        }
      }).promise();
    }
  }

  async replaceSourceDependencies(record) {
    const existing = await this.queryBySourceId(record.sourceId);
    if (existing.length > 0) {
      await this.batchWrite(existing.map((item) => ({
        DeleteRequest: {
          Key: {
            sourceId: item.sourceId,
            dependencyKey: item.dependencyKey
          }
        }
      })));
    }

    if (!record.dependencies || record.dependencies.length === 0) {
      return;
    }

    await this.batchWrite(record.dependencies.map((dependency) => ({
      PutRequest: {
        Item: {
          sourceId: record.sourceId,
          dependencyKey: `${dependency.kind}#${dependency.id}`,
          templateKey: record.templateKey,
          outputKey: record.outputKey,
          environment: record.environment,
          variant: record.variant,
          language: record.language
        }
      }
    })));
  }

  async findDependentsByDependency(ref) {
    const response = await this.dynamo.query({
      TableName: this.tableName,
      IndexName: "dependencyKey-index",
      KeyConditionExpression: "dependencyKey = :dependencyKey",
      ExpressionAttributeValues: {
        ":dependencyKey": `${ref.kind}#${ref.id}`
      }
    }).promise();

    const grouped = new Map();
    for (const item of response.Items ?? []) {
      if (!grouped.has(item.sourceId)) {
        grouped.set(item.sourceId, {
          sourceId: item.sourceId,
          environment: item.environment,
          variant: item.variant,
          language: item.language,
          templateKey: item.templateKey,
          outputKey: item.outputKey,
          dependencies: []
        });
      }
      grouped.get(item.sourceId).dependencies.push({
        kind: item.dependencyKey.split("#")[0],
        id: item.dependencyKey.split("#").slice(1).join("#")
      });
    }

    return [...grouped.values()];
  }

  async findGeneratedOutputsByTemplate(templateKey, scope) {
    const response = await this.dynamo.query({
      TableName: this.tableName,
      IndexName: "dependencyKey-index",
      KeyConditionExpression: "dependencyKey = :dependencyKey",
      ExpressionAttributeValues: {
        ":dependencyKey": `generated-template#${templateKey}`
      }
    }).promise();

    return (response.Items ?? [])
      .filter((item) => item.environment === scope.environment
        && item.variant === scope.variant
        && item.language === scope.language)
      .map((item) => ({
        environment: item.environment,
        variant: item.variant,
        language: item.language,
        templateKey: item.templateKey,
        outputKey: item.outputKey
      }));
  }

  async deleteOutput(output) {
    const sourceId = buildSourceId(output.environment, output.variant, output.language, output.outputKey);
    const existing = await this.queryBySourceId(sourceId);
    if (existing.length === 0) {
      return;
    }
    await this.batchWrite(existing.map((item) => ({
      DeleteRequest: {
        Key: {
          sourceId: item.sourceId,
          dependencyKey: item.dependencyKey
        }
      }
    })));
  }
}

export class S3OutputPublisher {
  constructor({ s3, environmentManifest }) {
    this.s3 = s3;
    this.environmentManifest = environmentManifest;
  }

  resolveTargetBucket(target) {
    return this.environmentManifest.variants[target.variant].languages[target.language].targetBucket;
  }

  async put(artifact, target) {
    await this.s3.putObject({
      Bucket: this.resolveTargetBucket(target),
      Key: artifact.outputKey,
      Body: artifact.body,
      ContentType: artifact.contentType,
      CacheControl: artifact.cacheControl
    }).promise();
  }

  async copySourceObject(sourceKey, target) {
    const sourceBucket = this.environmentManifest.variants[target.variant].codeBucket;
    const encodedSource = `${sourceBucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`;
    await this.s3.copyObject({
      Bucket: this.resolveTargetBucket(target),
      Key: target.outputKey,
      CopySource: encodedSource
    }).promise();
  }

  async delete(outputKey, target) {
    await this.s3.deleteObject({
      Bucket: this.resolveTargetBucket(target),
      Key: outputKey
    }).promise();
  }
}

export class LambdaInvalidationScheduler {
  constructor({ lambda, functionName }) {
    this.lambda = lambda;
    this.functionName = functionName;
  }

  async enqueue(request) {
    if (!request.distributionId) {
      return;
    }
    await this.lambda.invoke({
      FunctionName: this.functionName,
      InvocationType: "Event",
      Payload: JSON.stringify(request)
    }).promise();
  }
}

export function buildInvalidationRequest(environmentName, environmentManifest, variantName, languageCode, buildId, paths = ["/*"]) {
  const language = environmentManifest.variants[variantName].languages[languageCode];
  return {
    buildId,
    environment: environmentName,
    variant: variantName,
    language: languageCode,
    distributionId: language.distributionId,
    distributionAliases: [...language.cloudFrontAliases],
    paths,
    requestedAt: new Date().toISOString()
  };
}

export function isRenderableBucketKey(environmentManifest, variantName, key, renderExtensions) {
  if (key.startsWith("part/")) {
    return true;
  }

  if (!key.startsWith(`${variantName}/`)) {
    return false;
  }

  const extension = path.extname(key).toLowerCase();
  return renderExtensions.includes(extension);
}

function defaultDeleteOutputKey(variantName, sourceKey) {
  if (!sourceKey.startsWith(`${variantName}/`)) {
    return sourceKey;
  }
  return sourceKey.slice(variantName.length + 1);
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.variant}#${target.language}#${target.sourceKey}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function resolveRenderTargetsForEvent({
  event,
  manifest,
  environmentName,
  environmentManifest,
  dependencyStore,
  templateRepositoryFactory
}) {
  const coreConfig = buildCoreConfigFromEnvironment(manifest, environmentName);

  if (event.type === "manual-build") {
    const variants = event.variant ? [event.variant] : Object.keys(environmentManifest.variants);
    const targets = [];
    for (const variantName of variants) {
      const templateRepository = templateRepositoryFactory(variantName);
      const templateEntries = await templateRepository.listVariantEntries(variantName);
      targets.push(...createManualRenderTargets({
        config: coreConfig,
        templateEntries,
        environment: environmentName,
        variant: variantName,
        language: event.language,
        entry: event.sourceKey
      }));
    }
    return uniqueTargets(targets);
  }

  if (event.type === "content-item") {
    const targets = [];
    for (const variantName of Object.keys(environmentManifest.variants)) {
      const templateRepository = templateRepositoryFactory(variantName);
      const templateEntries = await templateRepository.listVariantEntries(variantName);
      targets.push(...createManualRenderTargets({
        config: coreConfig,
        templateEntries,
        environment: environmentName,
        variant: variantName
      }));
    }
    return uniqueTargets(targets);
  }

  if (event.type === "source-object" && event.key.startsWith("part/")) {
    const dependencyId = event.key.slice("part/".length);
    const dependentRecords = await dependencyStore.findDependentsByDependency({
      kind: "partial",
      id: dependencyId
    });

    if (dependentRecords.length === 0) {
      const templateRepository = templateRepositoryFactory(event.variant);
      const templateEntries = await templateRepository.listVariantEntries(event.variant);
      return createManualRenderTargets({
        config: coreConfig,
        templateEntries,
        environment: environmentName,
        variant: event.variant
      });
    }

    return uniqueTargets(dependentRecords
      .filter((record) => record.environment === environmentName && record.variant === event.variant)
      .map((record) => ({
        environment: environmentName,
        variant: record.variant,
        language: record.language,
        sourceKey: record.templateKey,
        outputKey: defaultDeleteOutputKey(record.variant, record.templateKey),
        baseUrl: environmentManifest.variants[record.variant].languages[record.language].baseUrl
      })));
  }

  if (event.type === "source-object") {
    return uniqueTargets(Object.keys(environmentManifest.variants[event.variant].languages).map((languageCode) => ({
      environment: environmentName,
      variant: event.variant,
      language: languageCode,
      sourceKey: event.key,
      outputKey: defaultDeleteOutputKey(event.variant, event.key),
      baseUrl: environmentManifest.variants[event.variant].languages[languageCode].baseUrl
    })));
  }

  return [];
}

export async function deleteOutputsForTemplate({
  event,
  environmentName,
  environmentManifest,
  dependencyStore,
  publisher,
  invalidationScheduler,
  buildId
}) {
  const languages = Object.keys(environmentManifest.variants[event.variant].languages);
  const deletedOutputs = [];

  for (const languageCode of languages) {
    const generated = await dependencyStore.findGeneratedOutputsByTemplate(event.key, {
      environment: environmentName,
      variant: event.variant,
      language: languageCode
    });
    const outputs = generated.length > 0 ? generated : [{
      environment: environmentName,
      variant: event.variant,
      language: languageCode,
      templateKey: event.key,
      outputKey: defaultDeleteOutputKey(event.variant, event.key)
    }];

    for (const output of outputs) {
      await publisher.delete(output.outputKey, {
        environment: environmentName,
        variant: event.variant,
        language: languageCode,
        sourceKey: event.key,
        outputKey: output.outputKey,
        baseUrl: environmentManifest.variants[event.variant].languages[languageCode].baseUrl
      });
      await dependencyStore.deleteOutput(output);
      await invalidationScheduler.enqueue(buildInvalidationRequest(
        environmentName,
        environmentManifest,
        event.variant,
        languageCode,
        buildId
      ));
      deletedOutputs.push(output.outputKey);
    }
  }

  return deletedOutputs;
}

export async function renderAndPublishTargets({
  manifest,
  environmentName,
  environmentManifest,
  contentRepository,
  dependencyStore,
  publisher,
  invalidationScheduler,
  targets,
  buildId
}) {
  const coreConfig = buildCoreConfigFromEnvironment(manifest, environmentName);
  const rendered = [];
  const deleted = [];
  const warnings = [];

  for (const target of targets) {
    const templateRepository = new S3TemplateRepository({
      s3: publisher.s3,
      environmentManifest,
      activeVariantName: target.variant
    });

    const previousOutputs = await dependencyStore.findGeneratedOutputsByTemplate(target.sourceKey, {
      environment: environmentName,
      variant: target.variant,
      language: target.language
    });

    const results = await renderSourceTemplate({
      config: coreConfig,
      templateRepository,
      contentRepository,
      environment: environmentName,
      variantName: target.variant,
      languageCode: target.language,
      sourceKey: target.sourceKey
    });

    const nextOutputKeys = new Set();

    for (const result of results) {
      nextOutputKeys.add(result.artifact.outputKey);
      await publisher.put(result.artifact, result.target);
      await dependencyStore.replaceSourceDependencies({
        sourceId: buildSourceId(environmentName, result.target.variant, result.target.language, result.artifact.outputKey),
        environment: environmentName,
        variant: result.target.variant,
        language: result.target.language,
        templateKey: target.sourceKey,
        outputKey: result.artifact.outputKey,
        dependencies: result.dependencies
      });
      await invalidationScheduler.enqueue(buildInvalidationRequest(
        environmentName,
        environmentManifest,
        result.target.variant,
        result.target.language,
        buildId,
        result.invalidationPaths
      ));
      warnings.push(...result.warnings);
      rendered.push(result.artifact.outputKey);
    }

    for (const previousOutput of previousOutputs) {
      if (nextOutputKeys.has(previousOutput.outputKey)) {
        continue;
      }
      await publisher.delete(previousOutput.outputKey, {
        environment: environmentName,
        variant: previousOutput.variant,
        language: previousOutput.language,
        sourceKey: previousOutput.templateKey,
        outputKey: previousOutput.outputKey,
        baseUrl: environmentManifest.variants[previousOutput.variant].languages[previousOutput.language].baseUrl
      });
      await dependencyStore.deleteOutput(previousOutput);
      await invalidationScheduler.enqueue(buildInvalidationRequest(
        environmentName,
        environmentManifest,
        previousOutput.variant,
        previousOutput.language,
        buildId
      ));
      deleted.push(previousOutput.outputKey);
    }
  }

  return { rendered, deleted, warnings };
}

export function createRepositoriesAndPublishers({ clients, environmentManifest }) {
  const languageLocaleMap = Object.fromEntries(Object.entries(environmentManifest.variants).flatMap(([, variantConfig]) => (
    Object.entries(variantConfig.languages).map(([languageCode, languageConfig]) => [
      languageCode,
      languageConfig.webinyLocale ?? languageCode
    ])
  )));

  return {
    contentRepository: new DynamoContentRepository({
      dynamo: clients.dynamo,
      tableName: environmentManifest.tables.content,
      indexName: environmentManifest.tables.contentIdIndexName ?? "contentid",
      languageLocaleMap
    }),
    dependencyStore: new DynamoDependencyStore({
      dynamo: clients.dynamo,
      tableName: environmentManifest.tables.dependency
    }),
    publisher: new S3OutputPublisher({
      s3: clients.s3,
      environmentManifest
    }),
    invalidationScheduler: new LambdaInvalidationScheduler({
      lambda: clients.lambda,
      functionName: environmentManifest.functions.invalidationScheduler
    })
  };
}

export async function invokeLambdaEvent(lambda, functionName, payload) {
  await lambda.invoke({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: JSON.stringify(payload)
  }).promise();
}

export function createBuildId(prefix = "build") {
  return `${prefix}-${Date.now()}`;
}
