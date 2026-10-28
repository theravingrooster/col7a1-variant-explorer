import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SORT_KEYS, SORT_OPTIONS, TABLE_SORT_FIELDS, sortVariants } from "../src/variant-sort.mjs";
import { EMPTY_FILTERS, filterVariants, variantsCsv } from "../src/data-utils.mjs";
import { EXPLORER_PAGE_SIZE, readExplorerState, writeExplorerState } from "../src/explorer-state.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const make = (variationId, overrides = {}) => ({
  variationId, codingHgvs: [], proteinHgvs: [], clinicalSignificance: [], reviewStatus: [], numberSubmitters: [], conditions: [],
  proteinMapping: { status: "unmapped", start: null, regionLabels: [] }, ...overrides,
});
const ids = variants => variants.map(v => v.variationId);

function freezeDeep(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === "object" && !Object.isFrozen(child)) freezeDeep(child);
  return value;
}

test("HGVS uses natural case-insensitive order, protein fallback, and missing values last", () => {
  const variants = [
    make(4), make(3, { codingHgvs: ["c.10A>G"] }), make(2, { codingHgvs: ["c.2A>G"] }),
    make(1, { codingHgvs: ["C.2a>g"] }), make(5, { proteinHgvs: ["p.Arg20Gly"] }),
  ];
  assert.deepEqual(ids(sortVariants(variants, "hgvs")), [1, 2, 3, 5, 4]);
  assert.deepEqual(ids(sortVariants(variants, "hgvs-desc")), [5, 3, 1, 2, 4]);
});

test("classification and conditions follow source text without clinical-severity inference", () => {
  const variants = [
    make(3, { clinicalSignificance: ["Pathogenic/Likely pathogenic"], conditions: ["Condition 10", "Other"] }),
    make(2, { clinicalSignificance: ["Benign"], conditions: ["Condition 2"] }),
    make(1, { clinicalSignificance: ["Uncertain significance"], conditions: ["alpha"] }),
    make(4),
  ];
  assert.deepEqual(ids(sortVariants(variants, "significance")), [2, 3, 1, 4]);
  assert.deepEqual(ids(sortVariants(variants, "significance-desc")), [1, 3, 2, 4]);
  assert.deepEqual(ids(sortVariants(variants, "conditions")), [1, 2, 3, 4]);
  assert.deepEqual(ids(sortVariants(variants, "conditions-desc")), [3, 2, 1, 4]);
});

test("review sorting uses the visible label alphabetically, with missing review last", () => {
  const variants = [
    make(1, { reviewStatus: ["no assertion criteria provided"] }),
    make(2, { reviewStatus: ["practice guideline"] }),
    make(3, { reviewStatus: ["reviewed by expert panel"] }),
    make(4, { reviewStatus: ["criteria provided, multiple submitters, no conflicts"] }),
    make(5, { reviewStatus: ["criteria provided, single submitter"] }), make(6),
  ];
  assert.deepEqual(ids(sortVariants(variants, "review")), [3, 4, 1, 2, 5, 6]);
  assert.deepEqual(ids(sortVariants(variants, "review-desc")), [5, 2, 1, 4, 3, 6]);
});

test("submitter sorting uses highest source count without summing or losing zero", () => {
  const variants = [
    make(1, { numberSubmitters: [0] }), make(2, { numberSubmitters: [7] }),
    make(3, { numberSubmitters: [2, 9] }), make(4, { numberSubmitters: [5, 6] }),
    make(5, { numberSubmitters: [9] }), make(6),
  ];
  assert.deepEqual(ids(sortVariants(variants, "submitters")), [1, 4, 2, 3, 5, 6]);
  assert.deepEqual(ids(sortVariants(variants, "submitters-desc")), [3, 5, 2, 4, 1, 6]);
});

