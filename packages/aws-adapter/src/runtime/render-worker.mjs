import {
  createAwsClients,
  createBuildId,
  createRepositoriesAndPublishers,
  deleteOutputsForTemplate,
  loadEnvironmentManifest,
  renderAndPublishTargets,
  resolveRenderTargetsForEvent,
  S3TemplateRepository
} from "./common.mjs";

export async function handler(event) {
  const environmentName = process.env.S3TE_ENVIRONMENT;
  const runtimeParameter = process.env.S3TE_RUNTIME_PARAMETER;
  const clients = createAwsClients();
  const { manifest, environment: environmentManifest } = await loadEnvironmentManifest(
    clients.ssm,
    runtimeParameter,
    environmentName
  );
  const {
    contentRepository,
    dependencyStore,
    publisher,
    invalidationScheduler
  } = createRepositoriesAndPublishers({
    clients,
    environmentManifest
  });

  const buildId = event.buildId ?? createBuildId("render");

  if (event.type === "source-object" && event.action === "delete" && event.key.startsWith(`${event.variant}/`)) {
    const deletedOutputs = await deleteOutputsForTemplate({
      event,
      environmentName,
      environmentManifest,
      dependencyStore,
      publisher,
      invalidationScheduler,
      buildId
    });

    return {
      buildId,
      rendered: [],
      deleted: deletedOutputs,
      warnings: []
    };
  }

  const targets = await resolveRenderTargetsForEvent({
    event,
    manifest,
    environmentName,
    environmentManifest,
    dependencyStore,
    templateRepositoryFactory: (variantName) => new S3TemplateRepository({
      s3: clients.s3,
      environmentManifest,
      activeVariantName: variantName
    })
  });

  const result = await renderAndPublishTargets({
    manifest,
    environmentName,
    environmentManifest,
    contentRepository,
    dependencyStore,
    publisher,
    invalidationScheduler,
    targets,
    buildId
  });

  return {
    buildId,
    rendered: result.rendered,
    deleted: result.deleted,
    warnings: result.warnings
  };
}
