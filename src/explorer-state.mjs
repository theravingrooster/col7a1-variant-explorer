import { EMPTY_FILTERS, filterVariants } from "./data-utils.mjs";
import { UNCLASSIFIED } from "./chart-data.mjs";
import { SORT_KEYS } from "./variant-sort.mjs";
import { CONDITION_OPTIONS, HGVS_PATTERN_OPTIONS } from "./research-data.mjs";
import { parseShortlistParam, serializeShortlistIds } from "./shortlist-state.mjs";
import { normalizeColumnFilters } from "./column-filters.mjs";

export const EXPLORER_PAGE_SIZE = 50;
export const MAX_SEARCH_LENGTH = 500;
const FILTER_KEYS = ["significance", "review", "domain", "mapping", "type", "condition", "pattern"];

function positiveInteger(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validRange(range, length = Number.MAX_SAFE_INTEGER) {
  return (
    Array.isArray(range) &&
    range.length === 2 &&
    range.every(Number.isSafeInteger) &&
    range[0] >= 1 &&
    range[1] >= range[0] &&
    range[1] <= length
  );
}

/** Restore only recognized, valid explorer state from a URL query string. */
export function readExplorerState(search, data) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  // Repeated parameters are ambiguous; ignore them rather than picking a winner.
  const one = (key) => params.getAll(key).length === 1 ? params.get(key) : null;
  const filters = { ...EMPTY_FILTERS };
  const query = one("q");
  if (query !== null) filters.query = query.slice(0, MAX_SEARCH_LENGTH);

  const allowed = {
    significance: new Set([...data.variants.flatMap((v) => v.clinicalSignificance), UNCLASSIFIED]),
    review: new Set(data.variants.flatMap((v) => v.reviewStatus)),
    domain: new Set(data.protein.domains.map((d) => d.id)),
    mapping: new Set(["mapped", "unmapped"]),
    type: new Set(data.variants.flatMap((v) => v.types)),
    condition: new Set(CONDITION_OPTIONS.map(option => option.value)),
    pattern: new Set(HGVS_PATTERN_OPTIONS.map(option => option.value)),
  };
  for (const key of FILTER_KEYS) {
    const value = one(key);
    if (allowed[key].has(value)) filters[key] = value;
  }
  const rangeText = one("range");
  if (rangeText && /^\d+-\d+$/.test(rangeText)) {
    const range = rangeText.split("-").map(Number);
    if (validRange(range, data.protein.length)) filters.range = range;
  }
  filters.columns = normalizeColumnFilters(one("columns"), data);

  const sort = SORT_KEYS.has(one("sort")) ? one("sort") : "id";
  const requestedPage = positiveInteger(one("page")) ?? 1;
  const lastPage = requestedPage > 1
    ? Math.max(0, Math.ceil(filterVariants(data.variants, filters).length / EXPLORER_PAGE_SIZE) - 1)
    : 0;
  const page = Math.min(requestedPage - 1, lastPage);
  const variant = positiveInteger(one("variant"));
  const selectedId = data.variants.some((v) => v.variationId === variant)
    ? variant
    : null;
  const shortlistIds = parseShortlistParam(one("shortlist"), data.variants);
  const comparisonOpen = one("compare") === "1" && shortlistIds.length >= 2 && selectedId === null;
  return { filters, sort, page, selectedId, shortlistIds, comparisonOpen };
}

/** Serialize known state only; default values produce a clean, empty query. */
export function writeExplorerState(state = {}) {
  const params = new URLSearchParams();
  const filters = state?.filters && !Array.isArray(state.filters)
    ? state.filters
    : {};
  if (typeof filters.query === "string" && filters.query)
    params.set("q", filters.query.slice(0, MAX_SEARCH_LENGTH));
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (
      typeof value === "string" && value && value.length <= 500 &&
      (key !== "condition" || CONDITION_OPTIONS.some(option => option.value === value)) &&
      (key !== "pattern" || HGVS_PATTERN_OPTIONS.some(option => option.value === value)) &&
      (key !== "mapping" || value === "mapped" || value === "unmapped")
    ) params.set(key, value);
  }
  if (validRange(filters.range)) params.set("range", filters.range.join("-"));
  const columns = normalizeColumnFilters(filters.columns);
  if (Object.keys(columns).length) params.set("columns", JSON.stringify(columns));
  if (SORT_KEYS.has(state?.sort) && state.sort !== "id") params.set("sort", state.sort);
  if (Number.isSafeInteger(state?.page) && state.page > 0 && state.page < Number.MAX_SAFE_INTEGER)
    params.set("page", String(state.page + 1));
  if (Number.isSafeInteger(state?.selectedId) && state.selectedId > 0)
    params.set("variant", String(state.selectedId));
  const shortlist = serializeShortlistIds(state?.shortlistIds);
  if (shortlist) params.set("shortlist", shortlist);
  if (state?.comparisonOpen && shortlist.split(",").filter(Boolean).length >= 2 && !params.has("variant")) params.set("compare", "1");
  return params;
}
