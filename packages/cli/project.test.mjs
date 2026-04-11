import test from "node:test";
import assert from "node:assert/strict";

import { migrateProject } from "./src/project.mjs";

test("migrateProject can retrofit webiny onto an existing S3TE config", async () => {
  const migration = await migrateProject("s3te.config.json", {
    project: {
      name: "mysite"
    },
    environments: {
      dev: {
        awsRegion: "eu-central-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test"
      }
    },
    variants: {
      website: {
        defaultLanguage: "en",
        languages: {
          en: {
            baseUrl: "example.com",
            cloudFrontAliases: ["example.com"]
          }
        }
      }
    }
  }, {
    enableWebiny: true,
    webinySourceTable: "webiny-1234567",
    webinyTenant: "root",
    webinyModels: ["article"]
  });

  assert.equal(migration.config.integrations.webiny.enabled, true);
  assert.equal(migration.config.integrations.webiny.sourceTableName, "webiny-1234567");
  assert.equal(migration.config.integrations.webiny.tenant, "root");
  assert.deepEqual(migration.config.integrations.webiny.relevantModels, ["staticContent", "staticCodeContent", "article"]);
});
