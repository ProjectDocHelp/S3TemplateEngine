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
      sitemap: {
        enabled: false
      },
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

test("cloudformation template derives non-prod aliases and bucket names from the environment name", () => {
  const template = buildCloudFormationTemplate({
    config: {
      project: {
        name: "sop"
      },
      environments: {
        test: {
          name: "test",
          awsRegion: "eu-west-1",
          stackPrefix: "TEST",
          certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test"
        },
        prod: {
          name: "prod",
          awsRegion: "eu-west-1",
          stackPrefix: "LIVE",
          certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/prod"
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
          defaultLanguage: "de",
          routing: {
            indexDocument: "index.html",
            notFoundDocument: "404.html"
          },
          languages: {
            de: {
              code: "de",
              baseUrl: "schwimmbad-oberprechtal.de",
              targetBucket: "{envPrefix}website-{project}",
              cloudFrontAliases: ["schwimmbad-oberprechtal.de"]
            }
          }
        },
        app: {
          name: "app",
          sourceDir: "app/app",
          partDir: "app/part-app",
          defaultLanguage: "de",
          routing: {
            indexDocument: "index.html",
            notFoundDocument: "404.html"
          },
          languages: {
            de: {
              code: "de",
              baseUrl: "app.schwimmbad-oberprechtal.de",
              targetBucket: "{envPrefix}app-{project}",
              cloudFrontAliases: ["app.schwimmbad-oberprechtal.de"]
            }
          }
        }
      },
      aws: {
        codeBuckets: {
          website: "{envPrefix}website-code-{project}",
          app: "{envPrefix}app-code-{project}"
        },
        dependencyStore: { tableName: "{stackPrefix}_s3te_dependencies_{project}" },
        contentStore: { tableName: "{stackPrefix}_s3te_content_{project}", contentIdIndexName: "contentid" },
        invalidationStore: { tableName: "{stackPrefix}_s3te_invalidations_{project}", debounceSeconds: 60 },
        lambda: { runtime: "nodejs22.x", architecture: "arm64" }
      },
      integrations: {
        sitemap: {
          enabled: false
        },
        webiny: {
          enabled: false,
          relevantModels: ["staticContent", "staticCodeContent"]
        }
      }
    },
    environment: "test",
    features: []
  });

  assert.equal(template.Resources.websiteCodeBucket.Properties.BucketName, "test-website-code-sop");
  assert.equal(template.Resources.appCodeBucket.Properties.BucketName, "test-app-code-sop");
  assert.equal(template.Resources.websitedeOutputBucket.Properties.BucketName, "test-website-sop");
  assert.equal(template.Resources.appdeOutputBucket.Properties.BucketName, "test-app-sop");
  assert.deepEqual(template.Resources.websitedeDistribution.Properties.DistributionConfig.Aliases, ["test.schwimmbad-oberprechtal.de"]);
  assert.deepEqual(template.Resources.appdeDistribution.Properties.DistributionConfig.Aliases, ["test-app.schwimmbad-oberprechtal.de"]);
});

test("cloudformation template wires sitemap updates from output buckets when sitemap is enabled", () => {
  const template = buildCloudFormationTemplate({
    config: {
      project: {
        name: "mysite"
      },
      environments: {
        prod: {
          name: "prod",
          awsRegion: "eu-central-1",
          stackPrefix: "LIVE",
          certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/live"
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
              targetBucket: "{envPrefix}website-{project}",
              cloudFrontAliases: ["example.com"]
            }
          }
        }
      },
      aws: {
        codeBuckets: {
          website: "{envPrefix}website-code-{project}"
        },
        dependencyStore: { tableName: "{stackPrefix}_s3te_dependencies_{project}" },
        contentStore: { tableName: "{stackPrefix}_s3te_content_{project}", contentIdIndexName: "contentid" },
        invalidationStore: { tableName: "{stackPrefix}_s3te_invalidations_{project}", debounceSeconds: 60 },
        lambda: { runtime: "nodejs22.x", architecture: "arm64" }
      },
      integrations: {
        sitemap: {
          enabled: true
        },
        webiny: {
          enabled: false,
          relevantModels: ["staticContent", "staticCodeContent"]
        }
      }
    },
    environment: "prod",
    features: ["sitemap"]
  });

  assert.ok(template.Parameters.SitemapUpdaterArtifactKey);
  assert.ok(template.Resources.SitemapUpdater);
  assert.ok(template.Resources.SitemapUpdaterPermission);
  assert.equal(template.Resources.SitemapUpdater.Properties.Handler, "packages/aws-adapter/src/runtime/sitemap-updater.handler");
  assert.equal(template.Resources.websiteenOutputBucket.DependsOn[0], "SitemapUpdaterPermission");
  assert.equal(template.Resources.websiteenOutputBucket.Properties.NotificationConfiguration.LambdaConfigurations.length, 4);
  assert.deepEqual(template.Outputs.SitemapUpdaterFunctionName.Value, "LIVE_s3te_sitemap_updater");
});

test("temporary deploy stack contains only the artifact bucket output", () => {
  const template = buildTemporaryDeployStackTemplate();

  assert.ok(template.Resources.ArtifactBucket);
  assert.deepEqual(template.Outputs.ArtifactBucketName.Value, { Ref: "ArtifactBucket" });
});
