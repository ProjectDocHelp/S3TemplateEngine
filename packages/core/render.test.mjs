import test from "node:test";
import assert from "node:assert/strict";

import { renderSourceTemplate } from "./src/index.mjs";
import { InMemoryContentRepository, InMemoryTemplateRepository } from "../testkit/src/index.mjs";

function createConfig() {
  return {
    project: {
      name: "mysite"
    },
    environments: {
      dev: {
        name: "dev",
        awsRegion: "eu-central-1",
        stackPrefix: "DEV",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/dev"
      }
    },
    rendering: {
      minifyHtml: false,
      renderExtensions: [".html", ".htm", ".part"],
      outputDir: "offline/S3TELocal/preview",
      maxRenderDepth: 50
    },
    variants: {
      website: {
        name: "website",
        sourceDir: "app/website",
        partDir: "app/part",
        defaultLanguage: "en",
        routing: {
          indexDocument: "index.html",
          notFoundDocument: "404.html"
        },
        languages: {
          en: {
            code: "en",
            baseUrl: "example.com",
            targetBucket: "dev-website-mysite",
            cloudFrontAliases: ["example.com"]
          }
        }
      }
    },
    aws: {
      codeBuckets: {
        website: "dev-website-code-mysite"
      },
      dependencyStore: { tableName: "DEV_s3te_dependencies_mysite" },
      contentStore: { tableName: "DEV_s3te_content_mysite", contentIdIndexName: "contentid" },
      invalidationStore: { tableName: "DEV_s3te_invalidations_mysite", debounceSeconds: 60 },
      lambda: { runtime: "nodejs24.x", architecture: "arm64" }
    },
    integrations: {
      webiny: {
        enabled: false,
        mirrorTableName: "DEV_s3te_content_mysite",
        relevantModels: ["staticContent", "staticCodeContent"]
      }
    }
  };
}

test("renderSourceTemplate tracks generated-template dependencies for dbmultifile outputs", async () => {
  const config = createConfig();
  const templateRepository = new InMemoryTemplateRepository({
    "website/article.html": "<dbmultifile>{\"filenamesuffix\":\"slug\",\"filter\":[{\"__typename\":{\"S\":\"article\"}}]}</dbmultifile><article><h1><dbmultifileitem>headline</dbmultifileitem></h1></article>"
  });
  const contentRepository = new InMemoryContentRepository([
    {
      id: "a-1",
      contentId: "article-one",
      model: "article",
      values: {
        slug: "one",
        headline: "First article"
      }
    }
  ]);

  const results = await renderSourceTemplate({
    config,
    templateRepository,
    contentRepository,
    environment: "dev",
    variantName: "website",
    languageCode: "en",
    sourceKey: "website/article.html"
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].artifact.outputKey, "article-one.html");
  assert.equal(results[0].artifact.body, "<article><h1>First article</h1></article>");
  assert.ok(results[0].dependencies.some((dependency) => (
    dependency.kind === "generated-template" && dependency.id === "website/article.html"
  )));
});

test("renderSourceTemplate renders stringified Webiny rich text payloads via dbpart and dbitem as html", async () => {
  const config = createConfig();
  const templateRepository = new InMemoryTemplateRepository({
    "website/index.html": "<div class='intro'><dbpart>home</dbpart></div><dbmulti>{\"filter\":[{\"__typename\":{\"S\":\"article\"}}],\"template\":\"<section><dbitem>content</dbitem></section>\"}</dbmulti>"
  });
  const richTextPayload = JSON.stringify({
    state: "{\"root\":{}}",
    html: "<p>Hello <strong>world</strong></p>"
  });
  const contentRepository = new InMemoryContentRepository([
    {
      id: "home-1",
      contentId: "home",
      model: "staticContent",
      values: {
        content: richTextPayload
      }
    },
    {
      id: "article-1",
      contentId: "article-one",
      model: "article",
      values: {
        content: richTextPayload
      }
    }
  ]);

  const results = await renderSourceTemplate({
    config,
    templateRepository,
    contentRepository,
    environment: "dev",
    variantName: "website",
    languageCode: "en",
    sourceKey: "website/index.html"
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].artifact.body, "<div class='intro'><p>Hello <strong>world</strong></p></div><section><p>Hello <strong>world</strong></p></section>");
});
