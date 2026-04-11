import path from "node:path";

import { assert, S3teError } from "./errors.mjs";
import { getContentTypeForPath } from "./mime.mjs";
import { minifyHtml, repairTruncatedHtml } from "./minify.mjs";
import { readContentField, serializeContentValue } from "./content-query.mjs";

function createWarning(code, message, sourceKey) {
  return { code, message, sourceKey };
}

function stripLeadingWhitespace(value) {
  return value.replace(/^\s+/, "");
}

function findTagRange(input, tagName, startIndex = 0) {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const start = input.indexOf(openTag, startIndex);
  if (start === -1) {
    return null;
  }

  const end = input.indexOf(closeTag, start + openTag.length);
  if (end === -1) {
    throw new S3teError("TEMPLATE_SYNTAX_ERROR", `Missing closing tag for ${tagName}.`);
  }

  return {
    start,
    end,
    innerStart: start + openTag.length,
    innerEnd: end
  };
}

function findNextTag(input, tagNames) {
  let match = null;
  for (const tagName of tagNames) {
    const index = input.indexOf(`<${tagName}>`);
    if (index === -1) {
      continue;
    }

    if (!match || index < match.index) {
      match = { tagName, index };
    }
  }

  return match;
}

function parseJsonPayload(raw, tagName) {
  try {
    return JSON.parse(raw.trim());
  } catch (error) {
    throw new S3teError("TEMPLATE_SYNTAX_ERROR", `Invalid JSON payload in <${tagName}>.`, {
      tagName,
      cause: error.message
    });
  }
}

function ensureKnownKeys(object, knownKeys, tagName) {
  for (const key of Object.keys(object)) {
    if (!knownKeys.has(key)) {
      throw new S3teError("TEMPLATE_SYNTAX_ERROR", `Unknown property ${key} in <${tagName}>.`, { tagName, key });
    }
  }
}

