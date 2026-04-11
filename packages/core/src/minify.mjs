const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

function removeHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function removeCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function removeJsComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;])\/\/[^\n\r]*/g, "$1");
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ");
}

export function minifyHtml(html) {
  let result = removeHtmlComments(html);
  result = result.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css) => full.replace(css, removeCssComments(css)));
  result = result.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (full, js) => full.replace(js, removeJsComments(js)));
  result = collapseWhitespace(result);
  return result.trim();
}

export function repairTruncatedHtml(html) {
  let result = html;
  const lastOpen = result.lastIndexOf("<");
  const lastClose = result.lastIndexOf(">");
  if (lastOpen > lastClose) {
    result = result.slice(0, lastOpen);
  }

  const matches = result.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
  const stack = [];

  for (const rawTag of matches) {
    const tagMatch = rawTag.match(/^<\/?\s*([a-zA-Z0-9-]+)/);
    if (!tagMatch) {
      continue;
    }

    const tag = tagMatch[1].toLowerCase();
    if (VOID_TAGS.has(tag) || rawTag.endsWith("/>")) {
      continue;
    }

    if (rawTag.startsWith("</")) {
      const index = stack.lastIndexOf(tag);
      if (index !== -1) {
        stack.splice(index, 1);
      }
      continue;
    }

    stack.push(tag);
  }

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    result += `</${stack[index]}>`;
  }

  return result;
}
