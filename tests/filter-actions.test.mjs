import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { updateFilter, toggleDomainClassification } from "../src/filter-actions.mjs";
import { EMPTY_FILTERS, filterVariants, variantsCsv } from "../src/data-utils.mjs";
import { classificationSummary, domainSummary } from "../src/chart-data.mjs";
import { mapWindow, densityBins } from "../src/map-data.mjs";
import { readExplorerState, writeExplorerState } from "../src/explorer-state.mjs";
import { MULTIPLE_SUBMITTERS_REVIEW } from "../src/evidence.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const nc2 = data.protein.domains.find(d => d.label === "NC2");

test("choosing NC2 after a distant residue focus changes the table and map to NC2", () => {
  const original = Object.freeze({ ...EMPTY_FILTERS, range: Object.freeze([1, 25]) });
  const next = updateFilter(original, "domain", nc2.id);
  assert.deepEqual(mapWindow(data.protein, next), [2785, 2944]);
  assert.equal(filterVariants(data.variants, next).length, 225);
  assert.equal(next.range, null);
  assert.deepEqual(original.range, [1, 25]);
  assert.equal(original.domain, "");
});

test("domain selection replaces unmapped-only scope without discarding evidence filters", () => {
  const original = { ...EMPTY_FILTERS, mapping: "unmapped", query: "COL7A1", review: MULTIPLE_SUBMITTERS_REVIEW, type: "single nucleotide variant", significance: "Pathogenic" };
  const next = updateFilter(original, "domain", nc2.id);
  assert.equal(next.mapping, "");
  for (const key of ["query", "review", "type", "significance"]) assert.equal(next[key], original[key]);
  const expected = data.variants.filter(v => v.proteinMapping.domainIds.includes(nc2.id) &&
    v.clinicalSignificance.includes("Pathogenic") && v.reviewStatus.includes(MULTIPLE_SUBMITTERS_REVIEW) && v.types.includes("single nucleotide variant"));
  assert.ok(expected.length > 0);
  assert.deepEqual(filterVariants(data.variants, next).map(v => v.variationId), expected.map(v => v.variationId));
});

test("unmapped selection removes domain and range constraints while preserving other filters", () => {
  const next = updateFilter({ ...EMPTY_FILTERS, domain: nc2.id, range: [2790, 2810] }, "mapping", "unmapped");
  assert.equal(next.domain, "");
  assert.equal(next.range, null);
  assert.equal(filterVariants(data.variants, next).length, data.summary.unmapped);
  assert.deepEqual(mapWindow(data.protein, next), [1, data.protein.length]);
  const reviewed = updateFilter({ ...next, review: MULTIPLE_SUBMITTERS_REVIEW }, "mapping", "mapped");
  assert.equal(reviewed.review, MULTIPLE_SUBMITTERS_REVIEW);
});

test("a density-bin range preserves its parent domain and clearing a domain preserves a chosen range", () => {
  const next = updateFilter({ ...EMPTY_FILTERS, domain: nc2.id, mapping: "unmapped" }, "range", [2798, 2798]);
  assert.equal(next.mapping, "");
  assert.equal(next.domain, nc2.id);
  assert.deepEqual(mapWindow(data.protein, next), [2798, 2798]);
  const matches = filterVariants(data.variants, next);
  assert.ok(matches.some(v => v.variationId === 17423));
  assert.ok(matches.every(v => v.proteinMapping.start <= 2798 && v.proteinMapping.end >= 2798));
  assert.deepEqual(updateFilter(next, "domain", "").range, [2798, 2798]);
});

test("non-spatial filter changes and clearing a range leave the remaining scope intact", () => {
  const original = { ...EMPTY_FILTERS, domain: nc2.id, range: [2790, 2810], mapping: "mapped", review: MULTIPLE_SUBMITTERS_REVIEW };
  const next = updateFilter(original, "query", "id:17423");
  assert.deepEqual(next, { ...original, query: "id:17423" });
  assert.deepEqual(filterVariants(data.variants, next).map(v => v.variationId), [17423]);
  const cleared = updateFilter(next, "range", null);
  assert.equal(cleared.domain, nc2.id);
  assert.equal(cleared.mapping, "mapped");
  assert.equal(cleared.query, "id:17423");
});

test("grouped chart toggles replace spatial focus and clear the selected pair together", () => {
  const original = { ...EMPTY_FILTERS, mapping: "unmapped", range: [1, 25], query: "COL7A1", review: MULTIPLE_SUBMITTERS_REVIEW, type: "single nucleotide variant" };
  const chosen = toggleDomainClassification(original, nc2.id, "Pathogenic");
  assert.equal(chosen.domain, nc2.id);
  assert.equal(chosen.significance, "Pathogenic");
  assert.equal(chosen.mapping, "");
  assert.equal(chosen.range, null);
  for (const key of ["query", "review", "type"]) assert.equal(chosen[key], original[key]);
  const toggled = toggleDomainClassification({ ...chosen, range: [2790, 2810] }, nc2.id, "Pathogenic");
  assert.equal(toggled.domain, "");
  assert.equal(toggled.significance, "");
  assert.equal(toggled.range, null);
  for (const key of ["query", "review", "type"]) assert.equal(toggled[key], original[key]);
});

test("a grouped chart transition yields the same cohort in summaries, density, shared URL and CSV", () => {
  const next = toggleDomainClassification({ ...EMPTY_FILTERS, range: [1, 25], mapping: "unmapped" }, nc2.id, "Pathogenic");
  const results = filterVariants(data.variants, next);
  assert.equal(results.length, 25);
  const clinical = classificationSummary(results, data.variants);
  assert.equal(clinical.find(c => c.key === "Pathogenic").count, results.length);
  const domain = domainSummary(results, data.protein.domains, clinical).find(d => d.id === nc2.id);
  assert.equal(domain.total, results.length);
  assert.equal(domain.series.find(c => c.key === "Pathogenic").count, results.length);
  const bins = densityBins(results, mapWindow(data.protein, next)).bins;
  assert.equal(bins.reduce((n, b) => n + b.total, 0), results.length);
  const restored = readExplorerState(writeExplorerState({ filters: next }).toString(), data);
  assert.deepEqual(filterVariants(data.variants, restored.filters).map(v => v.variationId), results.map(v => v.variationId));
  const csv = variantsCsv(results, data.protein.domains, data);
  assert.equal(csv.trim().split("\r\n").length, results.length + 1);
  assert.deepEqual([...csv.matchAll(/^"(\d+)",/gm)].map(match => Number(match[1])), results.map(v => v.variationId));
});
