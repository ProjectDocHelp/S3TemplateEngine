import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrateProject, scaffoldProject } from "./src/project.mjs";

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

test("scaffoldProject merges an existing npm-generated package.json", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-init-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({
    devDependencies: {
      "@projectdochelp/s3te": "^3.0.0"
    }
  }, null, 2) + "\n");

  await scaffoldProject(projectDir, {
    projectName: "mywebsite",
    baseUrl: "example.com"
  });

  const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"));
  assert.equal(packageJson.name, "mywebsite");
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.devDependencies, {
    "@projectdochelp/s3te": "^3.0.0"
  });
  assert.deepEqual(packageJson.scripts, {
    validate: "s3te validate",
    render: "s3te render --env dev",
    test: "s3te test"
  });
});

test("scaffoldProject preserves existing package.json fields and script collisions", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-init-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({
    name: "existing-site",
    type: "commonjs",
    scripts: {
      test: "vitest",
      lint: "eslint ."
    }
  }, null, 2) + "\n");

  await scaffoldProject(projectDir, {
    projectName: "new-name",
    baseUrl: "example.com"
  });

  const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"));
  assert.equal(packageJson.name, "existing-site");
  assert.equal(packageJson.type, "commonjs");
  assert.equal(packageJson.private, true);
  assert.deepEqual(packageJson.scripts, {
    test: "vitest",
    lint: "eslint .",
    validate: "s3te validate",
    render: "s3te render --env dev"
  });
});
