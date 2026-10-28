import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MISSING_COLUMN_VALUE,
  MAX_COLUMN_FILTER_LENGTH,
  MAX_COLUMN_SELECTIONS,
  buildColumnFilterOptions,
  normalizeColumnFilters,
  matchesColumnFilters,
  isColumnFilterActive,
  clearColumnFilter,
} from "../src/column-filters.mjs";
import { EMPTY_FILTERS, filterVariants, histogram, variantsCsv } from "../src/data-utils.mjs";
import { classificationSummary, domainSummary } from "../src/chart-data.mjs";
import { readExplorerState, writeExplorerState } from "../src/explorer-state.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const template = data.variants[0];
const protein = {
  length: 100,
  domains: [
    { id: "nc1", label: "NC1", start: 1, end: 30, level: "region" },
    { id: "collagenous", label: "Collagenous", start: 31, end: 80, level: "region" },
    { id: "nc2", label: "NC2", start: 81, end: 100, level: "region" },
  ],
};
const review = "criteria provided, multiple submitters, no conflicts";
const makeVariant = (variationId, fields = {}) => ({
  ...template,
  variationId,
  codingHgvs: [`c.${variationId}A>G`],
  proteinHgvs: [`p.Gly${variationId}Arg`],
  clinicalSignificance: ["Pathogenic"],
  reviewStatus: [review],
  numberSubmitters: [1, 3],
  conditions: ["Epidermolysis bullosa dystrophica"],
  significanceGroup: "pathogenic",
  proteinMapping: { ...template.proteinMapping, status: "mapped", start: 25, end: 35, domainIds: ["nc1", "collagenous"], regionLabels: ["NC1", "Collagenous"] },
  ...fields,
});
const variants = [
  makeVariant(1),
  makeVariant(2, { clinicalSignificance: ["Uncertain significance"], significanceGroup: "uncertain", numberSubmitters: [2], conditions: ["Other condition"] }),
  makeVariant(3, { clinicalSignificance: ["Benign"], significanceGroup: "benign", reviewStatus: ["no assertion criteria provided"], numberSubmitters: [0], proteinMapping: { ...template.proteinMapping, start: 90, end: 90, domainIds: ["nc2"], regionLabels: ["NC2"] } }),
  makeVariant(4, { clinicalSignificance: [], reviewStatus: [], conditions: [], numberSubmitters: [], proteinHgvs: [], proteinMapping: { status: "unmapped", start: null, end: null, domainIds: [], regionLabels: [] } }),
  makeVariant(5, { clinicalSignificance: ["Pathogenic", "Uncertain significance", "Pathogenic"], conditions: ["Other condition", "Epidermolysis bullosa dystrophica"], numberSubmitters: [2, 5] }),
];
const fixture = { variants, protein };
const ids = rows => rows.map(variant => variant.variationId);
const filter = (columns, global = {}) => filterVariants(variants, { ...EMPTY_FILTERS, ...global, columns });

test("checkbox selections use OR within a column and AND across columns and global filters", () => {
  const columns = { significance: ["Pathogenic", "Uncertain significance"], conditions: ["Epidermolysis bullosa dystrophica", "Other condition"], review: [review], submitters: { min: "3", max: "" } };
  assert.deepEqual(ids(filter(columns)), [1, 5]);
  assert.deepEqual(ids(filter(columns, { significance: "Uncertain significance" })), [5]);
  assert.deepEqual(ids(filter(columns, { domain: "nc2" })), []);
  assert.deepEqual(ids(filter({ significance: ["Pathogenic", "Uncertain significance"] })), [1, 2, 5]);
  assert.ok(matchesColumnFilters(variants[4], columns));
});

test("missing categorical values are explicit options, distinct from named source values", () => {
  for (const field of ["significance", "review", "conditions", "domain"])
    assert.deepEqual(ids(filter({ [field]: [MISSING_COLUMN_VALUE] })), [4], field);
  assert.deepEqual(ids(filter({ significance: [MISSING_COLUMN_VALUE, "Benign"] })), [3, 4]);
  assert.deepEqual(ids(filter({ mapping: ["unmapped"] })), [4]);
  assert.deepEqual(ids(filter({ mapping: ["mapped", "unmapped"] })), [1, 2, 3, 4, 5]);
});

test("submitter ranges use the highest reported source count, never their sum; missing differs from zero", () => {
  assert.deepEqual(ids(filter({ submitters: { min: "3", max: "3" } })), [1]);
  assert.deepEqual(ids(filter({ submitters: { min: "0", max: "0" } })), [3]);
  assert.deepEqual(ids(filter({ submitters: { min: "", max: "2" } })), [2, 3]);
  assert.deepEqual(ids(filter({ submitters: { min: "6", max: "" } })), []);
});

