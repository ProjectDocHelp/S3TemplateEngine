import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateAndResolveProjectConfig } from "../core/src/index.mjs";
import { loadLocalContent } from "./src/fs-adapters.mjs";
import { configureProjectOption, doctorProject, downloadProjectContent, renderProject, runProjectTests, scaffoldProject, validateProject } from "./src/project.mjs";

test("configureProjectOption can retrofit webiny onto an existing S3TE config", async () => {
  const optionResult = await configureProjectOption("s3te.config.json", {
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
    optionName: "webiny",
    enable: true,
    sourceTable: "webiny-1234567",
    tenant: "root",
    models: ["article"]
  });

  assert.equal(optionResult.config.integrations.webiny.enabled, true);
  assert.equal(optionResult.config.integrations.webiny.sourceTableName, "webiny-1234567");
  assert.equal(optionResult.config.integrations.webiny.tenant, "root");
  assert.deepEqual(optionResult.config.integrations.webiny.relevantModels, ["staticContent", "staticCodeContent", "article"]);
  assert.equal("environments" in optionResult.config.integrations.webiny, false);
});

test("configureProjectOption can configure webiny per environment", async () => {
  const optionResult = await configureProjectOption("s3te.config.json", {
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
    optionName: "webiny",
    environment: "test",
    enable: true,
    sourceTable: "webiny-test",
    tenant: "preview",
    models: ["article"]
  });

  assert.equal(optionResult.config.integrations.webiny.enabled, true);
  assert.equal(optionResult.config.integrations.webiny.sourceTableName, "webiny-live");
  assert.equal(optionResult.config.integrations.webiny.tenant, "root");
  assert.equal(optionResult.config.integrations.webiny.environments.test.enabled, true);
  assert.equal(optionResult.config.integrations.webiny.environments.test.sourceTableName, "webiny-test");
  assert.equal(optionResult.config.integrations.webiny.environments.test.tenant, "preview");
  assert.deepEqual(optionResult.config.integrations.webiny.environments.test.relevantModels, ["staticContent", "staticCodeContent", "article"]);
});

test("configureProjectOption can retrofit sitemap onto an existing S3TE config", async () => {
  const optionResult = await configureProjectOption("s3te.config.json", {
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
    optionName: "sitemap",
    enable: true
  });

  assert.equal(optionResult.config.integrations.sitemap.enabled, true);
  assert.equal("environments" in optionResult.config.integrations.sitemap, false);
  assert.ok(optionResult.changes.some((change) => /Enabled sitemap option/.test(change)));
});

test("configureProjectOption can configure sitemap per environment", async () => {
  const optionResult = await configureProjectOption("s3te.config.json", {
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
    }
  }, {
    optionName: "sitemap",
    environment: "test",
    enable: true
  });

  assert.equal(optionResult.config.integrations.sitemap.environments.test.enabled, true);
  assert.ok(optionResult.changes.some((change) => /for environment test/.test(change)));
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

test("doctorProject accepts app-style non-prod aliases under a single wildcard certificate", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-doctor-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectDir, "app", "website"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "part"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "app"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "part-app"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "s3te.config.json"), "{}\n");

  const resolved = await validateAndResolveProjectConfig({
    project: {
      name: "sop"
    },
    environments: {
      test: {
        awsRegion: "eu-west-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test"
      },
      prod: {
        awsRegion: "eu-west-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/prod"
      }
    },
    variants: {
      website: {
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "schwimmbad-oberprechtal.de",
            cloudFrontAliases: ["schwimmbad-oberprechtal.de"]
          }
        }
      },
      app: {
        sourceDir: "app/app",
        partDir: "app/part-app",
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "app.schwimmbad-oberprechtal.de",
            cloudFrontAliases: ["app.schwimmbad-oberprechtal.de"]
          }
        }
      }
    }
  }, {
    projectDir
  });

  const checks = await doctorProject(projectDir, path.join(projectDir, "s3te.config.json"), {
    environment: "test",
    config: resolved.config,
    ensureAwsCliAvailableFn: async () => {},
    ensureAwsCredentialsFn: async () => ({ Arn: "arn:aws:iam::123456789012:user/test" }),
    runAwsCliFn: async () => ({
      stdout: JSON.stringify({
        Certificate: {
          DomainName: "schwimmbad-oberprechtal.de",
          SubjectAlternativeNames: [
            "schwimmbad-oberprechtal.de",
            "*.schwimmbad-oberprechtal.de"
          ]
        }
      })
    })
  });

  const certificateCheck = checks.find((check) => check.name === "acm-certificate");
  assert.equal(certificateCheck?.ok, true);
  assert.match(certificateCheck?.message ?? "", /covers 2 CloudFront alias/);
});

test("doctorProject still reports deeper aliases outside the certificate wildcard scope", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-doctor-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectDir, "app", "website"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "part"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "admin"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "part-admin"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "s3te.config.json"), "{}\n");

  const resolved = await validateAndResolveProjectConfig({
    project: {
      name: "sop"
    },
    environments: {
      test: {
        awsRegion: "eu-west-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test"
      },
      prod: {
        awsRegion: "eu-west-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/prod"
      }
    },
    variants: {
      website: {
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "schwimmbad-oberprechtal.de",
            cloudFrontAliases: ["schwimmbad-oberprechtal.de"]
          }
        }
      },
      admin: {
        sourceDir: "app/admin",
        partDir: "app/part-admin",
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "admin.app.schwimmbad-oberprechtal.de",
            cloudFrontAliases: ["admin.app.schwimmbad-oberprechtal.de"]
          }
        }
      }
    }
  }, {
    projectDir
  });

  const checks = await doctorProject(projectDir, path.join(projectDir, "s3te.config.json"), {
    environment: "test",
    config: resolved.config,
    ensureAwsCliAvailableFn: async () => {},
    ensureAwsCredentialsFn: async () => ({ Arn: "arn:aws:iam::123456789012:user/test" }),
    runAwsCliFn: async () => ({
      stdout: JSON.stringify({
        Certificate: {
          DomainName: "schwimmbad-oberprechtal.de",
          SubjectAlternativeNames: [
            "schwimmbad-oberprechtal.de",
            "*.schwimmbad-oberprechtal.de"
          ]
        }
      })
    })
  });

  const certificateCheck = checks.find((check) => check.name === "acm-certificate");
  assert.equal(certificateCheck?.ok, false);
  assert.match(certificateCheck?.message ?? "", /test-admin\.app\.schwimmbad-oberprechtal\.de/);
});

