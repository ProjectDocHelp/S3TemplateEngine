import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

import {
  isPublished,
  normalizeContentItem,
  matchesConfiguredTenant,
  shouldMirrorWebinyStreamItem
} from "./src/runtime/content-mirror.mjs";
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
  assert.equal(matchesConfiguredTenant({ data: { tenant: "root" } }, "root"), true);
  assert.equal(matchesConfiguredTenant({ tenant: "other" }, "root"), false);
  assert.equal(matchesConfiguredTenant({}, "root"), false);
  assert.equal(matchesConfiguredTenant({ tenant: "root" }, ""), true);
});

test("shouldMirrorWebinyStreamItem ignores Webiny draft latest and revision status churn", () => {
  function entry({ key, type, status, version = 3, liveVersion = 3 }) {
    return {
      PK: "T#root#CMS#CME#entry-1",
      SK: key,
      TYPE: type,
      data: {
        id: `entry-1#${String(version).padStart(4, "0")}`,
        entryId: "entry-1",
        modelId: "article",
        tenant: "root",
        status,
        version,
        live: {
          version: liveVersion
        },
        values: {
          title: "Article"
        }
      }
    };
  }

  assert.equal(shouldMirrorWebinyStreamItem(entry({
    key: "L",
    type: "cms.entry.l",
    status: "draft",
    version: 3,
    liveVersion: 2
  })), false);
  assert.equal(shouldMirrorWebinyStreamItem(entry({
    key: "P",
    type: "cms.entry.p",
    status: "published"
  })), true);
  assert.equal(shouldMirrorWebinyStreamItem(entry({
    key: "REV#0003",
    type: "cms.entry",
    status: "published"
  })), false);
  assert.equal(shouldMirrorWebinyStreamItem(entry({
    key: "REV#0002",
    type: "cms.entry",
    status: "unpublished",
    version: 2,
    liveVersion: 2
  })), false);
  assert.equal(shouldMirrorWebinyStreamItem({
    id: "legacy-entry",
    modelId: "article",
    status: "published"
  }), true);
});

test("Webiny publish sequence does not turn unpublished old revisions into mirror deletes", () => {
  function entry({ key, type, status, version, liveVersion }) {
    return {
      PK: "T#root#CMS#CME#69da58292212ca00029fdf54",
      SK: key,
      TYPE: type,
      data: {
        id: `69da58292212ca00029fdf54#${String(version).padStart(4, "0")}`,
        entryId: "69da58292212ca00029fdf54",
        modelId: "article",
        tenant: "root",
        status,
        version,
        live: {
          version: liveVersion
        },
        values: {
          "text@titleField": "KINDERSCHWIMMKURS 2025"
        }
      }
    };
  }

  const streamRecords = [
    { eventName: "INSERT", item: entry({ key: "REV#0003", type: "cms.entry", status: "draft", version: 3, liveVersion: 2 }) },
    { eventName: "MODIFY", item: entry({ key: "L", type: "cms.entry.l", status: "draft", version: 3, liveVersion: 2 }) },
    { eventName: "MODIFY", item: entry({ key: "REV#0003", type: "cms.entry", status: "published", version: 3, liveVersion: 3 }) },
    { eventName: "MODIFY", item: entry({ key: "L", type: "cms.entry.l", status: "published", version: 3, liveVersion: 3 }) },
    { eventName: "MODIFY", item: entry({ key: "P", type: "cms.entry.p", status: "published", version: 3, liveVersion: 3 }) },
    { eventName: "MODIFY", item: entry({ key: "REV#0002", type: "cms.entry", status: "unpublished", version: 2, liveVersion: 2 }) },
    { eventName: "INSERT", item: entry({ key: "REV#0004", type: "cms.entry", status: "draft", version: 4, liveVersion: 3 }) },
    { eventName: "MODIFY", item: entry({ key: "L", type: "cms.entry.l", status: "draft", version: 4, liveVersion: 3 }) },
    { eventName: "MODIFY", item: entry({ key: "REV#0004", type: "cms.entry", status: "published", version: 4, liveVersion: 4 }) },
    { eventName: "MODIFY", item: entry({ key: "P", type: "cms.entry.p", status: "published", version: 4, liveVersion: 4 }) },
    { eventName: "MODIFY", item: entry({ key: "L", type: "cms.entry.l", status: "published", version: 4, liveVersion: 4 }) },
    { eventName: "MODIFY", item: entry({ key: "REV#0003", type: "cms.entry", status: "unpublished", version: 3, liveVersion: 3 }) }
  ];

  const actions = streamRecords
    .filter(({ item }) => shouldMirrorWebinyStreamItem(item))
    .map(({ eventName, item }) => ({
      action: eventName === "REMOVE" || !isPublished(item) ? "delete" : "upsert",
      key: item.SK,
      id: item.data.id
    }));

  assert.deepEqual(actions, [
    { action: "upsert", key: "L", id: "69da58292212ca00029fdf54#0003" },
    { action: "upsert", key: "P", id: "69da58292212ca00029fdf54#0003" },
    { action: "upsert", key: "P", id: "69da58292212ca00029fdf54#0004" },
    { action: "upsert", key: "L", id: "69da58292212ca00029fdf54#0004" }
  ]);
  assert.equal(actions.some(({ action }) => action === "delete"), false);
});

