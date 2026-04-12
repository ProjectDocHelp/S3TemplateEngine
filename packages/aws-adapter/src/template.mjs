import {
  buildEnvironmentRuntimeConfig
} from "../../core/src/index.mjs";

function cfName(...parts) {
  return parts.join("");
}

function sanitizeLogicalId(value) {
  return value.replace(/[^A-Za-z0-9]/g, "");
}

function websiteEndpoint(bucketNameExpression) {
  return {
    "Fn::Join": [
      "",
      [
        bucketNameExpression,
        ".s3-website-",
        { Ref: "AWS::Region" },
        ".amazonaws.com"
      ]
    ]
  };
}

function handlerPath(name) {
  return `packages/aws-adapter/src/runtime/${name}.handler`;
}

function lambdaCode(keyParameter) {
  return {
    S3Bucket: { Ref: "ArtifactBucket" },
    S3Key: { Ref: keyParameter }
  };
}

function buildSitemapNotificationConfigurations(functionLogicalId) {
  const suffixes = [".html", ".htm"];
  const events = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"];

  return events.flatMap((eventName) => suffixes.map((suffix) => ({
    Event: eventName,
    Function: { "Fn::GetAtt": [functionLogicalId, "Arn"] },
    Filter: {
      S3Key: {
        Rules: [
          {
            Name: "suffix",
            Value: suffix
          }
        ]
      }
    }
  })));
}

function lambdaRuntimeProperties(runtimeConfig, roleRef, name, keyParameter, handlerName, extra = {}) {
  return {
    Type: "AWS::Lambda::Function",
    Properties: {
      FunctionName: name,
      Role: { "Fn::GetAtt": [roleRef, "Arn"] },
      Runtime: runtimeConfig.lambda.runtime,
      Handler: handlerPath(handlerName),
      Architectures: [runtimeConfig.lambda.architecture],
      Code: lambdaCode(keyParameter),
      ...extra
    }
  };
}

function buildFunctionNames(runtimeConfig) {
  return {
    sourceDispatcher: `${runtimeConfig.stackPrefix}_s3te_source_dispatcher`,
    renderWorker: `${runtimeConfig.stackPrefix}_s3te_render_worker`,
    invalidationScheduler: `${runtimeConfig.stackPrefix}_s3te_invalidation_scheduler`,
    invalidationExecutor: `${runtimeConfig.stackPrefix}_s3te_invalidation_executor`,
    contentMirror: `${runtimeConfig.stackPrefix}_s3te_content_mirror`,
    sitemapUpdater: `${runtimeConfig.stackPrefix}_s3te_sitemap_updater`
  };
}

function createExecutionRole(roleName) {
  return {
    Type: "AWS::IAM::Role",
    Properties: {
      RoleName: roleName,
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: ["lambda.amazonaws.com"]
            },
            Action: ["sts:AssumeRole"]
          }
        ]
      },
      ManagedPolicyArns: [
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
      ],
      Policies: [
        {
          PolicyName: `${roleName}_access`,
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "ssm:GetParameter",
                  "ssm:PutParameter",
                  "s3:GetObject",
                  "s3:PutObject",
                  "s3:DeleteObject",
                  "s3:ListBucket",
                  "dynamodb:BatchWriteItem",
                  "dynamodb:DeleteItem",
                  "dynamodb:GetItem",
                  "dynamodb:PutItem",
                  "dynamodb:Query",
                  "dynamodb:Scan",
                  "dynamodb:UpdateItem",
                  "lambda:InvokeFunction",
                  "states:StartExecution",
                  "cloudfront:CreateInvalidation"
                ],
                Resource: "*"
              }
            ]
          }
        }
      ]
    }
  };
}

