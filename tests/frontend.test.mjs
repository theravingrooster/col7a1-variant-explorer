import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EMPTY_FILTERS,
  filterVariants,
  histogram,
  variantsCsv,
  csvCell,
  sortVariants,
} from "../src/data-utils.mjs";
const data = JSON.parse(
  await readFile(new URL("../public/data/variants.json", import.meta.url)),
);
const filter = (overrides) =>
  filterVariants(data.variants, { ...EMPTY_FILTERS, ...overrides });
test("search returns the source variant by HGVS and variation ID", () => {
  assert.ok(
    filter({ query: "c.8393T>A" }).some((v) => v.variationId === 17423),
  );
  assert.ok(filter({ query: "17423" }).some((v) => v.variationId === 17423));
  assert.equal(filter({ query: "nonexistent-hgvs-xyz" }).length, 0);
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
