import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UNCLASSIFIED } from "../src/chart-data.mjs";
import {
  EMPTY_FILTERS,
  filterVariants,
  histogram,
  variantsCsv,
  csvCell,
  sortVariants,
  searchableText,
} from "../src/data-utils.mjs";
const data = JSON.parse(
  await readFile(new URL("../public/data/variants.json", import.meta.url)),
);
const filter = (overrides) =>
  filterVariants(data.variants, { ...EMPTY_FILTERS, ...overrides });
test("not-reported chart category filters missing classifications without including source no-classification labels", () => {
  const missing = filter({ significance: UNCLASSIFIED });
  assert.equal(missing.length, 38);
  assert.ok(missing.every(v => v.clinicalSignificance.length === 0));
  assert.equal(filter({ significance: "no classification for the single variant" }).length, 2);
});
test("search returns the source variant by HGVS and variation ID", () => {
  assert.ok(
    filter({ query: "c.8393T>A" }).some((v) => v.variationId === 17423),
  );
  assert.ok(filter({ query: "17423" }).some((v) => v.variationId === 17423));
  assert.equal(filter({ query: "nonexistent-hgvs-xyz" }).length, 0);
});
test("search indexes source identifiers and accession-qualified HGVS", () => {
  for (const query of [
    "rs121912828",
    "ClinGen:CA257933",
    "NM_000094.4:c.8393T>A",
  ]) {
    assert.ok(filter({ query }).some((v) => v.variationId === 17423), query);
  }
  // The browser uses precomputed search text; it must produce identical results.
  const indexed = data.variants.map((v) => ({ ...v, searchText: searchableText(v) }));
  assert.deepEqual(
    filterVariants(indexed, { ...EMPTY_FILTERS, query: "rs121912828" }).map((v) => v.variationId),
    filter({ query: "rs121912828" }).map((v) => v.variationId),
  );
});
test("explicit identifier searches match complete variation and allele IDs", () => {
  assert.deepEqual(filter({ query: "id:17423" }).map((v) => v.variationId), [17423]);
  assert.deepEqual(filter({ query: "variation:17423" }).map((v) => v.variationId), [17423]);
  assert.ok(!filter({ query: "id:1742" }).some((v) => v.variationId === 17423));
  assert.ok(filter({ query: "allele:32462" }).some((v) => v.variationId === 17423));
  assert.equal(filter({ query: "id:17423", mapping: "unmapped" }).length, 0);
});
test("genomic coordinate searches support chromosome, accession, and assembly qualifiers", () => {
  for (const query of [
    "chr3:48566281",
    "3:48,566,281",
    "NC_000003.12:48566281",
    "NC_000003.12: 48566281 – 48566281",
    "GRCh38 NC_000003:48566281",
    "GRCh38 chr3:48566280-48566282",
    "GRCh37 NC_000003.11:48603714",
  ]) {
    assert.ok(filter({ query }).some((v) => v.variationId === 17423), query);
  }
  for (const query of [
    "GRCh37 chr3:48566281",
    "GRCh38 NC_000003.11:48603714",
    "chr2:48566281",
    "chr3:48566282-48566280",
    "chr3:0",
  ]) {
    assert.ok(!filter({ query }).some((v) => v.variationId === 17423), query);
  }
});
test("genomic coordinate search finds a position inside a reported variant span", () => {
  const variant = data.variants.find((v) => v.genomicPositions.some((p) => p.end - p.start > 2));
  const position = variant.genomicPositions.find((p) => p.end - p.start > 2);
  assert.ok(filter({ query: `${position.assembly} chr${position.chromosome}:${position.start + 1}` })
    .some((v) => v.variationId === variant.variationId));
});
test("compound filters use AND; unmapped variants remain searchable", () => {
  const nc2 = data.protein.domains.find((d) => d.label === "NC2").id;
  const rows = filter({
    domain: nc2,
    significance: "Pathogenic/Likely pathogenic",
  });
  assert.ok(rows.length > 0);
  assert.ok(
    rows.every(
      (v) =>
        v.proteinMapping.domainIds.includes(nc2) &&
        v.clinicalSignificance.includes("Pathogenic/Likely pathogenic"),
    ),
  );
  assert.equal(filter({ mapping: "unmapped" }).length, data.summary.unmapped);
  assert.equal(filter({ mapping: "unmapped", domain: nc2 }).length, 0);
});
test("distribution counts every mapped variation once, even multi-residue events", () => {
  assert.equal(
    histogram(data.variants, data.protein.length).reduce(
      (n, b) => n + b.total,
      0,
    ),
    data.summary.mapped,
  );
  const filtered = filter({ range: [2785, 2944] });
  assert.ok(
    filtered.every(
      (v) => v.proteinMapping.end >= 2785 && v.proteinMapping.start <= 2944,
    ),
  );
});
test("protein sorting puts unmapped records after mapped records", () => {
  const sorted = sortVariants(data.variants, "position");
  const lastMapped = sorted.findLastIndex(
    (v) => v.proteinMapping.status === "mapped",
  );
  assert.equal(lastMapped + 1, data.summary.mapped);
  assert.ok(
    sorted
      .slice(lastMapped + 1)
      .every((v) => v.proteinMapping.status === "unmapped"),
  );
});
test("CSV exports all filtered rows, quotes source fields and neutralizes formulas", () => {
  const rows = filter({ significance: "Pathogenic" });
  const csv = variantsCsv(rows, data.protein.domains);
  assert.ok(rows.length > 50);
  assert.equal(csv.split("\r\n").length, rows.length + 2);
  assert.ok(csv.includes("Source row SHA256"));
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
  assert.equal(csvCell("  @SUM(1)"), '"\'  @SUM(1)"');
});
