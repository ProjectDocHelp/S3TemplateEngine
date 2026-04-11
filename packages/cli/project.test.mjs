import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { doctorProject, migrateProject, scaffoldProject, validateProject } from "./src/project.mjs";

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

test("migrateProject can configure webiny per environment", async () => {
  const migration = await migrateProject("s3te.config.json", {
    project: {
      name: "mysite"
    },
    environments: {
      test: {
        awsRegion: "eu-central-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test"
      },
      prod: {
        awsRegion: "eu-central-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/prod"
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
    },
    integrations: {
      webiny: {
        enabled: true,
        sourceTableName: "webiny-live",
        tenant: "root"
      }
    }
  }, {
    environment: "test",
    enableWebiny: true,
    webinySourceTable: "webiny-test",
    webinyTenant: "preview",
    webinyModels: ["article"]
  });

  assert.equal(migration.config.integrations.webiny.enabled, true);
  assert.equal(migration.config.integrations.webiny.sourceTableName, "webiny-live");
  assert.equal(migration.config.integrations.webiny.tenant, "root");
  assert.equal(migration.config.integrations.webiny.environments.test.enabled, true);
  assert.equal(migration.config.integrations.webiny.environments.test.sourceTableName, "webiny-test");
  assert.equal(migration.config.integrations.webiny.environments.test.tenant, "preview");
  assert.deepEqual(migration.config.integrations.webiny.environments.test.relevantModels, ["staticContent", "staticCodeContent", "article"]);
});

test("validateProject rejects an unknown environment with a clear error", async () => {
  const validation = await validateProject(process.cwd(), {
    environments: {
      test: {},
      prod: {}
    },
    variants: {}
  }, {
    environment: "dev"
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.errors, [{
    code: "CONFIG_CONFLICT_ERROR",
    message: "Unknown environment dev. Known environments: test, prod."
  }]);
});

test("doctorProject reports an unknown environment instead of crashing", async () => {
  const checks = await doctorProject(process.cwd(), path.join(process.cwd(), "missing-config.json"), {
    environment: "dev",
    config: {
      environments: {
        test: {
          awsRegion: "eu-west-1"
        },
        prod: {
          awsRegion: "eu-west-1"
        }
      }
    }
  });

  assert.equal(checks.at(-1)?.name, "environment");
  assert.equal(checks.at(-1)?.ok, false);
  assert.equal(checks.at(-1)?.message, "Unknown environment dev. Known environments: test, prod.");
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
    sync: "s3te sync --env dev",
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
    render: "s3te render --env dev",
    sync: "s3te sync --env dev"
  });
});

test("scaffoldProject writes the canonical schema file", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-init-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  await scaffoldProject(projectDir, {
    projectName: "sop",
    baseUrl: "example.com"
  });

  const generatedSchema = JSON.parse(await fs.readFile(path.join(projectDir, "offline", "schemas", "s3te.config.schema.json"), "utf8"));
  const canonicalSchema = JSON.parse(await fs.readFile(path.join(process.cwd(), "schemas", "s3te.config.schema.json"), "utf8"));

  assert.deepEqual(generatedSchema, canonicalSchema);
  assert.equal(generatedSchema.properties.rendering.type, "object");
  assert.equal(generatedSchema.properties.aws.type, "object");
});

test("scaffoldProject writes a default GitHub sync workflow", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-init-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  await scaffoldProject(projectDir, {
    projectName: "sop",
    baseUrl: "example.com"
  });

  const workflowPath = path.join(projectDir, ".github", "workflows", "s3te-sync.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(workflow, /name: S3TE Sync/);
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/);
  assert.match(workflow, /S3TE_ENVIRONMENT/);
  assert.match(workflow, /steps\.s3te-config\.outputs\.aws_region/);
  assert.match(workflow, /run: npx s3te sync --env \$\{\{ steps\.s3te-config\.outputs\.environment \}\}/);
});

test("scaffoldProject can be re-run to refresh schema and explicit scaffold values without overwriting user files", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-init-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  await scaffoldProject(projectDir, {
    projectName: "sop",
    baseUrl: "example.com"
  });

  const configPath = path.join(projectDir, "s3te.config.json");
  const packageJsonPath = path.join(projectDir, "package.json");
  const schemaPath = path.join(projectDir, "offline", "schemas", "s3te.config.schema.json");
  const workflowPath = path.join(projectDir, ".github", "workflows", "s3te-sync.yml");
  const headPartPath = path.join(projectDir, "app", "part", "head.part");
  const contentPath = path.join(projectDir, "offline", "content", "en.json");

  const editedConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  delete editedConfig.rendering;
  delete editedConfig.variants.website.partDir;
  editedConfig.project.displayName = "Schwimmbad Oberprechtal";
  await fs.writeFile(configPath, JSON.stringify(editedConfig, null, 2) + "\n");
  await fs.writeFile(schemaPath, JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {}
  }, null, 2) + "\n");
  await fs.writeFile(workflowPath, "name: Custom Sync\n");
  await fs.writeFile(headPartPath, "<title>Custom Head</title>\n");
  await fs.rm(contentPath, { force: true });

  await scaffoldProject(projectDir, {
    projectName: "sop-fixed",
    baseUrl: "https://schwimmbad-oberprechtal.de/"
  });

  const mergedConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const refreshedSchema = JSON.parse(await fs.readFile(schemaPath, "utf8"));

  assert.equal(mergedConfig.project.name, "sop-fixed");
  assert.equal(mergedConfig.project.displayName, "Schwimmbad Oberprechtal");
  assert.deepEqual(mergedConfig.rendering, {
    outputDir: "offline/S3TELocal/preview"
  });
  assert.equal(mergedConfig.variants.website.partDir, "app/part");
  assert.equal(mergedConfig.variants.website.languages.en.baseUrl, "schwimmbad-oberprechtal.de");
  assert.deepEqual(mergedConfig.variants.website.languages.en.cloudFrontAliases, ["schwimmbad-oberprechtal.de"]);
  assert.equal(packageJson.name, "sop-fixed");
  assert.equal(refreshedSchema.properties.rendering.type, "object");
  assert.equal(refreshedSchema.properties.aws.type, "object");
  assert.equal(await fs.readFile(workflowPath, "utf8"), "name: Custom Sync\n");
  assert.equal(await fs.readFile(headPartPath, "utf8"), "<title>Custom Head</title>\n");
  assert.equal(await fs.readFile(contentPath, "utf8"), "[]\n");
});