test("runProjectTests executes scaffolded offline tests successfully", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-test-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  await scaffoldProject(projectDir, {
    projectName: "sop",
    baseUrl: "example.com"
  });

  const exitCode = await runProjectTests(projectDir);
  assert.equal(exitCode, 0);
});

test("downloadProjectContent writes a deduplicated local content snapshot for offline render and tests", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-content-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectDir, "app", "website"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "part"), { recursive: true });

  const resolved = await validateAndResolveProjectConfig({
    project: {
      name: "sop"
    },
    environments: {
      test: {
        awsRegion: "eu-west-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test"
      }
    },
    variants: {
      website: {
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "example.com",
            cloudFrontAliases: ["example.com"]
          }
        }
      }
    },
    integrations: {
      webiny: {
        enabled: true,
        sourceTableName: "webiny-1234567",
        tenant: "root"
      }
    }
  }, {
    projectDir
  });
  assert.equal(resolved.ok, true);

  const report = await downloadProjectContent(projectDir, resolved.config, {
    environment: "test",
    scanContentItemsFn: async () => ([
      {
        id: "entry#0001",
        contentId: "description",
        model: "staticCodeContent",
        tenant: "root",
        updatedAt: "2026-04-12T09:57:04.646Z",
        values: {
          content: "old"
        }
      },
      {
        id: "entry#0002",
        contentId: "description",
        model: "staticCodeContent",
        tenant: "root",
        updatedAt: "2026-04-12T11:06:51.693Z",
        values: {
          content: "new"
        }
      }
    ])
  });

  const filePath = path.join(projectDir, "offline", "content", "items.json");
  const writtenItems = JSON.parse(await fs.readFile(filePath, "utf8"));
  const repository = await loadLocalContent(projectDir, resolved.config);
  const item = await repository.getByContentId("description", "de");

  assert.equal(report.tableName, "TEST_s3te_content_sop");
  assert.equal(report.outputPath, "offline/content/items.json");
  assert.equal(report.downloadedItems, 2);
  assert.equal(report.writtenItems, 1);
  assert.equal(report.deduplicatedItems, 1);
  assert.deepEqual(writtenItems.map((entry) => entry.id), ["entry#0002"]);
  assert.equal(item?.id, "entry#0002");
  assert.equal(item?.values.content, "new");
});

test("renderProject resolves partDir correctly when another variant name matches the path prefix", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-render-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectDir, "app", "website"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "part"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "app"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "app-part"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "offline", "content"), { recursive: true });

  await fs.writeFile(path.join(projectDir, "app", "website", "index.html"), "<part>head.part</part><body><part>header.part</part><main>Website</main><part>footer.part</part></body>\n");
  await fs.writeFile(path.join(projectDir, "app", "part", "head.part"), "<!doctype html><html><head><title>Website</title></head>\n");
  await fs.writeFile(path.join(projectDir, "app", "part", "header.part"), "<header>Header</header>\n");
  await fs.writeFile(path.join(projectDir, "app", "part", "footer.part"), "<footer>Footer</footer></html>\n");
  await fs.writeFile(path.join(projectDir, "app", "app", "index.html"), "<body>App</body>\n");
  await fs.writeFile(path.join(projectDir, "app", "app-part", "head.part"), "<title>App</title>\n");
  await fs.writeFile(path.join(projectDir, "offline", "content", "items.json"), "[]\n");

  const resolved = await validateAndResolveProjectConfig({
    project: {
      name: "sop"
    },
    rendering: {
      outputDir: "offline/S3TELocal/preview"
    },
    environments: {
      test: {
        awsRegion: "eu-west-1",
        stackPrefix: "TEST",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/test"
      }
    },
    variants: {
      website: {
        sourceDir: "app/website",
        partDir: "app/part",
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "schwimmbad-oberprechtal.de",
            cloudFrontAliases: ["schwimmbad-oberprechtal.de"]
          }
        }
      },
      app: {
        sourceDir: "app/app",
        partDir: "app/app-part",
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "app.schwimmbad-oberprechtal.de",
            cloudFrontAliases: ["app.schwimmbad-oberprechtal.de"]
          }
        }
      }
    }
  }, {
    projectDir
  });
  assert.equal(resolved.ok, true);

  const report = await renderProject(projectDir, resolved.config, {
    environment: "test",
    variant: "website"
  });

  assert.equal(report.warnings.length, 0);

  const rendered = await fs.readFile(path.join(projectDir, "offline", "S3TELocal", "preview", "test", "website", "de", "index.html"), "utf8");
  assert.match(rendered, /^<!doctype html><html><head><title>Website<\/title><\/head>/);
  assert.match(rendered, /<header>Header<\/header>/);
  assert.match(rendered, /<footer>Footer<\/footer><\/html>/);
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
