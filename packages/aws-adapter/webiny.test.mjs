import test from "node:test";
import assert from "node:assert/strict";

import { normalizeContentItem, matchesConfiguredTenant } from "./src/runtime/content-mirror.mjs";
import { DynamoContentRepository } from "./src/runtime/common.mjs";

test("normalizeContentItem understands Webiny-style entryId, modelId, locale, tenant, and data fields", () => {
  const item = normalizeContentItem({
    id: "0001#0002",
    entryId: "article-123",
    modelId: "article",
    locale: "en-US",
    tenant: "root",
    status: "published",
    createdOn: "2026-04-11T08:00:00.000Z",
    publishedOn: "2026-04-11T08:05:00.000Z",
    _version: 4,
    _lastChangedAt: 123456789,
    data: {
      headline: "Hello",
      body: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph-element",
              children: [{ type: "text", text: "World", format: 1 }]
            }
          ]
        }
      }
    }
  });

  assert.equal(item.contentId, "article-123");
  assert.equal(item.model, "article");
  assert.equal(item.locale, "en-US");
  assert.equal(item.tenant, "root");
  assert.equal(item.values.headline, "Hello");
  assert.equal(item.values.body, "<p><b>World</b></p>");
  assert.equal(item.createdAt, "2026-04-11T08:00:00.000Z");
  assert.equal(item.updatedAt, "2026-04-11T08:05:00.000Z");
});

test("matchesConfiguredTenant only accepts the configured Webiny tenant when provided", () => {
  assert.equal(matchesConfiguredTenant({ tenant: "root" }, "root"), true);
  assert.equal(matchesConfiguredTenant({ tenantId: "root" }, "root"), true);
  assert.equal(matchesConfiguredTenant({ tenant: "other" }, "root"), false);
  assert.equal(matchesConfiguredTenant({}, "root"), false);
  assert.equal(matchesConfiguredTenant({ tenant: "root" }, ""), true);
});

test("DynamoContentRepository prefers locale-matched items for Webiny localized content", async () => {
  const items = [
    { id: "1", contentId: "article-123", locale: "en-US", values: { title: "US" } },
    { id: "2", contentId: "article-123", locale: "en-GB", values: { title: "GB" } },
    { id: "3", contentId: "article-123", locale: "de-DE", values: { title: "DE" } }
  ];

  const repository = new DynamoContentRepository({
    tableName: "content",
    indexName: "contentid",
    languageLocaleMap: {
      en: "en-US",
      de: "de-DE"
    },
    dynamo: {
      query() {
        return {
          promise: async () => ({ Items: items })
        };
      },
      scan() {
        return {
          promise: async () => ({ Items: items })
        };
      }
    }
  });

  const englishItem = await repository.getByContentId("article-123", "en");
  const germanItem = await repository.getByContentId("article-123", "de");
  const englishQuery = await repository.query({
    filter: [{ contentId: { S: "article-123" } }]
  }, "en");

  assert.equal(englishItem?.locale, "en-US");
  assert.equal(germanItem?.locale, "de-DE");
  assert.deepEqual(englishQuery.map((item) => item.locale), ["en-US"]);
});
