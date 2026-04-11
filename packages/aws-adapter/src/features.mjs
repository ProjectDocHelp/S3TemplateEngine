export function getConfiguredFeatures(config) {
  const features = [];

  if (config.integrations?.webiny?.enabled) {
    features.push("webiny");
  }

  return features;
}

export function resolveRequestedFeatures(config, requestedFeatures = []) {
  return [...new Set([
    ...requestedFeatures,
    ...getConfiguredFeatures(config)
  ])].sort();
}
