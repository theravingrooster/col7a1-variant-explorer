export const MAX_SHORTLIST = 24;
export const STORAGE_KEY = "col7a1-shortlist-v1";
const MAX_SERIALIZED_LENGTH = 1000;

const isVariantId = value => Number.isSafeInteger(value) && value > 0;

function uniqueIds(value, knownIds = null) {
  if (!Array.isArray(value)) return [];
  const result = [], seen = new Set();
  for (const id of value) {
    if (!isVariantId(id) || seen.has(id) || (knownIds && !knownIds.has(id))) continue;
    result.push(id);
    seen.add(id);
    if (result.length === MAX_SHORTLIST) break;
  }
  return result;
}

/** Keep only identifiers in this snapshot; never persist full variant records. */
export function normalizeShortlistIds(value, variants) {
  const knownIds = new Set((Array.isArray(variants) ? variants : [])
    .map(variant => variant?.variationId).filter(isVariantId));
  return uniqueIds(value, knownIds);
}

/** A comma-separated URL list is bounded and validated independently of filters. */
export function parseShortlistParam(text, variants) {
  if (typeof text !== "string" || text.length > MAX_SERIALIZED_LENGTH) return [];
  return normalizeShortlistIds(text.split(",").filter(token => /^\d+$/.test(token)).map(Number), variants);
}

export function serializeShortlistIds(ids) {
  return uniqueIds(ids).join(",");
}

export function readSavedShortlist(storage, variants) {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (text === null) return { ids: [], notice: "" };
    if (typeof text !== "string" || text.length > MAX_SERIALIZED_LENGTH)
      return { ids: [], notice: "Saved shortlist data could not be read. A new shortlist has been started." };
    const value = JSON.parse(text);
    if (!Array.isArray(value))
      return { ids: [], notice: "Saved shortlist data could not be read. A new shortlist has been started." };
    return { ids: normalizeShortlistIds(value, variants), notice: "" };
  } catch {
    return { ids: [], notice: "The saved shortlist could not be loaded from this browser. Use a share link or CSV to keep your selections." };
  }
}

export function writeSavedShortlist(storage, ids) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(uniqueIds(ids)));
    return "";
  } catch {
    return "Changes could not be saved in this browser. Use a share link or CSV to keep this shortlist.";
  }
}

export function toggleShortlistId(ids, id, variants) {
  const normalized = normalizeShortlistIds(ids, variants);
  if (normalized.includes(id)) return { ids: normalized.filter(value => value !== id), notice: "" };
  if (!normalizeShortlistIds([id], variants).length)
    return { ids: normalized, notice: "This variant is not available in the current snapshot." };
  if (normalized.length >= MAX_SHORTLIST)
    return { ids: normalized, notice: `The shortlist holds up to ${MAX_SHORTLIST} variants. Remove one before adding another.` };
  return { ids: [...normalized, id], notice: "" };
}
