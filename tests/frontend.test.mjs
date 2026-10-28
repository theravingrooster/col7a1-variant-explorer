import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UNCLASSIFIED } from "../src/chart-data.mjs";
import { conditionDisplayLabel } from "../src/condition-labels.mjs";
import { evidenceSummary, submittersLabel, MULTIPLE_SUBMITTERS_REVIEW } from "../src/evidence.mjs";
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
test("DEB display naming preserves qualified subtypes and semicolon-delimited source entries", () => {
  assert.equal(conditionDisplayLabel("Epidermolysis bullosa dystrophica"), "Dystrophic epidermolysis bullosa (DEB)");
  assert.equal(conditionDisplayLabel("Recessive dystrophic epidermolysis bullosa;Epidermolysis bullosa dystrophica"), "Recessive dystrophic epidermolysis bullosa;Dystrophic epidermolysis bullosa (DEB)");
  for (const label of ["Epidermolysis bullosa dystrophica inversa, autosomal recessive", "Epidermolysis bullosa dystrophica localisata", "7 conditions", "not provided", "Other; Epidermolysis bullosa dystrophica, autosomal dominant"])
    assert.equal(conditionDisplayLabel(label), label);
});
test("DEB common-name and shorthand search includes source synonyms and existing named subtypes", () => {
  const expected = filter({ query: "dystrophic epidermolysis bullosa" }).map(v => v.variationId);
  assert.ok(expected.includes(345787));
  assert.ok(expected.includes(1177485));
  for (const query of ["DEB", "dystrophic EB", "Dystrophic epidermolysis bullosa (DEB)"])
    assert.deepEqual(filter({ query }).map(v => v.variationId), expected);
  assert.ok(filter({ query: "Epidermolysis bullosa dystrophica" }).some(v => v.variationId === 345787));
  const indexed = data.variants.map(v => ({ ...v, searchText: searchableText(v) }));
  assert.deepEqual(filterVariants(indexed, { ...EMPTY_FILTERS, query: "DEB" }).map(v => v.variationId), expected);
});
test("condition sorting uses visible names while CSV retains original source wording", () => {
  const template = data.variants.find(v => v.variationId === 345787);
  const variants = ["Eczema", "Epidermolysis bullosa dystrophica", "Dermatitis"].map((label, i) => ({ ...template, variationId: i + 1, conditions: [label] }));
  assert.deepEqual(sortVariants(variants, "conditions").map(v => v.variationId), [3, 2, 1]);
  assert.deepEqual(sortVariants(variants, "conditions-desc").map(v => v.variationId), [1, 2, 3]);
  assert.deepEqual(template.conditions, ["Epidermolysis bullosa dystrophica"]);
  const csv = variantsCsv([template], data.protein.domains);
  assert.ok(csv.includes('"Conditions (as reported)"'));
  assert.ok(csv.includes('"Epidermolysis bullosa dystrophica"'));
  assert.ok(!csv.includes("Dystrophic epidermolysis bullosa (DEB)"));
});
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

test("evidence labels preserve review provenance independently from submitter counts", () => {
  const single = evidenceSummary({
    reviewStatus: ["criteria provided, single submitter"], numberSubmitters: [3],
  });
  assert.equal(single.shortLabel, "Single submitter review");
  assert.equal(single.submittersLabel, "3 submitters");
  assert.equal(single.multipleSubmittersNoConflicts, false);
  const consensus = evidenceSummary({reviewStatus: [MULTIPLE_SUBMITTERS_REVIEW], numberSubmitters: [4, 4]});
  assert.equal(consensus.tone, "consensus");
  assert.equal(consensus.fullLabel, MULTIPLE_SUBMITTERS_REVIEW);
  assert.equal(consensus.submittersLabel, "4 submitters");
  assert.equal(consensus.multipleSubmittersNoConflicts, true);
  const mixed = evidenceSummary({reviewStatus: [MULTIPLE_SUBMITTERS_REVIEW, "criteria provided, conflicting classifications"]});
  assert.equal(mixed.shortLabel, "Multiple review statuses");
  assert.equal(mixed.tone, "conflicting");
  assert.ok(mixed.fullLabel.includes("conflicting classifications"));
});

