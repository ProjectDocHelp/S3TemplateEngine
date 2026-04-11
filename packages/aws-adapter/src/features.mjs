import {
  resolveEnvironmentSitemapIntegration,
  resolveEnvironmentWebinyIntegration
} from "../../core/src/index.mjs";

export function getConfiguredFeatures(config, environment) {
  const features = [];

  if (environment) {
    if (resolveEnvironmentWebinyIntegration(config, environment).enabled) {
      features.push("webiny");
    }
    if (resolveEnvironmentSitemapIntegration(config, environment).enabled) {
      features.push("sitemap");
    }
    return features;
  }

  const hasAnyEnvironmentWebiny = Object.keys(config.environments ?? {}).some((environmentName) => (
    resolveEnvironmentWebinyIntegration(config, environmentName).enabled
  ));
  const hasAnyEnvironmentSitemap = Object.keys(config.environments ?? {}).some((environmentName) => (
    resolveEnvironmentSitemapIntegration(config, environmentName).enabled
  ));

  if (hasAnyEnvironmentWebiny) {
    features.push("webiny");
  }
  if (hasAnyEnvironmentSitemap) {
    features.push("sitemap");
  }

  return features;
}

export function resolveRequestedFeatures(config, requestedFeatures = [], environment) {
  return [...new Set([
    ...requestedFeatures,
    ...getConfiguredFeatures(config, environment)
  ])].sort();
}
