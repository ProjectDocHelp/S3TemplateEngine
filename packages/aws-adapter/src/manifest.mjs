import {
  buildEnvironmentRuntimeConfig
} from "../../core/src/index.mjs";

function sanitizeLogicalId(value) {
  return value.replace(/[^A-Za-z0-9]/g, "");
}

function buildDistributionOutputMaps(config, environment, stackOutputs) {
  const distributionIds = {};
  const distributionDomains = {};

  for (const variantName of Object.keys(config.variants)) {
    distributionIds[variantName] = {};
    distributionDomains[variantName] = {};

    for (const languageCode of Object.keys(config.variants[variantName].languages)) {
      const suffix = sanitizeLogicalId(`${variantName}${languageCode}`);
      distributionIds[variantName][languageCode] = stackOutputs[`${suffix}DistributionId`] ?? "";
      distributionDomains[variantName][languageCode] = stackOutputs[`${suffix}DistributionDomain`] ?? "";
    }
  }

  return { distributionIds, distributionDomains };
}

function buildFunctionNames(runtimeConfig) {
  return {
    sourceDispatcher: `${runtimeConfig.stackPrefix}_s3te_source_dispatcher`,
    renderWorker: `${runtimeConfig.stackPrefix}_s3te_render_worker`,
    invalidationScheduler: `${runtimeConfig.stackPrefix}_s3te_invalidation_scheduler`,
    invalidationExecutor: `${runtimeConfig.stackPrefix}_s3te_invalidation_executor`,
    contentMirror: runtimeConfig.integrations.webiny.enabled ? `${runtimeConfig.stackPrefix}_s3te_content_mirror` : ""
  };
}

export function extractStackOutputsMap(stackDescription) {
  const outputs = {};
  for (const output of stackDescription?.Outputs ?? []) {
    outputs[output.OutputKey] = output.OutputValue;
  }
  return outputs;
}

export function buildAwsRuntimeManifest({ config, environment, stackOutputs = {} }) {
  const outputMaps = buildDistributionOutputMaps(config, environment, stackOutputs);
  const runtimeConfig = buildEnvironmentRuntimeConfig(config, environment, outputMaps);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    project: {
      name: config.project.name,
      displayName: config.project.displayName
    },
    environments: {
      [environment]: {
        name: runtimeConfig.name,
        awsRegion: runtimeConfig.awsRegion,
        stackPrefix: runtimeConfig.stackPrefix,
        stackName: runtimeConfig.stackName,
        runtimeParameterName: runtimeConfig.runtimeParameterName,
        rendering: {
          minifyHtml: runtimeConfig.rendering.minifyHtml,
          renderExtensions: [...runtimeConfig.rendering.renderExtensions],
          maxRenderDepth: runtimeConfig.rendering.maxRenderDepth
        },
        tables: {
          dependency: runtimeConfig.tables.dependency,
          content: runtimeConfig.tables.content,
          contentIdIndexName: config.aws.contentStore.contentIdIndexName,
          invalidation: runtimeConfig.tables.invalidation
        },
        functions: buildFunctionNames(runtimeConfig),
        integrations: {
          webiny: {
            enabled: runtimeConfig.integrations.webiny.enabled,
            sourceTableName: runtimeConfig.integrations.webiny.sourceTableName,
            mirrorTableName: runtimeConfig.integrations.webiny.mirrorTableName,
            relevantModels: [...runtimeConfig.integrations.webiny.relevantModels],
            tenant: runtimeConfig.integrations.webiny.tenant
          }
        },
        variants: runtimeConfig.variants
      }
    }
  };
}
