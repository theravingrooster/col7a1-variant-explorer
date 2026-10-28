import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { intersectRange, linkedSchematicRange, schematicFrame, schematicRegions } from "../src/schematic-geometry.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const regions = schematicRegions(data.protein);

test("the schematic uses exact existing major-region bounds and excludes the signal peptide", () => {
  assert.deepEqual(regions.map(({ label, start, end }) => [label, start, end]), [["NC1",17,1253],["Collagenous",1254,2784],["NC2",2785,2944]]);
  assert.equal(regions.length, 3);
  assert.ok(regions.every(region => data.protein.domains.some(domain => domain.id === region.id)));
});

test("subdomains and single-residue focus remain exact when linked to the schematic", () => {
  assert.deepEqual(linkedSchematicRange(data.protein, null, "uniprot-feature-2"), [38,211]);
  assert.deepEqual(linkedSchematicRange(data.protein, [2798,2798], "uniprot-feature-14"), [2798,2798]);
  assert.equal(linkedSchematicRange(data.protein, null, "missing"), null);
  assert.equal(linkedSchematicRange(data.protein, [3000,3010]), null);
  assert.equal(intersectRange([50,20],[1,2944]), null);
  assert.equal(intersectRange([NaN,20],[1,2944]), null);
});

test("rotating changes geometry while preserving region identities and bounded path count", () => {
  const a = schematicFrame(regions, 0), b = schematicFrame(regions, 90);
  assert.equal(a.length, 18);
  assert.equal(b.length, 18);
  assert.deepEqual(a.map(path => path.key), b.map(path => path.key));
  assert.notDeepEqual(a.map(path => path.d), b.map(path => path.d));
  assert.ok(a.every(path => !path.d.includes("NaN") && !path.d.includes("Infinity")));
  assert.equal(a.reduce((sum,path) => sum+path.segments,0), b.reduce((sum,path) => sum+path.segments,0));
  assert.ok(a.filter(path => path.highlighted).every(path => path.d === ""));
});

test("a residue hover only highlights segments in its containing region at any rotation", () => {
  for (const angle of [0,90,180,270,360]) {
    const highlighted = schematicFrame(regions, angle, [2798,2798]).filter(path => path.highlighted && path.segments > 0);
    assert.ok(highlighted.length > 0);
    assert.ok(highlighted.every(path => path.regionId === "uniprot-feature-20"));
  }
});

test("boundary-spanning intervals highlight both regions without showing the precursor signal", () => {
  const crossing = schematicFrame(regions, 24, [1253,1254]).filter(path => path.highlighted && path.segments > 0);
  assert.deepEqual([...new Set(crossing.map(path=>path.regionId))], ["uniprot-feature-14","uniprot-feature-17"]);
  assert.ok(schematicFrame(regions,24,[1,16]).filter(path=>path.highlighted).every(path=>path.segments===0));
});