function randomIntInclusive(minimum, maximum) {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function formatDateValue(value, locale) {
  let timestamp = Number(value);
  if (timestamp < 1_000_000_000_000) {
    timestamp *= 1000;
  }

  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (locale === "de") {
    return `${day}.${month}.${year}`;
  }

  return `${month}/${day}/${year}`;
}

function nthIndex(haystack, needle, occurrence) {
  if (occurrence <= 0) {
    return 0;
  }
  let index = -1;
  for (let current = 0; current < occurrence; current += 1) {
    index = haystack.indexOf(needle, index + 1);
    if (index === -1) {
      return -1;
    }
  }
  return index;
}

export function isRenderableKey(config, sourceKey) {
  const extension = path.extname(sourceKey).toLowerCase();
  return config.rendering.renderExtensions.includes(extension);
}

async function applyIfTags(input, state) {
  let output = input;
  let range = findTagRange(output, "if");
  while (range) {
    const payload = parseJsonPayload(output.slice(range.innerStart, range.innerEnd), "if");
    ensureKnownKeys(payload, new Set(["env", "file", "not", "template"]), "if");
    assert(typeof payload.template === "string", "TEMPLATE_SYNTAX_ERROR", "<if> requires template.");

    const conditions = [];
    if (payload.env !== undefined) {
      conditions.push(String(payload.env).toLowerCase() === state.target.environment.toLowerCase());
    }
    if (payload.file !== undefined) {
      conditions.push(String(payload.file).toLowerCase() === state.target.outputKey.toLowerCase());
    }

    let matched = !conditions.includes(false);
    if (payload.not === true) {
      matched = !matched;
    }

    const replacement = matched ? payload.template : "";
    output = `${output.slice(0, range.start)}${replacement}${output.slice(range.end + 5)}`;
    range = findTagRange(output, "if");
  }
  return output;
}

async function applyFileAttributeTags(input, state) {
  let output = input;
  let range = findTagRange(output, "fileattribute");
  while (range) {
    const attribute = output.slice(range.innerStart, range.innerEnd).trim();
    let replacement = "";
    if (attribute === "filename") {
      replacement = state.target.outputKey;
    } else {
      state.warnings.push(createWarning("UNSUPPORTED_TAG", `Unsupported fileattribute ${attribute}.`, state.target.sourceKey));
    }
    output = `${output.slice(0, range.start)}${replacement}${output.slice(range.end + "</fileattribute>".length)}`;
    range = findTagRange(output, "fileattribute");
  }
  return output;
}

async function resolveContentById(contentId, state) {
  state.dependencies.add(`content#${contentId}`);
  const item = await state.contentRepository.getByContentId(contentId, state.target.language);
  if (!item) {
    state.warnings.push(createWarning("MISSING_CONTENT", `Missing content ${contentId}.`, state.target.sourceKey));
    return "";
  }

  const preferredField = `content${state.target.language}`;
  const rawContent = item.values[preferredField] ?? item.values.content;
  if (rawContent == null) {
    state.warnings.push(createWarning("MISSING_CONTENT", `Content ${contentId} has no content field.`, state.target.sourceKey));
    return "";
  }

  return serializeContentValue(rawContent);
}

async function applyLanguageTags(input, state, renderFragment) {
  let output = input;

  let range = findTagRange(output, "lang");
  while (range) {
    const command = output.slice(range.innerStart, range.innerEnd).trim();
    let replacement = "";
    if (command === "2") {
      replacement = state.target.language;
    } else if (command === "baseurl") {
      replacement = state.target.baseUrl;
    } else {
      state.warnings.push(createWarning("UNSUPPORTED_TAG", `Unsupported <lang>${command}</lang> command.`, state.target.sourceKey));
    }
    output = `${output.slice(0, range.start)}${replacement}${output.slice(range.end + 7)}`;
    range = findTagRange(output, "lang");
  }

  range = findTagRange(output, "switchlang");
  while (range) {
    const block = output.slice(range.innerStart, range.innerEnd);
    const startToken = `<${state.target.language}>`;
    const endToken = `</${state.target.language}>`;
    const start = block.indexOf(startToken);
    const end = block.indexOf(endToken);
    let replacement = "";
    if (start === -1 || end === -1) {
      state.warnings.push(createWarning("MISSING_LANGUAGE", `Missing switchlang block for ${state.target.language}.`, state.target.sourceKey));
    } else {
      replacement = block.slice(start + startToken.length, end);
      replacement = await renderFragment(replacement, { ...state, depth: state.depth + 1 });
    }
    output = `${output.slice(0, range.start)}${replacement}${output.slice(range.end + "</switchlang>".length)}`;
    range = findTagRange(output, "switchlang");
  }

  return output;
}

async function applyDbMultifileItemTags(input, state) {
  let output = input;
  let range = findTagRange(output, "dbmultifileitem");
  while (range) {
    let replacement = "";
    const rawPayload = output.slice(range.innerStart, range.innerEnd).trim();

    if (!state.currentItem) {
      state.warnings.push(createWarning("MISSING_CONTENT", "dbmultifileitem requires a current content item.", state.target.sourceKey));
    } else if (rawPayload.startsWith("{")) {
      const command = parseJsonPayload(rawPayload, "dbmultifileitem");
      ensureKnownKeys(command, new Set(["field", "limit", "limitlow", "format", "locale", "divideattag", "startnumber", "endnumber"]), "dbmultifileitem");
      assert(typeof command.field === "string" && command.field.length > 0, "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem command requires field.");

      const transformModes = Number(command.limit !== undefined) + Number(command.format !== undefined) + Number(command.divideattag !== undefined);
      assert(transformModes <= 1, "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem command may only use one transform mode.");

      const rawValue = readContentField(state.currentItem, command.field, state.target.language);
      const stringValue = serializeContentValue(rawValue);

      if (command.limit !== undefined) {
        assert(Number.isInteger(command.limit) && command.limit >= 0, "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem limit must be a non-negative integer.");
        if (command.limitlow !== undefined) {
          assert(Number.isInteger(command.limitlow) && command.limitlow >= 0, "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem limitlow must be a non-negative integer.");
          assert(command.limitlow <= command.limit, "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem limitlow must not exceed limit.");
        }

        let effectiveLimit = command.limit;
        if (command.limitlow !== undefined) {
          effectiveLimit = randomIntInclusive(command.limitlow, command.limit);
        }

        if (effectiveLimit === 0 || effectiveLimit >= stringValue.length) {
          replacement = stringValue;
        } else {
          replacement = repairTruncatedHtml(`${stringValue.slice(0, effectiveLimit)}...`);
        }
      } else if (command.format !== undefined) {
        assert(command.format === "date", "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem only supports format=date.");
        replacement = formatDateValue(rawValue, command.locale);
      } else if (command.divideattag !== undefined) {
        assert(typeof command.divideattag === "string" && command.divideattag.length > 0, "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem divideattag must be a string.");
        if (command.startnumber !== undefined) {
          assert(Number.isInteger(command.startnumber) && command.startnumber >= 1, "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem startnumber must be >= 1.");
        }
        if (command.endnumber !== undefined) {
          assert(Number.isInteger(command.endnumber) && command.endnumber >= 1, "TEMPLATE_SYNTAX_ERROR", "dbmultifileitem endnumber must be >= 1.");
        }

        const startIndex = command.startnumber ? nthIndex(stringValue, command.divideattag, command.startnumber) : 0;
        const endIndex = command.endnumber ? nthIndex(stringValue, command.divideattag, command.endnumber) : stringValue.length;

        if (startIndex === -1) {
          state.warnings.push(createWarning("MISSING_CONTENT", `divideattag startnumber ${command.startnumber} was not found.`, state.target.sourceKey));
          replacement = "";
        } else {
          replacement = stringValue.slice(startIndex, endIndex === -1 ? stringValue.length : endIndex);
        }
      } else {
        replacement = stringValue;
      }
    } else {
      const field = rawPayload;
      const value = readContentField(state.currentItem, field, state.target.language);
      replacement = serializeContentValue(value);
    }

    output = `${output.slice(0, range.start)}${replacement}${output.slice(range.end + "</dbmultifileitem>".length)}`;
    range = findTagRange(output, "dbmultifileitem");
  }
  return output;
}

async function createRenderFragment() {
  const renderFragment = async (input, state) => {
    assert(state.depth <= state.config.rendering.maxRenderDepth, "TEMPLATE_CYCLE_ERROR", "Maximum render depth exceeded.", {
      sourceKey: state.target.sourceKey
    });

    let output = input;
    output = await applyIfTags(output, state);
    output = await applyFileAttributeTags(output, state);

    while (true) {
      const next = findNextTag(output, ["part", "dbpart", "dbmulti", "dbitem"]);
      if (!next) {
        break;
      }

      const range = findTagRange(output, next.tagName, next.index);
      const rawPayload = output.slice(range.innerStart, range.innerEnd);
      let replacement = "";

      if (next.tagName === "part") {
        const requestedPath = rawPayload.trim().replace(/\\/g, "/");
        assert(requestedPath && !requestedPath.startsWith("/") && !requestedPath.split("/").includes(".."), "TEMPLATE_SYNTAX_ERROR", "Invalid <part> path.", {
          requestedPath
        });
        if (state.includeStack.includes(requestedPath)) {
          throw new S3teError("TEMPLATE_CYCLE_ERROR", `Include cycle detected for ${requestedPath}.`, {
            includeStack: [...state.includeStack, requestedPath]
          });
        }
        state.dependencies.add(`partial#${requestedPath}`);
        const partKey = `${state.variant.partDir}/${requestedPath}`.replace(/\\/g, "/");
        const partFile = await state.templateRepository.get(partKey);
        if (!partFile) {
          state.warnings.push(createWarning("MISSING_PART", `Missing partial ${requestedPath}.`, state.target.sourceKey));
        } else {
          replacement = await renderFragment(String(partFile.body), {
            ...state,
            depth: state.depth + 1,
            includeStack: [...state.includeStack, requestedPath]
          });
        }
      } else if (next.tagName === "dbpart") {
        replacement = await resolveContentById(rawPayload.trim(), state);
        if (replacement) {
          replacement = await renderFragment(replacement, { ...state, depth: state.depth + 1 });
        }
      } else if (next.tagName === "dbmulti") {
        const command = parseJsonPayload(rawPayload, "dbmulti");
        ensureKnownKeys(command, new Set(["filter", "filtertype", "limit", "template"]), "dbmulti");
        assert(Array.isArray(command.filter), "TEMPLATE_SYNTAX_ERROR", "<dbmulti> requires filter array.");
        assert(typeof command.template === "string", "TEMPLATE_SYNTAX_ERROR", "<dbmulti> requires template string.");
        const items = await state.contentRepository.query({
          filter: command.filter,
          filterType: command.filtertype ?? "equals",
          operator: "AND",
          limit: command.limit
        }, state.target.language);
        const renderedItems = [];
        for (const item of items) {
          state.dependencies.add(`content#${item.contentId}`);
          renderedItems.push(await renderFragment(command.template, {
            ...state,
            depth: state.depth + 1,
            currentItem: item
          }));
        }
        replacement = renderedItems.join("");
      } else if (next.tagName === "dbitem") {
        const field = rawPayload.trim();
        if (!state.currentItem) {
          state.warnings.push(createWarning("MISSING_CONTENT", `<dbitem>${field}</dbitem> has no current content item.`, state.target.sourceKey));
          replacement = "";
        } else {
          const value = readContentField(state.currentItem, field, state.target.language);
          if (value == null) {
            state.warnings.push(createWarning("MISSING_CONTENT", `Missing field ${field}.`, state.target.sourceKey));
            replacement = "";
          } else {
            replacement = serializeContentValue(value);
          }
        }
      }

      output = `${output.slice(0, range.start)}${replacement}${output.slice(range.end + next.tagName.length + 3)}`;
    }

    output = await applyLanguageTags(output, state, renderFragment);
    output = await applyDbMultifileItemTags(output, state);

    return output;
  };

  return renderFragment;
}

async function renderSingleTarget({ config, templateRepository, contentRepository, target, variantConfig, body, currentItem = null, templateKey }) {
  const dependencies = new Set();
  const warnings = [];
  const renderFragment = await createRenderFragment();
  const state = {
    config,
    target,
    variant: variantConfig,
    templateRepository,
    contentRepository,
    warnings,
    dependencies,
    depth: 0,
    includeStack: [],
    currentItem
  };

  let rendered = await renderFragment(body, state);
  if (config.rendering.minifyHtml) {
    rendered = minifyHtml(rendered);
  }

  if (templateKey) {
    dependencies.add(`generated-template#${templateKey}`);
  }

  return {
    target,
    artifact: {
      outputKey: target.outputKey,
      contentType: getContentTypeForPath(target.outputKey),
      body: rendered
    },
    dependencies: [...dependencies].map((entry) => {
      const [kind, ...rest] = entry.split("#");
      return { kind, id: rest.join("#") };
    }),
    generatedOutputs: templateKey ? [target.outputKey] : [],
    invalidationPaths: ["/*"],
    warnings
  };
}

function buildDefaultBaseUrl(url) {
  return String(url).replace(/^https?:\/\//, "");
}

export async function renderSourceTemplate({ config, templateRepository, contentRepository, environment, variantName, languageCode, sourceKey }) {
  const variantConfig = config.variants[variantName];
  const languageConfig = variantConfig.languages[languageCode];
  const file = await templateRepository.get(sourceKey);
  assert(file, "TEMPLATE_SYNTAX_ERROR", `Missing source template ${sourceKey}.`);
  const body = String(file.body);
  const sourceWithinVariant = sourceKey.startsWith(`${variantName}/`) ? sourceKey.slice(variantName.length + 1) : sourceKey;

  const target = {
    environment,
    variant: variantName,
    language: languageCode,
    sourceKey,
    outputKey: sourceWithinVariant,
    baseUrl: buildDefaultBaseUrl(languageConfig.baseUrl)
  };

  const trimmed = stripLeadingWhitespace(body);
  if (trimmed.startsWith("<dbmultifile>")) {
    const range = findTagRange(trimmed, "dbmultifile");
    const command = parseJsonPayload(trimmed.slice(range.innerStart, range.innerEnd), "dbmultifile");
    ensureKnownKeys(command, new Set(["filenamesuffix", "filter", "filtertype", "limit"]), "dbmultifile");
    assert(typeof command.filenamesuffix === "string" && command.filenamesuffix.length > 0, "TEMPLATE_SYNTAX_ERROR", "dbmultifile requires filenamesuffix.");
    assert(Array.isArray(command.filter), "TEMPLATE_SYNTAX_ERROR", "dbmultifile requires filter array.");
    const bodyTemplate = trimmed.slice(range.end + "</dbmultifile>".length);
    const items = await contentRepository.query({
      filter: command.filter,
      filterType: command.filtertype ?? "equals",
      operator: "AND",
      limit: command.limit
    }, languageCode);

    const seenNames = new Set();
    const results = [];
    for (const item of items) {
      const suffixRaw = readContentField(item, command.filenamesuffix, languageCode);
      const suffix = serializeContentValue(suffixRaw).trim();
      assert(suffix.length > 0, "TEMPLATE_SYNTAX_ERROR", "dbmultifile generated empty filename suffix.", { sourceKey });
      assert(!/[\\/:]/.test(suffix), "TEMPLATE_SYNTAX_ERROR", "dbmultifile filename suffix contains invalid characters.", { suffix, sourceKey });

      const extension = path.extname(target.outputKey);
      const base = extension ? target.outputKey.slice(0, -extension.length) : target.outputKey;
      const generatedOutputKey = `${base}-${suffix}${extension}`;
      assert(!seenNames.has(generatedOutputKey), "TEMPLATE_SYNTAX_ERROR", "dbmultifile generated duplicate output name.", { generatedOutputKey, sourceKey });
      seenNames.add(generatedOutputKey);

      results.push(await renderSingleTarget({
        config,
        templateRepository,
        contentRepository,
        variantConfig,
        target: { ...target, outputKey: generatedOutputKey },
        body: bodyTemplate,
        currentItem: item,
        templateKey: sourceKey
      }));
    }
    return results;
  }

  return [
    await renderSingleTarget({
      config,
      templateRepository,
      contentRepository,
      variantConfig,
      target,
      body,
      templateKey: sourceKey
    })
  ];
}

export function createManualRenderTargets({ config, templateEntries, environment, variant, language, entry }) {
  const targets = [];
  const variants = variant ? [variant] : Object.keys(config.variants);

  for (const variantName of variants) {
    const variantConfig = config.variants[variantName];
    const languages = language ? [language] : Object.keys(variantConfig.languages);
    for (const languageCode of languages) {
      for (const templateEntry of templateEntries) {
        if (!templateEntry.key.startsWith(`${variantName}/`)) {
          continue;
        }
        if (!isRenderableKey(config, templateEntry.key)) {
          continue;
        }
        if (entry && templateEntry.key !== entry) {
          continue;
        }

        const outputKey = templateEntry.key.slice(variantName.length + 1);
        targets.push({
          environment,
          variant: variantName,
          language: languageCode,
          sourceKey: templateEntry.key,
          outputKey,
          baseUrl: config.variants[variantName].languages[languageCode].baseUrl
        });
      }
    }
  }

  return targets;
}
