import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveProjectConfig } from "../core/src/index.mjs";
import { stageProjectSources, syncPreparedSources } from "./src/sync.mjs";

function createResolvedConfig() {
  return resolveProjectConfig({
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
        sourceDir: "app/website",
        partDir: "app/part",
        defaultLanguage: "en",
        languages: {
          en: {
            baseUrl: "example.com",
            cloudFrontAliases: ["example.com"]
          }
        }
      }
    }
  });
}

test("stageProjectSources prepares part and variant folders for sync", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "s3te-sync-"));
  context.after(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectDir, "app", "part"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "app", "website"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "app", "part", "head.part"), "<title>Hello</title>\n");
  await fs.writeFile(path.join(projectDir, "app", "website", "index.html"), "<part>head.part</part>\n");

  const prepared = await stageProjectSources({
    projectDir,
    config: createResolvedConfig(),
    environment: "test"
  });

  assert.equal(prepared.syncRoot, "offline/IAAS/sync/test");
  assert.equal(prepared.syncDirectories.website, "offline/IAAS/sync/test/website");
  assert.equal(
    await fs.readFile(path.join(projectDir, prepared.syncDirectories.website, "part", "head.part"), "utf8"),
    "<title>Hello</title>\n"
  );
  assert.equal(
    await fs.readFile(path.join(projectDir, prepared.syncDirectories.website, "website", "index.html"), "utf8"),
    "<part>head.part</part>\n"
  );
});

test("syncPreparedSources uploads each variant with delete-aware sync", async () => {
  const calls = [];

  const result = await syncPreparedSources({
    projectDir: process.cwd(),
    runtimeConfig: {
      awsRegion: "eu-central-1",
      variants: {
        website: {
          codeBucket: "test-website-code-mysite"
        },
        app: {
          codeBucket: "test-app-code-mysite"
        }
      }
    },
    syncDirectories: {
      website: "offline/IAAS/sync/test/website",
      app: "offline/IAAS/sync/test/app"
    },
    ensureAwsCliAvailableFn: async () => {},
    ensureAwsCredentialsFn: async () => {},
    runAwsCliFn: async (args, options) => {
      calls.push({ args, options });
      return { stdout: "", stderr: "", code: 0 };
    }
  });

  assert.deepEqual(result.syncedCodeBuckets, [
    "test-website-code-mysite",
    "test-app-code-mysite"
  ]);
  assert.deepEqual(calls.map((call) => call.args), [
    ["s3", "sync", path.join(process.cwd(), "offline/IAAS/sync/test/website"), "s3://test-website-code-mysite", "--delete"],
    ["s3", "sync", path.join(process.cwd(), "offline/IAAS/sync/test/app"), "s3://test-app-code-mysite", "--delete"]
  ]);
});
