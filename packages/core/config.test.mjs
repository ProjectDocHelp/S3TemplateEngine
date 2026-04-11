import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveCodeBucketName,
  resolveProjectConfig,
  resolveTargetBucketName,
  resolveTableNames,
  validateAndResolveProjectConfig
} from "./src/index.mjs";

test("config resolves placeholders per environment instead of leaking the last environment", async () => {
  const rawConfig = {
    project: {
      name: "mysite"
    },
    environments: {
      dev: {
        awsRegion: "eu-central-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/dev"
      },
      prod: {
        awsRegion: "eu-central-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/prod"
      }
    },
    variants: {
      website: {
        sourceDir: "app/website",
        partDir: "app/part",
        defaultLanguage: "en",
        languages: {
          en: {
            baseUrl: "example.com",
            cloudFrontAliases: ["example.com"]
          },
          de: {
            baseUrl: "example.de",
            cloudFrontAliases: ["example.de"]
          }
        }
      }
    }
  };

  const config = resolveProjectConfig(rawConfig);
  assert.equal(resolveCodeBucketName(config, "dev", "website"), "dev-website-code-mysite");
  assert.equal(resolveCodeBucketName(config, "prod", "website"), "prod-website-code-mysite");
  assert.equal(resolveTargetBucketName(config, "dev", "website", "en"), "dev-website-mysite");
  assert.equal(resolveTargetBucketName(config, "prod", "website", "de"), "prod-website-mysite-de");

  const devTables = resolveTableNames(config, "dev");
  const prodTables = resolveTableNames(config, "prod");
  assert.equal(devTables.content, "DEV_s3te_content_mysite");
  assert.equal(prodTables.content, "PROD_s3te_content_mysite");
});

test("config validation rejects unknown placeholders", async () => {
  const result = await validateAndResolveProjectConfig({
    project: {
      name: "mysite"
    },
    environments: {
      dev: {
        awsRegion: "eu-central-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/dev"
      }
    },
    variants: {
      website: {
        sourceDir: "app/website",
        partDir: "app/part",
        defaultLanguage: "en",
        languages: {
          en: {
            baseUrl: "example.com",
            targetBucket: "{unknown}-bucket",
            cloudFrontAliases: ["example.com"]
          }
        }
      }
    }
  }, {
    projectDir: "d:/Git/s3templateengine/examples/minimal-site"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors[0].code, /CONFIG_PLACEHOLDER_ERROR/);
});
