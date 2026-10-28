import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDataset } from "../src/dataset-validation.mjs";

const snapshot = JSON.parse(
  await readFile(new URL("../public/data/variants.json", import.meta.url)),
);

function fixture() {
  const data = structuredClone({ ...snapshot, variants: snapshot.variants.slice(0, 10) });
  data.summary.variants = data.variants.length;
  data.summary.mapped = data.variants.filter((v) => v.proteinMapping.status === "mapped").length;
  data.summary.unmapped = data.summary.variants - data.summary.mapped;
  data.summary.sourceRows = data.variants.reduce((sum, v) => sum + v.sourceRecords.length, 0);
  return data;
}

test("validates every committed variant without modifying the source dataset", () => {
  const before = JSON.stringify(snapshot);
  assert.equal(validateDataset(snapshot), snapshot);
  assert.equal(JSON.stringify(snapshot), before);
});

test("rejects absent or malformed top-level data with actionable paths", () => {
  assert.throws(() => validateDataset(null), /root must be an object/);
  for (const key of ["protein", "summary", "sources", "processing"]) {
    const data = fixture();
    delete data[key];
    assert.throws(() => validateDataset(data), new RegExp(`${key} must be an object`));
  }
  const data = fixture();
  data.schemaVersion = "2.0.0";
  assert.throws(() => validateDataset(data), /schemaVersion is unsupported/);
});

test("rejects nested fields that would crash rendering, searching, or CSV export", () => {
  for (const key of ["names", "codingHgvs", "conditions", "reviewStatus", "sourceRecords", "genomicPositions"]) {
    const data = fixture();
    data.variants[0][key] = null;
    assert.throws(() => validateDataset(data), new RegExp(`variants\\[0\\].${key} must be an array`));
  }
  const data = fixture();
  data.variants[0].genomicPositions[0].chromosome = 3;
  assert.throws(() => validateDataset(data), /chromosome must be text/);
});

test("rejects duplicate variant identifiers and source evidence rows", () => {
  for (const key of ["id", "variationId"]) {
    const data = fixture();
    data.variants[1][key] = data.variants[0][key];
    assert.throws(() => validateDataset(data), /must be unique/);
  }
  const data = fixture();
  data.variants[1].sourceRecords[0].line = data.variants[0].sourceRecords[0].line;
  assert.throws(() => validateDataset(data), /line must occur only once/);
});

test("rejects inconsistent counts rather than displaying a misleading dataset overview", () => {
  for (const key of ["variants", "mapped", "unmapped", "sourceRows"]) {
    const data = fixture();
    data.summary[key]++;
    assert.throws(() => validateDataset(data), /summary/);
  }
});

test("rejects invalid protein ranges and nonexistent domain references", () => {
  const cases = [
    (d) => { d.protein.domains[0].end = d.protein.length + 1; },
    (d) => { d.variants[0].proteinMapping.start = 0; },
    (d) => { d.variants[0].proteinMapping.end = d.protein.length + 1; },
    (d) => { d.variants[0].proteinMapping.domainIds = ["missing-domain"]; },
    (d) => { d.variants[9].proteinMapping.start = 1; },
    (d) => { d.protein.sequence = "short"; },
  ];
  for (const change of cases) {
    const data = fixture();
    change(data);
    assert.throws(() => validateDataset(data), /Invalid dataset:/);
  }
});

test("rejects invalid evidence hashes and unsafe external link protocols", () => {
  const cases = [
    (d) => { d.sources.uniprot.sha256 = "not-a-hash"; },
    (d) => { d.variants[0].sourceRecords[0].sha256 = null; },
    (d) => { d.variants[0].url = "javascript:alert(1)"; },
    (d) => { d.protein.url = "https://name:password@example.org"; },
  ];
  for (const change of cases) {
    const data = fixture();
    change(data);
    assert.throws(() => validateDataset(data), /Invalid dataset:/);
  }
});

test("submitter counts retain missing and zero while rejecting invalid or duplicate counts", () => {
  for (const counts of [[], [0], [2, 4]]) {
    const data = fixture();
    data.variants[0].numberSubmitters = counts;
    assert.equal(validateDataset(data), data);
  }
  for (const counts of [null, [-1], [1.5], ["4"], [2, 2], [4, 2]]) {
    const data = fixture();
    data.variants[0].numberSubmitters = counts;
    assert.throws(() => validateDataset(data), /numberSubmitters/);
  }
});

test("snapshot preparation date is separate from an unknown source release date", () => {
  assert.equal(snapshot.snapshot.preparedDate, "2026-10-27");
  assert.equal(snapshot.sources.clinvar.releaseDate, null);
  const unknown = fixture();
  unknown.snapshot.preparedDate = null;
  assert.equal(validateDataset(unknown), unknown);
  for (const date of [undefined, "today", "2026-02-30", "2026-2-3"]) {
    const data = fixture();
    data.snapshot.preparedDate = date;
    assert.throws(() => validateDataset(data), /snapshot.preparedDate/);
  }
});
