import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classificationSummary, domainSummary, chartCoverage, UNCLASSIFIED } from "../src/chart-data.mjs";
import { EMPTY_FILTERS, filterVariants } from "../src/data-utils.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const catalogue = classificationSummary(data.variants);

test("classification bars retain exact source categories and account for all 6,522 records", () => {
  assert.equal(catalogue.length, 10);
  assert.equal(catalogue.reduce((total, category) => total + category.count, 0), data.variants.length);
  assert.equal(catalogue.find((category) => category.key === UNCLASSIFIED).count, 38);
  for (const category of catalogue) {
    const expected = data.variants.filter((variant) => category.key === UNCLASSIFIED
      ? !variant.clinicalSignificance.length
      : variant.clinicalSignificance.includes(category.key));
    assert.equal(category.count, expected.length, category.key);
  }
  assert.notEqual(catalogue.find((category) => category.key === "Pathogenic").tone,
    catalogue.find((category) => category.key === "Likely pathogenic").tone);
});

test("filtered counts use every matching record, retain zero categories, and ignore pagination", () => {
  const results = filterVariants(data.variants, { ...EMPTY_FILTERS, significance: "Pathogenic" });
  assert.ok(results.length > 50);
  const summary = classificationSummary(results, data.variants);
  assert.deepEqual(summary.map((category) => category.key), catalogue.map((category) => category.key));
  assert.equal(summary.find((category) => category.key === "Pathogenic").count, results.length);
  assert.equal(summary.find((category) => category.key === "Likely pathogenic").count, 0);
  assert.ok(classificationSummary([], data.variants).every((category) => category.count === 0));
});

test("domain bar counts exactly match table domain and classification filters", () => {
  const rows = domainSummary(data.variants, data.protein.domains, catalogue);
  assert.deepEqual(rows.map((row) => row.label), ["NC1", "Collagenous", "NC2"]);
  for (const row of rows) {
    assert.equal(row.total, filterVariants(data.variants, { ...EMPTY_FILTERS, domain: row.id }).length);
    for (const category of row.series) {
      const expected = data.variants.filter((variant) =>
        variant.proteinMapping.status === "mapped" && variant.proteinMapping.domainIds.includes(row.id) &&
        (category.key === UNCLASSIFIED ? !variant.clinicalSignificance.length : variant.clinicalSignificance.includes(category.key)));
      assert.equal(category.count, expected.length, `${row.label} / ${category.key}`);
    }
    assert.equal(row.series.reduce((total, category) => total + category.count, 0), row.total);
  }
});

test("empty filters and unmapped-only results keep stable zero domain bars", () => {
  for (const results of [[], data.variants.filter((variant) => variant.proteinMapping.status === "unmapped")]) {
    const rows = domainSummary(results, data.protein.domains, catalogue);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.total === 0 && row.series.every((category) => category.count === 0)));
    assert.deepEqual(rows[0].series.map((category) => category.key), catalogue.map((category) => category.key));
  }
  assert.equal(chartCoverage(data.variants, data.protein.domains).unmapped, data.summary.unmapped);
});

test("multi-label and spanning variants are counted once per label and overlapping domain", () => {
  const domains = [
    { id: "a", label: "NC1", level: "region", start: 17, end: 1253 },
    { id: "b", label: "Collagenous", level: "region", start: 1254, end: 2784 },
    { id: "c", label: "NC2", level: "region", start: 2785, end: 2944 },
  ];
  const variants = [
    { clinicalSignificance: ["Pathogenic", "Likely pathogenic", "Pathogenic"], proteinMapping: { status: "mapped", domainIds: ["a", "b"] } },
    { clinicalSignificance: [], proteinMapping: { status: "unmapped", domainIds: [] } },
    { clinicalSignificance: ["Future source term"], proteinMapping: { status: "mapped", domainIds: [] } },
  ];
  const before = structuredClone(variants);
  const summary = classificationSummary(variants);
  assert.equal(summary.find((category) => category.key === "Pathogenic").count, 1);
  assert.equal(summary.find((category) => category.key === "Future source term").label, "Future source term");
  const rows = domainSummary(variants, domains, summary);
  assert.equal(rows[0].total, 1);
  assert.equal(rows[1].total, 1);
  assert.equal(rows[0].series.reduce((sum, category) => sum + category.count, 0), 2);
  assert.deepEqual(chartCoverage(variants, domains), {
    total: 3, mapped: 2, unmapped: 1, outsideMajorDomains: 1, spanningDomains: 1, multipleClassifications: 1,
  });
  assert.deepEqual(variants, before);
});

test("a partial category catalogue never silently drops domain source labels", () => {
  const nc2 = data.protein.domains.find((domain) => domain.label === "NC2");
  const sample = data.variants.find((variant) => variant.proteinMapping.domainIds.includes(nc2.id));
  const row = domainSummary([sample], data.protein.domains, []).find((row) => row.id === nc2.id);
  assert.equal(row.total, 1);
  assert.equal(row.series.length, 1);
  assert.equal(row.series[0].key, sample.clinicalSignificance[0]);
  assert.equal(row.series[0].count, 1);
});
