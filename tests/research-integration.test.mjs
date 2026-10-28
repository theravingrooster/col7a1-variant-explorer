import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EMPTY_FILTERS, filterVariants, searchableText, sortVariants, variantsCsv } from "../src/data-utils.mjs";
import { MULTIPLE_SUBMITTERS_REVIEW } from "../src/evidence.mjs";
import { readExplorerState, writeExplorerState } from "../src/explorer-state.mjs";
import { classificationSummary, domainSummary } from "../src/chart-data.mjs";
import { densityBins } from "../src/map-data.mjs";
import { researchAnnotations } from "../src/research-data.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const filter = overrides => filterVariants(data.variants, { ...EMPTY_FILTERS, ...overrides });
const ids = variants => variants.map(variant => variant.variationId);

function parseCsv(text) {
  const records = [];
  let record = [], field = "", quoted = false;
  const csv = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { record.push(field); field = ""; }
    else if (ch === "\r" && csv[i + 1] === "\n" && !quoted) {
      record.push(field); records.push(record); record = []; field = ""; i++;
    } else field += ch;
  }
  return records;
}

test("explicit recessive condition filtering composes with evidence and HGVS patterns without inferring generic DEB", () => {
  const recessive = filter({ condition: "recessive" });
  assert.equal(recessive.length, 786);
  assert.equal(filter({ condition: "recessive", review: MULTIPLE_SUBMITTERS_REVIEW }).length, 330);
  assert.equal(filter({ condition: "recessive", pattern: "frameshift" }).length, 180);
  assert.ok(!ids(recessive).includes(345787), "Generic DEB alone does not establish recessive inheritance");
  const both = filter({ condition: "both" });
  assert.equal(both.length, 31);
  const dominant = new Set(ids(filter({ condition: "dominant" })));
  assert.ok(both.every(variant => ids(recessive).includes(variant.variationId) && dominant.has(variant.variationId)));
  const filters = { ...EMPTY_FILTERS, condition: "recessive", pattern: "frameshift", review: MULTIPLE_SUBMITTERS_REVIEW };
  const indexed = data.variants.map(v => ({ ...v, searchText: searchableText(v), research: researchAnnotations(v) }));
  assert.deepEqual(ids(filterVariants(indexed, filters)), ids(filterVariants(data.variants, filters)));
});

test("splice-site candidates remain discoverable when the protein map has no coordinates", () => {
  const splice = filter({ pattern: "splice-site" });
  assert.equal(splice.length, 261);
  assert.ok(splice.every(variant => variant.proteinMapping.status === "unmapped"));
  assert.deepEqual(ids(filter({ pattern: "splice-site", mapping: "unmapped" })), ids(splice));
  assert.ok(ids(splice).includes(17435));
  assert.equal(filter({ pattern: "splice-site", mapping: "mapped" }).length, 0);
  assert.equal(densityBins(splice, [1, data.protein.length]).bins.reduce((total, bin) => total + bin.total, 0), 0);
  assert.equal(classificationSummary(splice, data.variants).reduce((total, item) => total + item.count, 0), 261);
});

test("new research filters feed the same complete cohort to charts, domains and density", () => {
  const filters = { ...EMPTY_FILTERS, condition: "recessive", pattern: "glycine", review: MULTIPLE_SUBMITTERS_REVIEW };
  const variants = filterVariants(data.variants, filters);
  assert.ok(variants.length > 0);
  assert.equal(classificationSummary(variants, data.variants).reduce((total, item) => total + item.count, 0), variants.length);
  for (const domain of domainSummary(variants, data.protein.domains))
    assert.equal(domain.total, filterVariants(data.variants, { ...filters, domain: domain.id }).length);
  const mapped = variants.filter(variant => variant.proteinMapping.status === "mapped");
  const { bins } = densityBins(variants, [1, data.protein.length]);
  assert.equal(bins.reduce((total, bin) => total + bin.total, 0), mapped.length);
  for (const group of ["pathogenic", "uncertain", "conflicting", "benign", "other"])
    assert.equal(bins.reduce((total, bin) => total + bin.counts[group], 0), mapped.filter(v => v.significanceGroup === group).length);
});

