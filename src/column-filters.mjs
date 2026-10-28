import { conditionDisplayLabel } from "./condition-labels.mjs";
import { submitterCounts } from "./evidence.mjs";

export const MISSING_COLUMN_VALUE = "__missing__";
export const MAX_COLUMN_FILTER_LENGTH = 16384;
export const MAX_COLUMN_SELECTIONS = 128;
export const MAX_COLUMN_HGVS_LENGTH = 500;
export const MAX_COLUMN_ID_LENGTH = 2000;

const CATEGORICAL_FIELDS = ["significance", "review", "domain", "mapping", "conditions"];
const COLUMN_FIELDS = ["hgvs", "significance", "review", "submitters", "domain", "mapping", "position", "conditions", "id"];
const COLUMN_GROUPS = Object.fromEntries(COLUMN_FIELDS.map(field => [field, field === "position" ? ["position", "mapping"] : [field]]));
const SOURCE_FIELDS = { significance: "clinicalSignificance", review: "reviewStatus", conditions: "conditions" };
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const valuesOrMissing = values => {
  const present = [...new Set((values || []).filter(value => typeof value === "string" && value.length))];
  return present.length ? present : [MISSING_COLUMN_VALUE];
};

function categoryValues(variant, field) {
  if (field === "domain") return valuesOrMissing(variant.proteinMapping?.domainIds);
  if (field === "mapping") return [variant.proteinMapping?.status];
  return valuesOrMissing(variant[SOURCE_FIELDS[field]]);
}

/** Options describe source entries, with counts across the complete snapshot. */
export function buildColumnFilterOptions(variants, protein) {
  const counts = Object.fromEntries(CATEGORICAL_FIELDS.map(field => [field, new Map()]));
  for (const variant of variants) {
    for (const field of CATEGORICAL_FIELDS) {
      for (const value of categoryValues(variant, field)) {
        if (typeof value === "string") counts[field].set(value, (counts[field].get(value) || 0) + 1);
      }
    }
  }
  const sourceOptions = field => [...counts[field]].map(([value, count]) => ({
    value,
    label: value === MISSING_COLUMN_VALUE ? "Not reported" : field === "conditions" ? conditionDisplayLabel(value) : value,
    count,
  })).sort((a, b) => a.value === MISSING_COLUMN_VALUE ? 1 : b.value === MISSING_COLUMN_VALUE ? -1 : compareText(a.label, b.label));
  const domains = [...(protein?.domains || [])].sort((a, b) => a.start - b.start || b.end - a.end || compareText(a.id, b.id));
  const domain = domains.map(item => ({
    value: item.id,
    label: `${item.label} · aa ${item.start}–${item.end}`,
    count: counts.domain.get(item.id) || 0,
  }));
  if (counts.domain.has(MISSING_COLUMN_VALUE)) domain.push({ value: MISSING_COLUMN_VALUE, label: "No assigned domain", count: counts.domain.get(MISSING_COLUMN_VALUE) });
  return {
    significance: sourceOptions("significance"),
    review: sourceOptions("review"),
    domain,
    mapping: [
      { value: "mapped", label: "Protein position mapped", count: counts.mapping.get("mapped") || 0 },
      { value: "unmapped", label: "No mapped protein position", count: counts.mapping.get("unmapped") || 0 },
    ],
    conditions: sourceOptions("conditions"),
    proteinLength: protein?.length,
  };
}

function normalizedRange(value, keys, minimum, maximum) {
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))) return null;
  const range = {};
  for (const key of keys) {
    const raw = value[key] ?? "";
    if (typeof raw !== "string" || (raw && !/^\d+$/.test(raw))) return null;
    const number = raw ? Number(raw) : null;
    if (number !== null && (!Number.isSafeInteger(number) || number < minimum || number > maximum)) return null;
    range[key] = number === null ? "" : String(number);
  }
  if (range[keys[0]] && range[keys[1]] && Number(range[keys[0]]) > Number(range[keys[1]])) return null;
  return range;
}

/**
 * Normalize one complete column-filter payload. Invalid payloads are rejected
 * whole instead of truncating a selection into a different research cohort.
 * Dataset validation is used when restoring a shared URL; text/IDs remain queries.
 */