test("submitter labels distinguish missing, zero, one and differing source values", () => {
  assert.equal(submittersLabel({}), "Submitter count not reported");
  assert.equal(submittersLabel({numberSubmitters: [0]}), "0 submitters");
  assert.equal(submittersLabel({numberSubmitters: [1, 1]}), "1 submitter");
  assert.equal(submittersLabel({numberSubmitters: [4, 2, 4]}), "2 / 4 submitters (source counts differ)");
  assert.equal(submittersLabel({numberSubmitters: [-1, null, 2.5]}), "Submitter count not reported");
});

test("multiple submitters without conflicts preset matches the source review status exactly", () => {
  const reviewed = filter({ review: MULTIPLE_SUBMITTERS_REVIEW });
  assert.equal(reviewed.length, 928);
  assert.ok(reviewed.every(v => evidenceSummary(v).multipleSubmittersNoConflicts));
  // A count of 2+ does not establish that the aggregate review status is consensus.
  const singleReviewWithMultipleCounts = data.variants.filter(v =>
    v.reviewStatus.includes("criteria provided, single submitter") && v.numberSubmitters?.some(n => n > 1));
  assert.equal(singleReviewWithMultipleCounts.length, 217);
  assert.ok(singleReviewWithMultipleCounts.every(v => !reviewed.includes(v)));
  const nc2 = data.protein.domains.find(d => d.label === "NC2").id;
  const combined = filter({ review: MULTIPLE_SUBMITTERS_REVIEW, domain: nc2, significance: "Pathogenic/Likely pathogenic" });
  assert.ok(combined.length > 0);
  assert.ok(combined.every(v => reviewed.includes(v) && v.proteinMapping.domainIds.includes(nc2)));
});

function parseCsv(text) {
  const records = [];
  let record = [], field = "", quoted = false;
  const csv = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { record.push(field); field = ""; }
    else if (ch === '\r' && csv[i + 1] === '\n' && !quoted) {
      record.push(field); records.push(record); record = []; field = ""; i++;
    } else field += ch;
  }
  return records;
}

test("CSV research columns retain source submitters, mapping and snapshot context for the complete filtered cohort", () => {
  const rows = filter({ review: MULTIPLE_SUBMITTERS_REVIEW });
  const [header, ...records] = parseCsv(variantsCsv(rows, data.protein.domains, data));
  assert.ok(rows.length > 50);
  assert.equal(records.length, rows.length);
  assert.deepEqual(records.map(r => Number(r[header.indexOf("Variation ID")])), rows.map(v => v.variationId));
  for (const name of ["Coding HGVS", "Protein HGVS", "Clinical significance", "Review status", "Domains", "Protein start (1-based)", "Protein end (inclusive)", "Conditions (as reported)", "ClinVar URL", "Number of submitters (source counts)"])
    assert.ok(header.includes(name), name);
  const index = rows.findIndex(v => v.variationId === 17423);
  const value = name => records[index][header.indexOf(name)];
  assert.equal(value("Coding HGVS"), "c.8393T>A");
  assert.equal(value("Protein HGVS"), "p.Met2798Lys");
  assert.equal(value("Review status"), MULTIPLE_SUBMITTERS_REVIEW);
  assert.equal(value("Domains"), "NC2");
  assert.equal(value("Protein start (1-based)"), "2798");
  assert.equal(value("Number of submitters (source counts)"), rows[index].numberSubmitters.join("; "));
  assert.equal(value("Snapshot prepared date"), "2026-10-27");
  assert.equal(value("ClinVar release date"), "Unknown");
  assert.equal(value("Protein reference"), "Q02388");
  assert.equal(value("Protein mapping method"), "explicit_protein_hgvs");
  assert.equal(value("Protein mapping provenance"), data.processing.mapping);
  const synthetic = { ...data.variants[0], numberSubmitters: [0, 0, 2], conditions: ['Quoted "condition", with comma\nand newline'] };
  const [syntheticHeader, syntheticRow] = parseCsv(variantsCsv([synthetic], data.protein.domains));
  assert.equal(syntheticRow[syntheticHeader.indexOf("Number of submitters (source counts)")], "0; 2");
  assert.equal(syntheticRow[syntheticHeader.indexOf("Conditions (as reported)")], synthetic.conditions[0]);
  assert.equal(syntheticRow[syntheticHeader.indexOf("Snapshot prepared date")], "Not recorded");
});
