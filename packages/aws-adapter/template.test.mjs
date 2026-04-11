import test from "node:test";
import assert from "node:assert/strict";

import { buildCloudFormationTemplate, buildTemporaryDeployStackTemplate } from "./src/index.mjs";

function createConfig() {
  return {
    project: {
      name: "mysite"
    },
    environments: {
      dev: {
        name: "dev",
        awsRegion: "eu-central-1",
        stackPrefix: "DEV",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/dev"
      }
    },
    rendering: {
      minifyHtml: true,
      renderExtensions: [".html", ".htm", ".part"],
      outputDir: "offline/S3TELocal/preview",
      maxRenderDepth: 50
    },
    variants: {
      website: {
        name: "website",
        sourceDir: "app/website",
        partDir: "app/part",
        defaultLanguage: "en",
        routing: {
          indexDocument: "index.html",
          notFoundDocument: "404.html"
        },
        languages: {
          en: {
            code: "en",
            baseUrl: "example.com",
            targetBucket: "{env}-website-{project}",
            cloudFrontAliases: ["example.com"]
          }
        }
      }
    },
    aws: {
      codeBuckets: {
        website: "{env}-website-code-{project}"
      },
      dependencyStore: { tableName: "{stackPrefix}_s3te_dependencies_{project}" },
      contentStore: { tableName: "{stackPrefix}_s3te_content_{project}", contentIdIndexName: "contentid" },
      invalidationStore: { tableName: "{stackPrefix}_s3te_invalidations_{project}", debounceSeconds: 60 },
      lambda: { runtime: "nodejs22.x", architecture: "arm64" }
    },
    integrations: {
      webiny: {
        enabled: true,
        sourceTableName: "webiny-table",
        mirrorTableName: "{stackPrefix}_s3te_content_{project}",
        relevantModels: ["staticContent", "staticCodeContent"]
      }
    }
  };
}

test("cloudformation template exposes parameterized lambda artifacts and runtime outputs", () => {
  const template = buildCloudFormationTemplate({
    config: createConfig(),
    environment: "dev",
    features: ["webiny"]
  });

  assert.equal(template.Parameters.ArtifactBucket.Type, "String");
  assert.equal(template.Parameters.RuntimeManifestValue.Type, "String");
  assert.equal(template.Resources.SourceDispatcher.Properties.Handler, "packages/aws-adapter/src/runtime/source-dispatcher.handler");
  assert.equal(template.Resources.RenderWorker.Properties.Environment.Variables.S3TE_DEPENDENCY_TABLE, "DEV_s3te_dependencies_mysite");
  assert.deepEqual(template.Resources.RuntimeManifestParameter.Properties.Value, { Ref: "RuntimeManifestValue" });
  assert.equal(template.Outputs.RuntimeManifestParameterName.Value, "/DEV/s3te/mysite/runtime-manifest");
  assert.ok(template.Resources.ContentMirror);
  assert.ok(template.Resources.ContentMirrorEventSourceMapping);
});

test("temporary deploy stack contains only the artifact bucket output", () => {
  const template = buildTemporaryDeployStackTemplate();

  assert.ok(template.Resources.ArtifactBucket);
  assert.deepEqual(template.Outputs.ArtifactBucketName.Value, { Ref: "ArtifactBucket" });
});
