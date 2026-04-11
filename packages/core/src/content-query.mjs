function legacyAttributeValueToPlain(attribute) {
  if (attribute == null || typeof attribute !== "object") {
    return undefined;
  }

  if ("S" in attribute) {
    return attribute.S;
  }
  if ("N" in attribute) {
    return Number(attribute.N);
  }
  if ("BOOL" in attribute) {
    return Boolean(attribute.BOOL);
  }
  if ("NULL" in attribute) {
    return null;
  }
  if ("L" in attribute) {
    return attribute.L.map((entry) => legacyAttributeValueToPlain(entry));
  }

  return undefined;
}

function readComparableValue(item, field) {
  if (field === "__typename") {
    return item.model;
  }
  if (field === "contentId") {
    return item.contentId;
  }
  if (field === "id") {
    return item.id;
  }
  if (field === "locale") {
    return item.locale ?? null;
  }
  if (field === "tenant") {
    return item.tenant ?? null;
  }
  if (field === "_version") {
    return item.version ?? null;
  }
  if (field === "_lastChangedAt") {
    return item.lastChangedAt ?? null;
  }

  return item.values?.[field];
}

function compareFilter(actual, expected, filterType) {
  if (filterType === "contains") {
    if (Array.isArray(actual)) {
      return actual.includes(expected);
    }

    if (typeof actual === "string" && typeof expected === "string") {
      return actual.includes(expected);
    }
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  return actual === expected;
}

function compareOrder(a, b) {
  const aHasOrder = typeof a.values?.order === "number";
  const bHasOrder = typeof b.values?.order === "number";

  if (aHasOrder && bHasOrder) {
    if (a.values.order !== b.values.order) {
      return a.values.order - b.values.order;
    }
  } else if (aHasOrder && !bHasOrder) {
    return -1;
  } else if (!aHasOrder && bHasOrder) {
    return 1;
  }

  if (a.contentId !== b.contentId) {
    return String(a.contentId).localeCompare(String(b.contentId));
  }

  return String(a.id).localeCompare(String(b.id));
}

export function applyContentQuery(items, query) {
  const filterType = query.filterType ?? "equals";
  const clauses = query.filter ?? [];

  let results = items.filter((item) => {
    for (const clause of clauses) {
      const entries = Object.entries(clause);
      if (entries.length !== 1) {
        return false;
      }

      const [field, legacyValue] = entries[0];
      const expected = legacyAttributeValueToPlain(legacyValue);
      const actual = readComparableValue(item, field);
      if (!compareFilter(actual, expected, filterType)) {
        return false;
      }
    }

    return true;
  });

  results = results.sort(compareOrder);

  if (typeof query.limit === "number") {
    if (query.limit <= 0) {
      return [];
    }
    return results.slice(0, query.limit);
  }

  return results;
}

export function readContentField(item, field, language) {
  if (!item) {
    return null;
  }

  if (field === "__typename") {
    return item.model;
  }
  if (field === "contentId") {
    return item.contentId;
  }
  if (field === "id") {
    return item.id;
  }
  if (field === "locale") {
    return item.locale ?? null;
  }
  if (field === "tenant") {
    return item.tenant ?? null;
  }
  if (field === "_version") {
    return item.version ?? null;
  }
  if (field === "_lastChangedAt") {
    return item.lastChangedAt ?? null;
  }

  if (field === "content") {
    const preferred = item.values?.[`content${language}`];
    if (preferred !== undefined) {
      return preferred;
    }
  }

  return item.values?.[field] ?? null;
}

export function serializeContentValue(value) {
  if (value == null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const text = typeof entry === "string" && entry.includes("-")
        ? entry.slice(entry.lastIndexOf("-") + 1)
        : String(entry);
      return `<a href='${String(entry)}'>${text}</a>`;
    }).join("");
  }

  return String(value);
}