test("domain and position sorts are independent and keep unmapped variants last in either direction", () => {
  const variants = [
    make(3, { proteinMapping: { status: "mapped", start: 2800, regionLabels: ["NC2"] } }),
    make(2, { proteinMapping: { status: "mapped", start: 2000, regionLabels: ["Collagenous"] } }),
    make(1, { proteinMapping: { status: "mapped", start: 20, regionLabels: ["NC1"] } }), make(4),
  ];
  assert.deepEqual(ids(sortVariants(variants, "domain")), [2, 1, 3, 4]);
  assert.deepEqual(ids(sortVariants(variants, "domain-desc")), [3, 1, 2, 4]);
  assert.deepEqual(ids(sortVariants(variants, "position")), [1, 2, 3, 4]);
  assert.deepEqual(ids(sortVariants(variants, "position-desc")), [3, 2, 1, 4]);
});

test("sorting never mutates input and equal values use numeric Variation ID as a stable tie-break", () => {
  const variants = freezeDeep([make(12, { codingHgvs: ["c.2A>G"] }), make(2, { codingHgvs: ["c.2A>G"] }), make(1, { codingHgvs: ["c.2A>G"] })]);
  const before = JSON.stringify(variants);
  for (const sort of SORT_KEYS) {
    const sorted = sortVariants(variants, sort);
    assert.notEqual(sorted, variants);
    assert.deepEqual(ids(sorted), sort === "id-desc" ? [12, 2, 1] : [1, 2, 12], sort);
  }
  assert.equal(JSON.stringify(variants), before);
  assert.deepEqual(ids(sortVariants(variants, "invalid")), [1, 2, 12]);
});

test("every sort mode round-trips through shared URLs with consistent full-cohort and page ordering", () => {
  assert.equal(TABLE_SORT_FIELDS.length, 8);
  assert.equal(SORT_OPTIONS.length, 16);
  assert.equal(SORT_KEYS.size, SORT_OPTIONS.length);
  const filters = { ...EMPTY_FILTERS, significance: "Pathogenic" };
  const cohort = filterVariants(data.variants, filters);
  assert.ok(cohort.length > EXPLORER_PAGE_SIZE * 2);
  const reverse = [...cohort].reverse();
  const originalIds = ids(cohort).sort((a, b) => a - b);
  for (const { value: sort } of SORT_OPTIONS) {
    const url = writeExplorerState({ filters, sort, page: 1 });
    const restored = readExplorerState(`?${url}`, data);
    assert.equal(restored.sort, sort);
    assert.equal(restored.page, 1);
    const expected = sortVariants(cohort, sort);
    const fromUrl = sortVariants(filterVariants(data.variants, restored.filters), restored.sort);
    assert.deepEqual(ids(fromUrl), ids(expected), sort);
    assert.deepEqual(ids(sortVariants(reverse, sort)), ids(expected), `Input-order independence: ${sort}`);
    assert.deepEqual(ids(expected).sort((a, b) => a - b), originalIds, `Complete cohort: ${sort}`);
    assert.deepEqual(ids(fromUrl.slice(EXPLORER_PAGE_SIZE, EXPLORER_PAGE_SIZE * 2)), ids(expected.slice(50, 100)), `Shared second page: ${sort}`);
  }
});

test("descending positions and submitters preserve complete real cohorts, and CSV follows selected order", () => {
  for (const sort of ["position", "position-desc"]) {
    const sorted = sortVariants(data.variants, sort);
    const mapped = sorted.slice(0, data.summary.mapped);
    assert.ok(mapped.every(v => v.proteinMapping.status === "mapped"));
    assert.ok(sorted.slice(data.summary.mapped).every(v => v.proteinMapping.status === "unmapped"));
    const direction = sort.endsWith("-desc") ? -1 : 1;
    assert.ok(mapped.every((v, i) => i === 0 || (v.proteinMapping.start - mapped[i - 1].proteinMapping.start) * direction >= 0));
  }
  const cohort = filterVariants(data.variants, { ...EMPTY_FILTERS, domain: "uniprot-feature-20", significance: "Pathogenic" });
  const sorted = sortVariants(cohort, "submitters-desc");
  const csv = variantsCsv(sorted, data.protein.domains, data);
  assert.deepEqual([...csv.matchAll(/^"(\d+)",/gm)].map(match => Number(match[1])), ids(sorted));
  assert.equal(sorted.length, 25);
});