export function buildCloudFormationTemplate({ config, environment, features = [] }) {
  const runtimeConfig = buildEnvironmentRuntimeConfig(config, environment);
  const resources = {};
  const outputs = {};
  const featureSet = new Set(features);

  const functionNames = buildFunctionNames(runtimeConfig);

  const parameters = {
    ArtifactBucket: {
      Type: "String"
    },
    SourceDispatcherArtifactKey: {
      Type: "String"
    },
    RenderWorkerArtifactKey: {
      Type: "String"
    },
    InvalidationSchedulerArtifactKey: {
      Type: "String"
    },
    InvalidationExecutorArtifactKey: {
      Type: "String"
    },
    SitemapUpdaterArtifactKey: {
      Type: "String",
      Default: ""
    },
    RuntimeManifestValue: {
      Type: "String",
      Default: "{}"
    }
  };

  resources.ExecutionRole = createExecutionRole(`${runtimeConfig.stackPrefix}_s3te_lambda_runtime`);

  resources.DependencyTable = {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: runtimeConfig.tables.dependency,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "sourceId", AttributeType: "S" },
        { AttributeName: "dependencyKey", AttributeType: "S" }
      ],
      KeySchema: [
        { AttributeName: "sourceId", KeyType: "HASH" },
        { AttributeName: "dependencyKey", KeyType: "RANGE" }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "dependencyKey-index",
          KeySchema: [
            { AttributeName: "dependencyKey", KeyType: "HASH" },
            { AttributeName: "sourceId", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        }
      ]
    }
  };

  resources.ContentTable = {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: runtimeConfig.tables.content,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" },
        { AttributeName: "contentId", AttributeType: "S" }
      ],
      KeySchema: [
        { AttributeName: "id", KeyType: "HASH" }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: config.aws.contentStore.contentIdIndexName,
          KeySchema: [
            { AttributeName: "contentId", KeyType: "HASH" }
          ],
          Projection: { ProjectionType: "ALL" }
        }
      ]
    }
  };

  resources.InvalidationTable = {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: runtimeConfig.tables.invalidation,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "distributionId", AttributeType: "S" },
        { AttributeName: "requestId", AttributeType: "S" }
      ],
      KeySchema: [
        { AttributeName: "distributionId", KeyType: "HASH" },
        { AttributeName: "requestId", KeyType: "RANGE" }
      ]
    }
  };

  resources.RuntimeManifestParameter = {
    Type: "AWS::SSM::Parameter",
    Properties: {
      Name: runtimeConfig.runtimeParameterName,
      Type: "String",
      Tier: "Advanced",
      Value: { Ref: "RuntimeManifestValue" }
    }
  };

  resources.InvalidationExecutor = lambdaRuntimeProperties(
    runtimeConfig,
    "ExecutionRole",
    functionNames.invalidationExecutor,
    "InvalidationExecutorArtifactKey",
    "invalidation-executor",
    {
      Timeout: 300,
      Environment: {
        Variables: {
          S3TE_ENVIRONMENT: environment,
          S3TE_INVALIDATION_TABLE: runtimeConfig.tables.invalidation
        }
      }
    }
  );

  resources.InvalidationStateMachine = {
    Type: "AWS::StepFunctions::StateMachine",
    Properties: {
      StateMachineName: `${runtimeConfig.stackPrefix}_s3te_invalidation`,
      RoleArn: { "Fn::GetAtt": ["ExecutionRole", "Arn"] },
      DefinitionString: JSON.stringify({
        Comment: "S3TE invalidation debounce state machine",
        StartAt: "Wait",
        States: {
          Wait: {
            Type: "Wait",
            Seconds: config.aws.invalidationStore.debounceSeconds,
            Next: "RunExecutor"
          },
          RunExecutor: {
            Type: "Task",
            Resource: "arn:aws:states:::lambda:invoke",
            Parameters: {
              FunctionName: "${InvalidationExecutorArn}",
              "Payload.$": "$"
            },
            End: true
          }
        }
      }),
      DefinitionSubstitutions: {
        InvalidationExecutorArn: { "Fn::GetAtt": ["InvalidationExecutor", "Arn"] }
      }
    }
  };

  resources.InvalidationScheduler = lambdaRuntimeProperties(
    runtimeConfig,
    "ExecutionRole",
    functionNames.invalidationScheduler,
    "InvalidationSchedulerArtifactKey",
    "invalidation-scheduler",
    {
      Timeout: 300,
      Environment: {
        Variables: {
          S3TE_ENVIRONMENT: environment,
          S3TE_INVALIDATION_TABLE: runtimeConfig.tables.invalidation,
          S3TE_DEBOUNCE_SECONDS: String(config.aws.invalidationStore.debounceSeconds),
          S3TE_INVALIDATION_STATE_MACHINE_ARN: { Ref: "InvalidationStateMachine" }
        }
      }
    }
  );

  resources.RenderWorker = lambdaRuntimeProperties(
    runtimeConfig,
    "ExecutionRole",
    functionNames.renderWorker,
    "RenderWorkerArtifactKey",
    "render-worker",
    {
      Timeout: 900,
      MemorySize: 1024,
      Environment: {
        Variables: {
          S3TE_ENVIRONMENT: environment,
          S3TE_RUNTIME_PARAMETER: runtimeConfig.runtimeParameterName,
          S3TE_DEPENDENCY_TABLE: runtimeConfig.tables.dependency,
          S3TE_CONTENT_TABLE: runtimeConfig.tables.content,
          S3TE_INVALIDATION_SCHEDULER_NAME: functionNames.invalidationScheduler
        }
      }
    }
  );

  resources.SourceDispatcher = lambdaRuntimeProperties(
    runtimeConfig,
    "ExecutionRole",
    functionNames.sourceDispatcher,
    "SourceDispatcherArtifactKey",
    "source-dispatcher",
    {
      Timeout: 300,
      MemorySize: 512,
      Environment: {
        Variables: {
          S3TE_ENVIRONMENT: environment,
          S3TE_RUNTIME_PARAMETER: runtimeConfig.runtimeParameterName,
          S3TE_RENDER_WORKER_NAME: functionNames.renderWorker,
          S3TE_RENDER_EXTENSIONS: runtimeConfig.rendering.renderExtensions.join(",")
        }
      }
    }
  );

  if (featureSet.has("sitemap") && runtimeConfig.integrations.sitemap.enabled) {
    resources.SitemapUpdater = lambdaRuntimeProperties(
      runtimeConfig,
      "ExecutionRole",
      functionNames.sitemapUpdater,
      "SitemapUpdaterArtifactKey",
      "sitemap-updater",
      {
        Timeout: 300,
        MemorySize: 512,
        Environment: {
          Variables: {
            S3TE_ENVIRONMENT: environment,
            S3TE_RUNTIME_PARAMETER: runtimeConfig.runtimeParameterName
          }
        }
      }
    );
  }

  outputs.StackName = { Value: runtimeConfig.stackName };
  outputs.RuntimeManifestParameterName = {
    Value: runtimeConfig.runtimeParameterName
  };
  outputs.DependencyTableName = { Value: runtimeConfig.tables.dependency };
  outputs.ContentTableName = { Value: runtimeConfig.tables.content };
  outputs.InvalidationTableName = { Value: runtimeConfig.tables.invalidation };
  outputs.SourceDispatcherFunctionName = { Value: functionNames.sourceDispatcher };
  outputs.RenderWorkerFunctionName = { Value: functionNames.renderWorker };
  outputs.InvalidationSchedulerFunctionName = { Value: functionNames.invalidationScheduler };
  outputs.InvalidationExecutorFunctionName = { Value: functionNames.invalidationExecutor };

  if (resources.SitemapUpdater) {
    outputs.SitemapUpdaterFunctionName = { Value: functionNames.sitemapUpdater };
  }

  for (const [variantName, variantConfig] of Object.entries(runtimeConfig.variants)) {
    const codeBucketLogicalId = cfName(sanitizeLogicalId(variantName), "CodeBucket");
    resources[codeBucketLogicalId] = {
      Type: "AWS::S3::Bucket",
      DependsOn: ["SourceDispatcherPermission"],
      Properties: {
        BucketName: variantConfig.codeBucket,
        NotificationConfiguration: {
          LambdaConfigurations: [
            {
              Event: "s3:ObjectCreated:*",
              Function: { "Fn::GetAtt": ["SourceDispatcher", "Arn"] }
            },
            {
              Event: "s3:ObjectRemoved:*",
              Function: { "Fn::GetAtt": ["SourceDispatcher", "Arn"] }
            }
          ]
        }
      }
    };
    outputs[`${codeBucketLogicalId}Name`] = { Value: { Ref: codeBucketLogicalId } };

    for (const [languageCode, languageConfig] of Object.entries(variantConfig.languages)) {
      const suffix = sanitizeLogicalId(`${variantName}${languageCode}`);
      const outputBucketLogicalId = `${suffix}OutputBucket`;
      const distributionLogicalId = `${suffix}Distribution`;
      const bucketPolicyLogicalId = `${suffix}OutputBucketPolicy`;
      const websiteOriginId = `${suffix}Origin`;

      resources[outputBucketLogicalId] = {
        Type: "AWS::S3::Bucket",
        ...(resources.SitemapUpdater ? { DependsOn: ["SitemapUpdaterPermission"] } : {}),
        Properties: {
          BucketName: languageConfig.targetBucket,
          WebsiteConfiguration: {
            IndexDocument: variantConfig.routing.indexDocument,
            ErrorDocument: variantConfig.routing.notFoundDocument
          },
          ...(resources.SitemapUpdater
            ? {
                NotificationConfiguration: {
                  LambdaConfigurations: buildSitemapNotificationConfigurations("SitemapUpdater")
                }
              }
            : {}),
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: false,
            BlockPublicPolicy: false,
            IgnorePublicAcls: false,
            RestrictPublicBuckets: false
          }
        }
      };

      resources[bucketPolicyLogicalId] = {
        Type: "AWS::S3::BucketPolicy",
        Properties: {
          Bucket: { Ref: outputBucketLogicalId },
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: "*",
                Action: ["s3:GetObject"],
                Resource: {
                  "Fn::Join": [
                    "",
                    ["arn:aws:s3:::", { Ref: outputBucketLogicalId }, "/*"]
                  ]
                }
              }
            ]
          }
        }
      };

      resources[distributionLogicalId] = {
        Type: "AWS::CloudFront::Distribution",
        Properties: {
          DistributionConfig: {
            Enabled: true,
            Aliases: languageConfig.cloudFrontAliases,
            DefaultRootObject: variantConfig.routing.indexDocument,
            HttpVersion: "http2",
            IPV6Enabled: true,
            Origins: [
              {
                Id: websiteOriginId,
                DomainName: websiteEndpoint({ Ref: outputBucketLogicalId }),
                CustomOriginConfig: {
                  HTTPPort: 80,
                  HTTPSPort: 443,
                  OriginProtocolPolicy: "http-only"
                }
              }
            ],
            DefaultCacheBehavior: {
              TargetOriginId: websiteOriginId,
              ViewerProtocolPolicy: "redirect-to-https",
              AllowedMethods: ["GET", "HEAD"],
              CachedMethods: ["GET", "HEAD"],
              Compress: true,
              ForwardedValues: {
                QueryString: false,
                Cookies: { Forward: "none" }
              }
            },
            ViewerCertificate: {
              AcmCertificateArn: runtimeConfig.certificateArn,
              SslSupportMethod: "sni-only",
              MinimumProtocolVersion: "TLSv1.2_2021"
            }
          }
        }
      };

      outputs[`${outputBucketLogicalId}Name`] = { Value: { Ref: outputBucketLogicalId } };
      outputs[`${distributionLogicalId}Id`] = { Value: { Ref: distributionLogicalId } };
      outputs[`${distributionLogicalId}Domain`] = { Value: { "Fn::GetAtt": [distributionLogicalId, "DomainName"] } };

      if (runtimeConfig.route53HostedZoneId) {
        for (const alias of languageConfig.cloudFrontAliases) {
          const aliasSuffix = sanitizeLogicalId(alias);
          const aRecordLogicalId = `${distributionLogicalId}${aliasSuffix}ARecord`;
          const aaaaRecordLogicalId = `${distributionLogicalId}${aliasSuffix}AAAARecord`;

          resources[aRecordLogicalId] = {
            Type: "AWS::Route53::RecordSet",
            Properties: {
              HostedZoneId: runtimeConfig.route53HostedZoneId,
              Name: alias,
              Type: "A",
              AliasTarget: {
                DNSName: { "Fn::GetAtt": [distributionLogicalId, "DomainName"] },
                HostedZoneId: "Z2FDTNDATAQYW2"
              }
            }
          };

          resources[aaaaRecordLogicalId] = {
            Type: "AWS::Route53::RecordSet",
            Properties: {
              HostedZoneId: runtimeConfig.route53HostedZoneId,
              Name: alias,
              Type: "AAAA",
              AliasTarget: {
                DNSName: { "Fn::GetAtt": [distributionLogicalId, "DomainName"] },
                HostedZoneId: "Z2FDTNDATAQYW2"
              }
            }
          };
        }
      }
    }
  }

  resources.SourceDispatcherPermission = {
    Type: "AWS::Lambda::Permission",
    Properties: {
      Action: "lambda:InvokeFunction",
      FunctionName: { Ref: "SourceDispatcher" },
      Principal: "s3.amazonaws.com"
    }
  };

  if (resources.SitemapUpdater) {
    resources.SitemapUpdaterPermission = {
      Type: "AWS::Lambda::Permission",
      Properties: {
        Action: "lambda:InvokeFunction",
        FunctionName: { Ref: "SitemapUpdater" },
        Principal: "s3.amazonaws.com"
      }
    };
  }

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `S3TE environment stack for ${config.project.name} (${environment})`,
    Parameters: parameters,
    Resources: resources,
    Outputs: outputs
  };
}

