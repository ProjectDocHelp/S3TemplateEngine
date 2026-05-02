import test from "node:test";
import assert from "node:assert/strict";

import { isRenderableBucketKey, S3TemplateRepository } from "./src/runtime/common.mjs";
import { outputKeyFromAssetKey } from "./src/runtime/source-dispatcher.mjs";

function createEnvironmentManifest() {
  return {
    variants: {
      website: {
        codeBucket: "test-website-code",
        sourceDir: "app/website",
        partDir: "app/part"
      },
      app: {
        codeBucket: "test-app-code",
        sourceDir: "app/app",
        partDir: "app/app-part"
      }
    }
  };
}

test("S3TemplateRepository resolves app partDir keys to the shared part/ prefix before variant source keys", () => {
  const repository = new S3TemplateRepository({
    s3: { send: async () => { throw new Error("not used"); } },
    environmentManifest: createEnvironmentManifest(),
    activeVariantName: "app"
  });

  assert.deepEqual(repository.resolveLogicalKey("app/app-part/headapp.part"), {
    bucket: "test-app-code",
    objectKey: "part/headapp.part"
  });

  assert.deepEqual(repository.resolveLogicalKey("app/index.html"), {
    bucket: "test-app-code",
    objectKey: "app/index.html"
  });
});

test("source dispatcher treats non-renderable sourceDir files as direct-copy assets", () => {
  const manifest = createEnvironmentManifest();
  const renderExtensions = [".html", ".htm", ".part"];

  assert.equal(isRenderableBucketKey(manifest, "app", "app/site.webmanifest", renderExtensions), false);
  assert.equal(outputKeyFromAssetKey("app", "app/site.webmanifest"), "site.webmanifest");
  assert.equal(outputKeyFromAssetKey("app", "app/.well-known/assetlinks.json"), ".well-known/assetlinks.json");
  assert.equal(outputKeyFromAssetKey("app", "app/gfx/logo.svg"), "gfx/logo.svg");
  assert.equal(outputKeyFromAssetKey("app", "app/android-chrome-512x512.png"), "android-chrome-512x512.png");
  assert.equal(outputKeyFromAssetKey("app", "app/sahred/common.js"), "sahred/common.js");

  assert.equal(isRenderableBucketKey(manifest, "app", "app/index.html", renderExtensions), true);
  assert.equal(isRenderableBucketKey(manifest, "app", "app/page.htm", renderExtensions), true);
  assert.equal(isRenderableBucketKey(manifest, "app", "app/template.part", renderExtensions), true);
  assert.equal(isRenderableBucketKey(manifest, "app", "part/shell.part", renderExtensions), true);
});