test("position filters overlap inclusive variant spans and never assign positions to unmapped variants", () => {
  for (const start of ["25", "30", "35"])
    assert.deepEqual(ids(filter({ position: { start, end: start } })), [1, 2, 5]);
  assert.deepEqual(ids(filter({ position: { start: "36", end: "89" } })), []);
  assert.deepEqual(ids(filter({ position: { start: "", end: "90" } })), [1, 2, 3, 5]);
  assert.deepEqual(ids(filter({ position: { start: "90", end: "" } })), [3]);
  assert.deepEqual(ids(filter({ mapping: ["unmapped"], position: { start: "1", end: "100" } })), []);
});

test("HGVS searches only reported coding/protein expressions and ClinVar ID choices match exact IDs", () => {
  assert.deepEqual(ids(filter({ hgvs: "C.1a>G p.gly1ARG" })), [1]);
  assert.deepEqual(ids(filter({ hgvs: "Epidermolysis" })), []);
  assert.deepEqual(ids(filter({ hgvs: "p.Gly4Arg" })), []);
  assert.deepEqual(ids(filter({ id: "1, 3 5" })), [1, 3, 5]);
  assert.deepEqual(ids(filter({ id: "999999" })), []);
  assert.equal(matchesColumnFilters(makeVariant(123), { id: "12" }), false);
});

test("option counts count each variant once per value and retain original condition values", () => {
  const options = buildColumnFilterOptions(variants, protein);
  assert.equal(options.proteinLength, 100);
  assert.deepEqual(options.significance.find(option => option.value === "Pathogenic"), { value: "Pathogenic", label: "Pathogenic", count: 2 });
  const condition = options.conditions.find(option => option.value === "Epidermolysis bullosa dystrophica");
  assert.equal(condition.label, "Dystrophic epidermolysis bullosa (DEB)");
  assert.equal(condition.count, 3);
  assert.equal(options.domain.find(option => option.value === "nc1").count, 3);
  assert.equal(options.domain.find(option => option.value === MISSING_COLUMN_VALUE).count, 1);
  assert.equal(options.mapping.find(option => option.value === "unmapped").count, 1);
});

test("normalization is sparse, deterministic, and canonical without mutating input", () => {
  const raw = { id: "005, 1 5", position: { start: "025" }, significance: ["Uncertain significance", "Pathogenic", "Pathogenic"], submitters: { min: "", max: "" }, hgvs: "  c.1A>G   p.Gly1Arg  " };
  const before = structuredClone(raw);
  const expected = { hgvs: "c.1A>G p.Gly1Arg", significance: ["Pathogenic", "Uncertain significance"], position: { start: "25", end: "" }, id: "1,5" };
  assert.deepEqual(normalizeColumnFilters(raw, fixture), expected);
  assert.deepEqual(normalizeColumnFilters(JSON.stringify(raw), fixture), expected);
  assert.deepEqual(normalizeColumnFilters(expected, fixture), expected);
  assert.deepEqual(raw, before);
  assert.deepEqual(normalizeColumnFilters({ review: [], hgvs: " ", id: "", position: {} }, fixture), {});
});

test("malformed, unknown and oversized payloads are rejected whole rather than partially changing a cohort", () => {
  const invalid = [null, [], 3, "{", "[]", { unknown: "x" }, { significance: "Pathogenic" }, { significance: ["Pathogenic", "invented"] }, { domain: ["unknown"] }, { mapping: ["all"] }, { review: [null] }, { hgvs: "x".repeat(501) }, { hgvs: [] }, { id: "1," }, { id: "0" }, { id: "1e3" }, { id: "-1" }, { id: "9007199254740992" }, { id: "1 ".repeat(1001) }, { position: { start: "0" } }, { position: { start: "101" } }, { position: { start: "50", end: "49" } }, { position: { start: "1.5" } }, { position: { start: 1 } }, { position: { start: "1", extra: "2" } }, { submitters: { min: "-1" } }, { submitters: { max: "Infinity" } }, { submitters: { min: "2", max: "1" } }, { conditions: Array(MAX_COLUMN_SELECTIONS + 1).fill("Other condition") }];
  for (const value of invalid) assert.deepEqual(normalizeColumnFilters(value, fixture), {}, JSON.stringify(value));
  assert.deepEqual(normalizeColumnFilters({ hgvs: "c.1A>G", domain: ["unknown"] }, fixture), {});
  assert.deepEqual(normalizeColumnFilters(" ".repeat(MAX_COLUMN_FILTER_LENGTH + 1)), {});
  assert.deepEqual(normalizeColumnFilters({ conditions: Array.from({ length: 30 }, (_, index) => `${index}${"x".repeat(600)}`) }), {});
});