export function buildWebinyCloudFormationTemplate({ config, environment }) {
  const runtimeConfig = buildEnvironmentRuntimeConfig(config, environment);
  const functionNames = buildFunctionNames(runtimeConfig);

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `S3TE Webiny option stack for ${config.project.name} (${environment})`,
    Parameters: {
      ArtifactBucket: {
        Type: "String"
      },
      ContentMirrorArtifactKey: {
        Type: "String"
      },
      WebinySourceTableStreamArn: {
        Type: "String"
      }
    },
    Resources: {
      ExecutionRole: createExecutionRole(`${runtimeConfig.stackPrefix}_s3te_webiny_lambda_runtime`),
      ContentMirror: lambdaRuntimeProperties(
        runtimeConfig,
        "ExecutionRole",
        functionNames.contentMirror,
        "ContentMirrorArtifactKey",
        "content-mirror",
        {
          Timeout: 300,
          MemorySize: 512,
          Environment: {
            Variables: {
              S3TE_ENVIRONMENT: environment,
              S3TE_CONTENT_TABLE: runtimeConfig.tables.content,
              S3TE_RELEVANT_MODELS: runtimeConfig.integrations.webiny.relevantModels.join(","),
              S3TE_WEBINY_TENANT: runtimeConfig.integrations.webiny.tenant ?? "",
              S3TE_RENDER_WORKER_NAME: functionNames.renderWorker
            }
          }
        }
      ),
      ContentMirrorEventSourceMapping: {
        Type: "AWS::Lambda::EventSourceMapping",
        Properties: {
          BatchSize: 10,
          StartingPosition: "LATEST",
          EventSourceArn: { Ref: "WebinySourceTableStreamArn" },
          FunctionName: { Ref: "ContentMirror" }
        }
      }
    },
    Outputs: {
      ContentMirrorFunctionName: {
        Value: functionNames.contentMirror
      }
    }
  };
}

export function buildTemporaryDeployStackTemplate() {
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Temporary S3TE packaging stack for Lambda deployment artifacts",
    Resources: {
      ArtifactBucket: {
        Type: "AWS::S3::Bucket",
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
        Properties: {
          VersioningConfiguration: {
            Status: "Suspended"
          }
        }
      }
    },
    Outputs: {
      ArtifactBucketName: {
        Value: { Ref: "ArtifactBucket" }
      }
    }
  };
}
