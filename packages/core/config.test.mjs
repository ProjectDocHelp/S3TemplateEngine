import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveBaseUrl,
  resolveCloudFrontAliases,
  resolveCodeBucketName,
  resolveEnvironmentSitemapIntegration,
  resolveEnvironmentWebinyIntegration,
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
  assert.equal(resolveCodeBucketName(config, "prod", "website"), "website-code-mysite");
  assert.equal(resolveTargetBucketName(config, "dev", "website", "en"), "dev-website-mysite");
  assert.equal(resolveTargetBucketName(config, "prod", "website", "de"), "website-mysite-de");
  assert.equal(resolveBaseUrl(config, "dev", "website", "en"), "dev.example.com");
  assert.equal(resolveBaseUrl(config, "prod", "website", "en"), "example.com");
  assert.deepEqual(resolveCloudFrontAliases(config, "dev", "website", "en"), ["dev.example.com"]);
  assert.deepEqual(resolveCloudFrontAliases(config, "prod", "website", "de"), ["example.de"]);

  const devTables = resolveTableNames(config, "dev");
  const prodTables = resolveTableNames(config, "prod");
  assert.equal(devTables.content, "DEV_s3te_content_mysite");
  assert.equal(prodTables.content, "PROD_s3te_content_mysite");
});

test("config derives non-prod public hosts without deepening first-level subdomains", () => {
  const config = resolveProjectConfig({
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
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "app.schwimmbad-oberprechtal.de",
            cloudFrontAliases: ["app.schwimmbad-oberprechtal.de"]
          }
        }
      }
    }
  });

  assert.equal(resolveBaseUrl(config, "prod", "website", "de"), "schwimmbad-oberprechtal.de");
  assert.equal(resolveBaseUrl(config, "test", "website", "de"), "test.schwimmbad-oberprechtal.de");
  assert.equal(resolveBaseUrl(config, "prod", "app", "de"), "app.schwimmbad-oberprechtal.de");
  assert.equal(resolveBaseUrl(config, "test", "app", "de"), "test-app.schwimmbad-oberprechtal.de");
  assert.deepEqual(resolveCloudFrontAliases(config, "test", "website", "de"), ["test.schwimmbad-oberprechtal.de"]);
  assert.deepEqual(resolveCloudFrontAliases(config, "test", "app", "de"), ["test-app.schwimmbad-oberprechtal.de"]);
  assert.equal(resolveCodeBucketName(config, "prod", "website"), "website-code-sop");
  assert.equal(resolveCodeBucketName(config, "test", "website"), "test-website-code-sop");
  assert.equal(resolveTargetBucketName(config, "prod", "app", "de"), "app-sop");
  assert.equal(resolveTargetBucketName(config, "test", "app", "de"), "test-app-sop");
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

test("config resolves webiny overrides per environment", () => {
  const config = resolveProjectConfig({
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
        mirrorTableName: "{stackPrefix}_s3te_content_{project}",
        tenant: "root",
        relevantModels: ["staticContent", "staticCodeContent", "article"],
        environments: {
          test: {
            sourceTableName: "webiny-test",
            tenant: "preview"
          }
        }
      }
    }
  });

  assert.deepEqual(resolveEnvironmentWebinyIntegration(config, "prod"), {
    enabled: true,
    sourceTableName: "webiny-live",
    mirrorTableName: "{stackPrefix}_s3te_content_{project}",
    tenant: "root",
    relevantModels: ["staticContent", "staticCodeContent", "article"]
  });
  assert.deepEqual(resolveEnvironmentWebinyIntegration(config, "test"), {
    enabled: true,
    sourceTableName: "webiny-test",
    mirrorTableName: "{stackPrefix}_s3te_content_{project}",
    tenant: "preview",
    relevantModels: ["staticContent", "staticCodeContent", "article"]
  });
});

test("config resolves sitemap overrides per environment", () => {
  const config = resolveProjectConfig({
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
      sitemap: {
        enabled: false,
        environments: {
          test: {
            enabled: true
          }
        }
      }
    }
  });

  assert.deepEqual(resolveEnvironmentSitemapIntegration(config, "prod"), {
    enabled: false
  });
  assert.deepEqual(resolveEnvironmentSitemapIntegration(config, "test"), {
    enabled: true
  });
});

test("config validation rejects full URLs in host fields", async () => {
  const result = await validateAndResolveProjectConfig({
    project: {
      name: "mysite"
    },
    environments: {
      prod: {
        awsRegion: "eu-central-1",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/prod"
      }
    },
    variants: {
      website: {
        defaultLanguage: "de",
        languages: {
          de: {
            baseUrl: "https://example.com/",
            cloudFrontAliases: ["https://example.com/"]
          }
        }
      }
    }
  }, {
    projectDir: "d:/Git/s3templateengine/examples/minimal-site"
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /baseUrl must be a hostname/.test(error.message)));
  assert.ok(result.errors.some((error) => /cloudFrontAliases must contain hostnames/.test(error.message)));
});

test("config validation rejects webiny environments without a source table", async () => {
  const result = await validateAndResolveProjectConfig({
    project: {
      name: "mysite"
    },
    environments: {
      test: {
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
    },
    integrations: {
      webiny: {
        environments: {
          test: {
            enabled: true
          }
        }
      }
    }
  }, {
    projectDir: "d:/Git/s3templateengine/examples/minimal-site"
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /requires sourceTableName when enabled for environment test/.test(error.message)));
});

test("config validation rejects sitemap overrides for unknown environments", async () => {
  const result = await validateAndResolveProjectConfig({
    project: {
      name: "mysite"
    },
    environments: {
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
      sitemap: {
        environments: {
          test: {
            enabled: true
          }
        }
      }
    }
  }, {
    projectDir: "d:/Git/s3templateengine/examples/minimal-site"
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /integrations\.sitemap\.environments\.test/.test(error.message)));
});
