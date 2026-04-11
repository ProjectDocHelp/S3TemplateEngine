import { createAwsClients, invokeLambdaEvent } from "./common.mjs";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineTextNode(node) {
  let value = escapeHtml(node.text ?? "");
  const format = Number(node.format ?? 0);

  if (format & 1) {
    value = `<b>${value}</b>`;
  }
  if (format & 2) {
    value = `<i>${value}</i>`;
  }
  if (format & 8) {
    value = `<u>${value}</u>`;
  }

  return value;
}

function renderRichTextChildren(children = []) {
  return children.map((child) => renderRichTextNode(child)).join("");
}

function renderRichTextAttributes(node) {
  const attributes = [];
  if (node.className) {
    attributes.push(` class="${escapeHtml(node.className)}"`);
  }
  if (node.format && typeof node.format === "string") {
    attributes.push(` style="text-align:${escapeHtml(node.format)}"`);
  }
  return attributes.join("");
}

function renderRichTextNode(node) {
  if (!node || typeof node !== "object") {
    return "";
  }

  if (node.type === "root") {
    return renderRichTextChildren(node.children);
  }
  if (node.type === "text") {
    return renderInlineTextNode(node);
  }
  if (node.type === "linebreak") {
    return "<br>";
  }
  if (node.type === "delimiter") {
    return "<hr>";
  }
  if (node.type === "paragraph-element") {
    return `<p${renderRichTextAttributes(node)}>${renderRichTextChildren(node.children)}</p>`;
  }
  if (node.type === "heading-element") {
    const tag = /^h[1-6]$/i.test(node.tag) ? node.tag.toLowerCase() : "h2";
    return `<${tag}${renderRichTextAttributes(node)}>${renderRichTextChildren(node.children)}</${tag}>`;
  }
  if (node.type === "webiny-list") {
    const tag = node.listType === "number" || node.format === "number" ? "ol" : "ul";
    return `<${tag}>${renderRichTextChildren(node.children)}</${tag}>`;
  }
  if (node.type === "webiny-listitem") {
    return `<li>${renderRichTextChildren(node.children)}</li>`;
  }
  if (node.type === "link") {
    const href = node.url ?? node.href ?? "#";
    const target = node.target ? ` target="${escapeHtml(node.target)}"` : "";
    return `<a href="${escapeHtml(href)}"${target}>${renderRichTextChildren(node.children)}</a>`;
  }
  if (node.type === "image") {
    const src = node.src ?? node.url ?? node.file?.src ?? node.file?.url ?? "";
    if (!src) {
      return "";
    }
    const alt = escapeHtml(node.altText ?? node.alt ?? "");
    const caption = node.caption ? `<figcaption>${escapeHtml(node.caption)}</figcaption>` : "";
    return `<figure><img src="${escapeHtml(src)}" alt="${alt}">${caption}</figure>`;
  }

  return renderRichTextChildren(node.children);
}

function serializeStructuredValue(value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value.root?.children)) {
      return renderRichTextNode(value.root);
    }

    if (typeof value.type === "string" && Array.isArray(value.children)) {
      return renderRichTextNode(value);
    }
  }

  return null;
}

function toSimpleValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(toSimpleValue(entry)));
  }

  if (typeof value === "object") {
    if (typeof value.html === "string") {
      return value.html;
    }
    if (typeof value.text === "string") {
      return value.text;
    }

    const structured = serializeStructuredValue(value);
    if (structured !== null) {
      return structured;
    }
  }

  return String(value);
}

function normalizeValues(item) {
  const valueSource = item.values && typeof item.values === "object"
    ? item.values
    : (item.data && typeof item.data === "object" && !Array.isArray(item.data) ? item.data : null);

  if (valueSource) {
    return Object.fromEntries(Object.entries(valueSource).map(([key, value]) => [key, toSimpleValue(value)]));
  }

  const reserved = new Set([
    "id",
    "entryId",
    "contentId",
    "contentid",
    "model",
    "modelId",
    "__typename",
    "locale",
    "localeCode",
    "tenant",
    "tenantId",
    "data",
    "createdAt",
    "createdOn",
    "updatedAt",
    "savedOn",
    "publishedOn",
    "_version",
    "_lastChangedAt",
    "status",
    "published"
  ]);

  const values = {};
  for (const [key, value] of Object.entries(item)) {
    if (reserved.has(key) || key.startsWith("_")) {
      continue;
    }
    values[key] = toSimpleValue(value);
  }
  return values;
}

