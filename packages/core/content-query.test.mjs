import test from "node:test";
import assert from "node:assert/strict";

import { applyContentQuery } from "./src/index.mjs";

test("applyContentQuery sorts ordered items numerically first and leaves unordered items at the end", () => {
  const results = applyContentQuery([
    {
      id: "unordered-1",
      contentId: "unordered-1",
      model: "article",
      values: {}
    },
    {
      id: "ordered-string",
      contentId: "ordered-string",
      model: "article",
      values: {
        order: "10"
      }
    },
    {
      id: "ordered-number",
      contentId: "ordered-number",
      model: "article",
      values: {
        order: 2
      }
    },
    {
      id: "ordered-legacy",
      contentId: "ordered-legacy",
      model: "article",
      values: {
        order: { N: "7" }
      }
    },
    {
      id: "unordered-2",
      contentId: "unordered-2",
      model: "article",
      values: {
        order: null
      }
    }
  ], {
    filter: [{ __typename: { S: "article" } }]
  });

  assert.deepEqual(results.map((item) => item.id), [
    "ordered-number",
    "ordered-legacy",
    "ordered-string",
    "unordered-1",
    "unordered-2"
  ]);
});
