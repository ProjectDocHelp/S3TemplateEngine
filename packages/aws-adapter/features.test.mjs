import test from "node:test";
import assert from "node:assert/strict";

import { resolveRequestedFeatures } from "./src/features.mjs";

test("configured webiny becomes an active feature even without explicit CLI flag", () => {
  const features = resolveRequestedFeatures({
    environments: {
      prod: {}
    },
    integrations: {
      sitemap: {
        enabled: true
      },
      webiny: {
        enabled: true
      }
    }
  });

  assert.deepEqual(features, ["sitemap", "webiny"]);
});

test("requested features are de-duplicated against configured features", () => {
  const features = resolveRequestedFeatures({
    environments: {
      prod: {}
    },
    integrations: {
      sitemap: {
        enabled: true
      },
      webiny: {
        enabled: true
      }
    }
  }, ["webiny", "sitemap"]);

  assert.deepEqual(features, ["sitemap", "webiny"]);
});

test("configured webiny can be enabled only for a specific environment", () => {
  const config = {
    environments: {
      test: {},
      prod: {}
    },
    integrations: {
      webiny: {
        environments: {
          test: {
            enabled: true,
            sourceTableName: "webiny-test"
          }
        }
      }
    }
  };

  assert.deepEqual(resolveRequestedFeatures(config, [], "test"), ["webiny"]);
  assert.deepEqual(resolveRequestedFeatures(config, [], "prod"), []);
});

test("configured sitemap can be enabled only for a specific environment", () => {
  const config = {
    environments: {
      test: {},
      prod: {}
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
  };

  assert.deepEqual(resolveRequestedFeatures(config, [], "test"), ["sitemap"]);
  assert.deepEqual(resolveRequestedFeatures(config, [], "prod"), []);
});