test("all current source choices fit a single lossless canonical URL and legacy URLs remain compatible", () => {
  const options = buildColumnFilterOptions(data.variants, data.protein);
  const columns = normalizeColumnFilters(Object.fromEntries(["significance", "review", "domain", "mapping", "conditions"].map(field => [field, options[field].map(option => option.value)])), data);
  assert.equal(Object.keys(columns).length, 5);
  const params = writeExplorerState({ filters: { ...EMPTY_FILTERS, columns }, sort: "position" });
  assert.ok(params.get("columns").length < MAX_COLUMN_FILTER_LENGTH);
  const state = readExplorerState(`?${params}`, data);
  assert.deepEqual(state.filters.columns, columns);
  assert.equal(writeExplorerState(state).toString(), params.toString());
  const legacy = readExplorerState("?mapping=unmapped&sort=position", data);
  assert.deepEqual(legacy.filters.columns, {});
  assert.equal(writeExplorerState(legacy).toString(), "mapping=unmapped&sort=position");
  const duplicated = new URLSearchParams(params);
  duplicated.append("columns", params.get("columns"));
  assert.deepEqual(readExplorerState(`?${duplicated}`, data).filters.columns, {});
});

test("URL restoring applies columns before page clamping and retains all field types", () => {
  const columns = normalizeColumnFilters({ hgvs: "p.Gly1Arg", significance: ["Pathogenic"], review: [review], submitters: { min: "3", max: "3" }, domain: ["nc1", "collagenous"], mapping: ["mapped"], position: { start: "25", end: "35" }, conditions: ["Epidermolysis bullosa dystrophica"], id: "1,2" }, fixture);
  const params = writeExplorerState({ filters: { ...EMPTY_FILTERS, columns }, page: 99 });
  const state = readExplorerState(`?${params}`, fixture);
  assert.deepEqual(state.filters.columns, columns);
  assert.equal(state.page, 0);
  assert.deepEqual(ids(filterVariants(variants, state.filters)), [1]);
});

test("position's menu owns its mapping constraint; clearing other columns preserves independent controls", () => {
  const columns = { mapping: ["unmapped"], domain: ["nc1"], significance: ["Pathogenic"], review: [review], submitters: { min: "2", max: "" } };
  assert.ok(isColumnFilterActive(columns, "position"));
  assert.ok(isColumnFilterActive(columns, "domain"));
  assert.equal(isColumnFilterActive({}, "position"), false);
  assert.equal(isColumnFilterActive({ position: { start: "", end: "" } }, "position"), false);
  assert.deepEqual(clearColumnFilter(columns, "position"), { domain: ["nc1"], significance: ["Pathogenic"], review: [review], submitters: { min: "2", max: "" } });
  assert.deepEqual(clearColumnFilter(columns, "review").submitters, columns.submitters);
  assert.deepEqual(clearColumnFilter(columns, "domain").mapping, columns.mapping);
  assert.deepEqual(columns.mapping, ["unmapped"]);
});

test("the same column-filtered cohort drives CSV, map histogram and summary charts", () => {
  const columns = { significance: ["Pathogenic", "Uncertain significance"], submitters: { min: "3", max: "" }, position: { start: "30", end: "30" } };
  const selected = filter(columns);
  assert.deepEqual(ids(selected), [1, 5]);
  const csv = variantsCsv(selected, protein.domains);
  assert.deepEqual([...csv.matchAll(/^"(\d+)",/gm)].map(match => Number(match[1])), [1, 5]);
  assert.ok(csv.includes('"Coding HGVS","Protein HGVS"'));
  assert.equal(histogram(selected, protein.length).reduce((sum, bin) => sum + bin.total, 0), 2);
  const classification = classificationSummary(selected, variants);
  assert.equal(classification.find(item => item.key === "Pathogenic").count, 2);
  assert.equal(classification.find(item => item.key === "Uncertain significance").count, 1);
  const domains = domainSummary(selected, protein.domains, classification);
  assert.deepEqual(domains.map(item => [item.label, item.total]), [["NC1", 2], ["Collagenous", 2], ["NC2", 0]]);
});
