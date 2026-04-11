import { XMLBuilder, XMLParser } from "fast-xml-parser";

import {
  createAwsClients,
  decodeS3Key,
  loadEnvironmentManifest
} from "./common.mjs";

const SITEMAP_XML_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";
const parser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => name === "url"
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true
});

function createEmptySitemapDocument() {
  return {
    "?xml": {
      "@_version": "1.0",
      "@_encoding": "UTF-8"
    },
    urlset: {
      "@_xmlns": SITEMAP_XML_NAMESPACE,
      url: []
    }
  };
}

async function bodyToUtf8(body) {
  if (typeof body?.transformToString === "function") {
    return body.transformToString("utf8");
  }

  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }

  return String(body ?? "");
}

export function normalizeSitemapDocument(document) {
  const candidate = document?.urlset ? document : createEmptySitemapDocument();
  const urls = candidate?.urlset?.url;

  return {
    "?xml": {
      "@_version": candidate?.["?xml"]?.["@_version"] ?? "1.0",
      "@_encoding": candidate?.["?xml"]?.["@_encoding"] ?? "UTF-8"
    },
    urlset: {
      "@_xmlns": candidate?.urlset?.["@_xmlns"] ?? SITEMAP_XML_NAMESPACE,
      url: Array.isArray(urls)
        ? urls.filter((entry) => entry?.loc)
        : (urls?.loc ? [urls] : [])
    }
  };
}

async function loadCurrentSitemap(s3, bucketName) {
  try {
    const response = await s3.getObject({
      Bucket: bucketName,
      Key: "sitemap.xml"
    }).promise();
    return normalizeSitemapDocument(parser.parse(await bodyToUtf8(response.Body)));
  } catch (error) {
    const errorCode = error?.name ?? error?.Code ?? error?.code;
    if (errorCode === "NoSuchKey" || errorCode === "NoSuchBucket" || errorCode === "NotFound") {
      return createEmptySitemapDocument();
    }
    throw error;
  }
}

export function findLanguageTargetByBucket(environmentManifest, bucketName) {
  for (const [variantName, variantConfig] of Object.entries(environmentManifest.variants ?? {})) {
    for (const [languageCode, languageConfig] of Object.entries(variantConfig.languages ?? {})) {
      if (languageConfig.targetBucket === bucketName) {
        return {
          variantName,
          variantConfig,
          languageCode,
          languageConfig
        };
      }
    }
  }

  return null;
}

function encodePathSegments(key) {
  return String(key)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildSitemapUrl({ baseUrl, key, indexDocument, notFoundDocument }) {
  const normalizedKey = String(key ?? "").replace(/^\/+/, "");
  if (!normalizedKey || normalizedKey === "sitemap.xml" || normalizedKey === notFoundDocument) {
    return null;
  }

  const normalizedBaseUrl = String(baseUrl ?? "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!normalizedBaseUrl) {
    return null;
  }

  if (normalizedKey === indexDocument) {
    return `https://${normalizedBaseUrl}/`;
  }

  if (normalizedKey.endsWith(`/${indexDocument}`)) {
    const directoryKey = normalizedKey.slice(0, -(indexDocument.length + 1));
    const encodedDirectory = encodePathSegments(directoryKey);
    return `https://${normalizedBaseUrl}/${encodedDirectory}/`;
  }

  return `https://${normalizedBaseUrl}/${encodePathSegments(normalizedKey)}`;
}

export function applySitemapRecords(sitemapDocument, sitemapRecords = []) {
  const normalizedDocument = normalizeSitemapDocument(sitemapDocument);
  const entries = new Map((normalizedDocument.urlset.url ?? []).map((entry) => [entry.loc, {
    loc: entry.loc,
    lastmod: entry.lastmod
  }]));

  for (const record of sitemapRecords) {
    if (!record?.loc) {
      continue;
    }

    const lastmod = String(record.lastmod ?? new Date().toISOString()).slice(0, 10);
    if (record.action === "delete") {
      entries.delete(record.loc);
      continue;
    }

    entries.set(record.loc, {
      loc: record.loc,
      lastmod
    });
  }

  normalizedDocument.urlset.url = [...entries.values()].sort((left, right) => left.loc.localeCompare(right.loc));
  return normalizedDocument;
}

export async function handler(event) {
  const environmentName = process.env.S3TE_ENVIRONMENT;
  const runtimeParameter = process.env.S3TE_RUNTIME_PARAMETER;

  const clients = createAwsClients();
  const { environment: environmentManifest } = await loadEnvironmentManifest(
    clients.ssm,
    runtimeParameter,
    environmentName
  );

  const updatesByBucket = new Map();

  for (const record of event.Records ?? []) {
    const bucketName = record.s3?.bucket?.name;
    const key = decodeS3Key(record.s3?.object?.key ?? "");
    const target = findLanguageTargetByBucket(environmentManifest, bucketName);
    if (!bucketName || !key || !target) {
      continue;
    }

    const loc = buildSitemapUrl({
      baseUrl: target.languageConfig.baseUrl,
      key,
      indexDocument: target.variantConfig.routing.indexDocument,
      notFoundDocument: target.variantConfig.routing.notFoundDocument
    });
    if (!loc) {
      continue;
    }

    if (!updatesByBucket.has(bucketName)) {
      updatesByBucket.set(bucketName, []);
    }
    updatesByBucket.get(bucketName).push({
      action: String(record.eventName).startsWith("ObjectRemoved:") ? "delete" : "upsert",
      loc,
      lastmod: record.eventTime
    });
  }

  let updatedBuckets = 0;

  for (const [bucketName, updates] of updatesByBucket.entries()) {
    const sitemapDocument = applySitemapRecords(
      await loadCurrentSitemap(clients.s3, bucketName),
      updates
    );

    await clients.s3.putObject({
      Bucket: bucketName,
      Key: "sitemap.xml",
      Body: builder.build(sitemapDocument),
      ContentType: "application/xml; charset=utf-8"
    }).promise();

    updatedBuckets += 1;
  }

  return {
    updatedBuckets
  };
}