test("shared research views preserve filters and exact comparison IDs independently of the filtered cohort", () => {
  const state = {
    filters: { ...EMPTY_FILTERS, condition: "recessive", pattern: "frameshift", review: MULTIPLE_SUBMITTERS_REVIEW },
    sort: "position-desc", page: 0, selectedId: null,
    shortlistIds: [17423, 17435, 345787], comparisonOpen: true,
  };
  const params = writeExplorerState(state);
  assert.equal(params.get("condition"), "recessive");
  assert.equal(params.get("pattern"), "frameshift");
  assert.equal(params.get("compare"), "1");
  assert.deepEqual(readExplorerState(`?${params}`, data), state);
  const matching = new Set(ids(filterVariants(data.variants, state.filters)));
  assert.ok(state.shortlistIds.every(id => !matching.has(id)), "Comparison candidates survive active cohort exclusions");
  assert.equal(readExplorerState("?shortlist=17423&compare=1", data).comparisonOpen, false);
  assert.equal(readExplorerState("?shortlist=17423,999999999&compare=1", data).comparisonOpen, false);
  assert.equal(readExplorerState("?shortlist=17423,17435&compare=1&variant=17425", data).comparisonOpen, false);
  assert.equal(readExplorerState("?shortlist=17423,17435&compare=1&compare=0", data).comparisonOpen, false);
  assert.equal(writeExplorerState({ ...state, selectedId: 17425 }).has("compare"), false);
});

test("CSV exports all research-filtered records in selected order and retains original source columns", () => {
  const variants = sortVariants(filter({ condition: "recessive", pattern: "frameshift" }), "id-desc");
  const sourceBefore = JSON.stringify(variants);
  const [header, ...rows] = parseCsv(variantsCsv(variants, data.protein.domains, data));
  assert.equal(rows.length, 180);
  assert.deepEqual(rows.map(row => Number(row[header.indexOf("Variation ID")])), ids(variants));
  for (const name of ["Condition context (explicit source labels)", "Matched condition labels (as reported)", "HGVS patterns (derived, not functional evidence)", "HGVS pattern source expressions"])
    assert.ok(header.includes(name), name);
  const column = name => header.indexOf(name);
  for (const [index, variant] of variants.entries()) {
    assert.equal(rows[index][column("Conditions (as reported)")], variant.conditions.join("; "));
    assert.equal(rows[index][column("Clinical significance")], variant.clinicalSignificance.join("; "));
    assert.equal(rows[index][column("Review status")], variant.reviewStatus.join("; "));
    assert.equal(rows[index][column("HGVS patterns (derived, not functional evidence)")], "frameshift");
    assert.equal(rows[index][column("HGVS pattern source expressions")], `Frameshift HGVS: ${variant.proteinHgvs[0]}`);
    assert.ok(rows[index][column("Matched condition labels (as reported)")].length);
  }
  assert.equal(JSON.stringify(variants), sourceBefore);
});

test("shortlist CSV preserves requested candidates, including unmapped and inheritance-unspecified records", () => {
  const selectedIds = [17425, 17435, 345787];
  const variants = selectedIds.map(id => data.variants.find(v => v.variationId === id));
  const [header, ...rows] = parseCsv(variantsCsv(variants, data.protein.domains, data));
  const column = name => header.indexOf(name);
  assert.deepEqual(rows.map(row => Number(row[column("Variation ID")])), selectedIds);
  assert.equal(rows[0][column("Condition context (explicit source labels)")], "recessive; dominant; both");
  assert.equal(rows[0][column("HGVS pattern source expressions")], "Frameshift HGVS: p.Asn825fs");
  assert.equal(rows[1][column("HGVS pattern source expressions")], "Splice-site ±1/2 SNV: c.4119+1G>T");
  assert.equal(rows[1][column("Protein mapping status")], "unmapped");
  assert.equal(rows[2][column("Condition context (explicit source labels)")], "");
  assert.equal(rows[2][column("Matched condition labels (as reported)")], "");
  assert.equal(rows[2][column("Conditions (as reported)")], "Epidermolysis bullosa dystrophica");
});
