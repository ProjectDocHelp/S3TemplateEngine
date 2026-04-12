import test from "node:test";
import assert from "node:assert/strict";

import { S3TemplateRepository } from "./src/runtime/common.mjs";

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
