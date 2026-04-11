import test from "node:test";
import assert from "node:assert/strict";

import { resolveRequestedFeatures } from "./src/features.mjs";

test("configured webiny becomes an active feature even without explicit CLI flag", () => {
  const features = resolveRequestedFeatures({
    environments: {
      prod: {}
    },
    integrations: {
      webiny: {
        enabled: true
      }
    }
  });

  assert.deepEqual(features, ["webiny"]);
});

test("requested features are de-duplicated against configured features", () => {
  const features = resolveRequestedFeatures({
    environments: {
      prod: {}
    },
    integrations: {
      webiny: {
        enabled: true
      }
    }
  }, ["webiny"]);

  assert.deepEqual(features, ["webiny"]);
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