test("isPublished treats explicit unpublish state as delete even when Webiny keeps publish timestamps", () => {
  assert.equal(isPublished({
    status: "published",
    lastPublishedOn: "2026-04-12T08:05:00.000Z"
  }), true);
  assert.equal(isPublished({
    status: "unpublished",
    lastPublishedOn: "2026-04-12T08:05:00.000Z"
  }), false);
  assert.equal(isPublished({
    data: {
      status: "draft",
      publishedOn: "2026-04-12T08:05:00.000Z"
    }
  }), false);
  assert.equal(isPublished({
    published: false,
    lastPublishedOn: "2026-04-12T08:05:00.000Z"
  }), false);
});

test("normalizeContentItem understands Webiny V6 latest records with nested data and storage ids", () => {
  const compressedContent = gzipSync("console.log('hello');").toString("base64");
  const item = normalizeContentItem({
    PK: "T#root#CMS#CME#entry-1",
    SK: "L",
    TYPE: "cms.entry.l",
    data: {
      id: "entry-1#0001",
      entryId: "entry-1",
      modelId: "staticCodeContent",
      tenant: "root",
      status: "published",
      createdOn: "2026-04-11T08:00:00.000Z",
      lastPublishedOn: "2026-04-12T08:05:00.000Z",
      values: {
        "text@contentidField": "description",
        "long-text@contentField": {
          compression: "gzip",
          value: compressedContent
        }
      }
    }
  }, {
    modelFields: [
      {
        fieldId: "contentid",
        storageId: "text@contentidField",
        type: "text"
      },
      {
        fieldId: "content",
        storageId: "long-text@contentField",
        type: "long-text"
      }
    ]
  });

  assert.equal(item.id, "entry-1#0001");
  assert.equal(item.contentId, "description");
  assert.equal(item.model, "staticCodeContent");
  assert.equal(item.tenant, "root");
  assert.equal(item.values.contentid, "description");
  assert.equal(item.values.content, "console.log('hello');");
  assert.equal(item.updatedAt, "2026-04-12T08:05:00.000Z");
});

test("normalizeContentItem extracts html from compressed stringified Webiny rich text payloads", () => {
  const richTextPayload = JSON.stringify({
    state: "{\"root\":{}}",
    html: "<p>Hello <strong>world</strong></p>"
  });
  const compressedContent = gzipSync(richTextPayload).toString("base64");
  const item = normalizeContentItem({
    data: {
      id: "entry-2#0001",
      entryId: "entry-2",
      modelId: "staticContent",
      tenant: "root",
      status: "published",
      values: {
        "text@contentidField": "home",
        "long-text@contentField": {
          compression: "gzip",
          value: compressedContent
        }
      }
    }
  }, {
    modelFields: [
      {
        fieldId: "contentid",
        storageId: "text@contentidField",
        type: "text"
      },
      {
        fieldId: "content",
        storageId: "long-text@contentField",
        type: "long-text"
      }
    ]
  });

  assert.equal(item.values.content, "<p>Hello <strong>world</strong></p>");
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

test("DynamoContentRepository prefers the newest mirrored revision for the same content and locale", async () => {
  const items = [
    {
      id: "entry#0001",
      contentId: "description",
      locale: undefined,
      updatedAt: "2026-04-12T09:57:04.646Z",
      values: { content: "old" }
    },
    {
      id: "entry#0002",
      contentId: "description",
      locale: undefined,
      updatedAt: "2026-04-12T11:06:51.693Z",
      values: { content: "new" }
    }
  ];

  const repository = new DynamoContentRepository({
    tableName: "content",
    indexName: "contentid",
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

  const item = await repository.getByContentId("description", "de");
  const queried = await repository.query({
    filter: [{ contentId: { S: "description" } }]
  }, "de");

  assert.equal(item?.id, "entry#0002");
  assert.equal(item?.values.content, "new");
  assert.deepEqual(queried.map((entry) => entry.id), ["entry#0002"]);
});