function isPublished(item) {
  return item.status === "published"
    || item.published === true
    || item.isPublished === true
    || item.publishedOn != null;
}

function extractWebinyLocale(item) {
  return item.locale
    ?? item.localeCode
    ?? item.i18n?.locale?.code
    ?? item.i18n?.localeCode
    ?? null;
}

function extractWebinyTenant(item) {
  return item.tenant
    ?? item.tenantId
    ?? item.createdBy?.tenant
    ?? null;
}

export function normalizeContentItem(item) {
  const model = item.model
    ?? item.modelId
    ?? item.__typename
    ?? item.contentModel?.modelId
    ?? null;
  return {
    id: item.id,
    contentId: item.contentId ?? item.contentid ?? item.entryId ?? item.id,
    model,
    locale: extractWebinyLocale(item) ?? undefined,
    tenant: extractWebinyTenant(item) ?? undefined,
    values: normalizeValues(item),
    createdAt: item.createdAt ?? item.createdOn,
    updatedAt: item.updatedAt ?? item.savedOn ?? item.publishedOn,
    version: item._version ?? item.version,
    lastChangedAt: item._lastChangedAt ?? item.lastChangedAt
  };
}

export function matchesConfiguredTenant(item, configuredTenant) {
  if (!configuredTenant) {
    return true;
  }

  const tenant = item.tenant ?? item.tenantId ?? item.createdBy?.tenant ?? null;
  return tenant != null && String(tenant) === String(configuredTenant);
}

export async function handler(event) {
  const clients = createAwsClients();
  const tableName = process.env.S3TE_CONTENT_TABLE;
  const renderWorkerName = process.env.S3TE_RENDER_WORKER_NAME;
  const environmentName = process.env.S3TE_ENVIRONMENT;
  const configuredTenant = String(process.env.S3TE_WEBINY_TENANT ?? "").trim();
  const relevantModels = new Set(String(process.env.S3TE_RELEVANT_MODELS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean));

  let mirrored = 0;
  let deleted = 0;

  for (const record of event.Records ?? []) {
    const image = record.dynamodb?.NewImage ?? record.dynamodb?.OldImage;
    if (!image) {
      continue;
    }

    const item = clients.AWS.DynamoDB.Converter.unmarshall(image);
    if (!matchesConfiguredTenant(item, configuredTenant)) {
      continue;
    }

    const contentItem = normalizeContentItem(item);
    if (!contentItem.id || !contentItem.model || (relevantModels.size > 0 && !relevantModels.has(contentItem.model))) {
      continue;
    }

    const shouldDelete = record.eventName === "REMOVE" || !isPublished(item);
    if (shouldDelete) {
      await clients.dynamo.delete({
        TableName: tableName,
        Key: {
          id: contentItem.id
        }
      }).promise();
      deleted += 1;
      await invokeLambdaEvent(clients.lambda, renderWorkerName, {
        type: "content-item",
        action: "delete",
        environment: environmentName,
        contentId: contentItem.contentId,
        model: contentItem.model,
        buildId: `content-${Date.now()}`
      });
      continue;
    }

    await clients.dynamo.put({
      TableName: tableName,
      Item: contentItem
    }).promise();
    mirrored += 1;
    await invokeLambdaEvent(clients.lambda, renderWorkerName, {
      type: "content-item",
      action: "upsert",
      environment: environmentName,
      contentId: contentItem.contentId,
      model: contentItem.model,
      item: contentItem,
      buildId: `content-${Date.now()}`
    });
  }

  return {
    mirrored,
    deleted
  };
}