export function normalizeColumnFilters(raw, data) {
  if (typeof raw === "string") {
    if (raw.length > MAX_COLUMN_FILTER_LENGTH) return {};
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  if (!isRecord(raw) || Object.keys(raw).some(key => !COLUMN_FIELDS.includes(key))) return {};
  try {
    if (JSON.stringify(raw).length > MAX_COLUMN_FILTER_LENGTH) return {};
  } catch { return {}; }
  const options = data ? buildColumnFilterOptions(data.variants, data.protein) : null;
  const normalized = {};
  for (const field of COLUMN_FIELDS) {
    if (!Object.hasOwn(raw, field)) continue;
    const value = raw[field];
    if (CATEGORICAL_FIELDS.includes(field)) {
      if (!Array.isArray(value) || value.length > MAX_COLUMN_SELECTIONS || value.some(item => typeof item !== "string" || !item || item.length > 1000)) return {};
      const allowed = options ? new Set(options[field].map(option => option.value)) : field === "mapping" ? new Set(["mapped", "unmapped"]) : null;
      if (allowed && value.some(item => !allowed.has(item))) return {};
      if (value.length) normalized[field] = [...new Set(value)].sort(compareText);
    } else if (field === "submitters" || field === "position") {
      const keys = field === "submitters" ? ["min", "max"] : ["start", "end"];
      const range = normalizedRange(value, keys, field === "submitters" ? 0 : 1, field === "position" ? data?.protein?.length ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
      if (!range) return {};
      if (range[keys[0]] || range[keys[1]]) normalized[field] = range;
    } else if (field === "hgvs") {
      if (typeof value !== "string" || value.length > MAX_COLUMN_HGVS_LENGTH) return {};
      const query = value.trim().replace(/\s+/g, " ");
      if (query) normalized.hgvs = query;
    } else if (field === "id") {
      if (typeof value !== "string" || value.length > MAX_COLUMN_ID_LENGTH) return {};
      const query = value.trim();
      if (!query) continue;
      if (!/^\d+(?:[\s,]+\d+)*$/.test(query)) return {};
      const ids = query.split(/[\s,]+/).map(Number);
      if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return {};
      normalized.id = [...new Set(ids)].sort((a, b) => a - b).join(",");
    }
  }
  return normalized;
}

/** Build once for the shared table, chart, map and export filtering pass. */
export function columnFilterPredicate(columns = {}) {
  const selections = CATEGORICAL_FIELDS.filter(field => columns[field]?.length).map(field => [field, new Set(columns[field])]);
  const hgvsTerms = (columns.hgvs || "").toLowerCase().split(/\s+/).filter(Boolean);
  const ids = columns.id ? new Set(columns.id.split(/[\s,]+/).map(Number)) : null;
  const submitters = columns.submitters;
  const position = columns.position;
  return variant => {
    if (selections.some(([field, selected]) => !categoryValues(variant, field).some(value => selected.has(value)))) return false;
    if (hgvsTerms.length) {
      const hgvs = [...(variant.codingHgvs || []), ...(variant.proteinHgvs || [])].join(" ").toLowerCase();
      if (!hgvsTerms.every(term => hgvs.includes(term))) return false;
    }
    if (ids && !ids.has(variant.variationId)) return false;
    if (submitters && (submitters.min || submitters.max)) {
      // Source counts can differ between records; adding them would double-count.
      const count = submitterCounts(variant).at(-1);
      if (count === undefined || (submitters.min && count < Number(submitters.min)) || (submitters.max && count > Number(submitters.max))) return false;
    }
    if (position && (position.start || position.end)) {
      const mapping = variant.proteinMapping;
      if (mapping?.status !== "mapped" || (position.start && mapping.end < Number(position.start)) || (position.end && mapping.start > Number(position.end))) return false;
    }
    return true;
  };
}

export function matchesColumnFilters(variant, columns) {
  return columnFilterPredicate(columns)(variant);
}

export function isColumnFilterActive(columns = {}, field) {
  return (COLUMN_GROUPS[field] || []).some(key => {
    const value = columns?.[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return isRecord(value) && Object.values(value).some(item => typeof item === "string" && item.length > 0);
  });
}

export function clearColumnFilter(columns = {}, field) {
  const next = { ...columns };
  for (const key of COLUMN_GROUPS[field] || []) delete next[key];
  return next;
}
