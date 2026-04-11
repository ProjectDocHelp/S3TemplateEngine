import test from "node:test";
import assert from "node:assert/strict";

import {
  applySitemapRecords,
  buildSitemapUrl,
  findLanguageTargetByBucket,
  normalizeSitemapDocument
} from "./src/runtime/sitemap-updater.mjs";

test("buildSitemapUrl maps index documents to clean public URLs", () => {
  assert.equal(buildSitemapUrl({
    baseUrl: "example.com",
    key: "index.html",
    indexDocument: "index.html",
    notFoundDocument: "404.html"
  }), "https://example.com/");

  assert.equal(buildSitemapUrl({
    baseUrl: "example.com",
    key: "news/index.html",
    indexDocument: "index.html",
    notFoundDocument: "404.html"
  }), "https://example.com/news/");

  assert.equal(buildSitemapUrl({
    baseUrl: "example.com",
    key: "about us.html",
    indexDocument: "index.html",
    notFoundDocument: "404.html"
  }), "https://example.com/about%20us.html");

  assert.equal(buildSitemapUrl({
    baseUrl: "example.com",
    key: "404.html",
    indexDocument: "index.html",
    notFoundDocument: "404.html"
  }), null);
});

test("applySitemapRecords upserts and deletes sitemap entries deterministically", () => {
  const nextDocument = applySitemapRecords(normalizeSitemapDocument({
    urlset: {
      url: [
        {
          loc: "https://example.com/old.html",
          lastmod: "2026-01-01"
        }
      ]
    }
  }), [
    {
      action: "upsert",
      loc: "https://example.com/",
      lastmod: "2026-04-11T10:15:00.000Z"
    },
    {
      action: "delete",
      loc: "https://example.com/old.html"
    }
  ]);

  assert.deepEqual(nextDocument.urlset.url, [
    {
      loc: "https://example.com/",
      lastmod: "2026-04-11"
    }
  ]);
});

test("findLanguageTargetByBucket resolves output buckets back to variant and language", () => {
  const target = findLanguageTargetByBucket({
    variants: {
      website: {
        routing: {
          indexDocument: "index.html",
          notFoundDocument: "404.html"
        },
        languages: {
          en: {
            baseUrl: "example.com",
            targetBucket: "website-mysite"
          }
        }
      },
      app: {
        routing: {
          indexDocument: "index.html",
          notFoundDocument: "404.html"
        },
        languages: {
          en: {
            baseUrl: "app.example.com",
            targetBucket: "app-mysite"
          }
        }
      }
    }
  }, "app-mysite");

  assert.equal(target?.variantName, "app");
  assert.equal(target?.languageCode, "en");
  assert.equal(target?.languageConfig.baseUrl, "app.example.com");
});
