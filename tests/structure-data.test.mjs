import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateStructureManifest, fragmentOverlap, canonicalPosition, residuesAtRange } from "../src/structure-data.mjs";

const manifest = JSON.parse(readFileSync(new URL("../public/data/structures/manifest.json", import.meta.url), "utf8"));
const data = JSON.parse(readFileSync(new URL("../public/data/variants.json", import.meta.url), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const copy = () => structuredClone(manifest);

test("fragments uniquely match the same canonical sequence used for the variant map", () => {
  assert.equal(validateStructureManifest(manifest, data.protein), manifest);
  assert.equal(sha256(data.protein.sequence), manifest.reference.sequenceSha256);
  assert.deepEqual(manifest.fragments.map(f => [f.start, f.end, f.chains.length]), [[1047, 1237, 1], [2539, 2619, 3]]);
  for (const fragment of manifest.fragments) {
    assert.equal(data.protein.sequence.indexOf(fragment.sequence) + 1, fragment.start);
    assert.equal(data.protein.sequence.lastIndexOf(fragment.sequence) + 1, fragment.start);
  }
});

test("original coordinate, input and summary downloads retain the recorded hashes", () => {
  for (const fragment of manifest.fragments) {
    for (const [url, expected] of [[fragment.coordinateUrl, fragment.coordinateSha256], [fragment.provenance.jobRequestUrl, fragment.provenance.jobRequestSha256], [fragment.provenance.summaryUrl, fragment.provenance.summarySha256]]) {
      const bytes = readFileSync(new URL(`../public${url}`, import.meta.url));
      assert.equal(sha256(bytes), expected);
    }
  }
});

test("canonical position conversion never maps outside the modeled fragment", () => {
  const fragment = manifest.fragments[1];
  assert.equal(canonicalPosition(fragment, 1), 2539);
  assert.equal(canonicalPosition(fragment, 37), 2575);
  assert.equal(canonicalPosition(fragment, 81), 2619);
  for (const invalid of [0, -1, 82, 1.5, "37", null, NaN]) assert.equal(canonicalPosition(fragment, invalid), null);
});

test("linked selections clip at fragment boundaries without joining models or inventing coverage", () => {
  const [nc1, collagen] = manifest.fragments;
  assert.deepEqual(fragmentOverlap(nc1, [1000, 1100]), [1047, 1100]);
  assert.equal(fragmentOverlap(nc1, [1254, 2784]), null);
  assert.equal(fragmentOverlap(nc1, null), null);
  assert.equal(fragmentOverlap(nc1, [1200, 1100]), null);
  assert.deepEqual(residuesAtRange(collagen, [2575, 2575]).map(r => [r.modelPosition, r.position, r.aminoAcid]), [[37, 2575, "G"]]);
  assert.equal(residuesAtRange(collagen, [1047, 1237]).length, 0);
  assert.equal(residuesAtRange(collagen, null).length, 0);
});

test("confidence and numbering corruption is rejected before a model is displayed", () => {
  const corruptions = [
    x => { x.fragments[0].start++; },
    x => { x.fragments[0].sequence = "A" + x.fragments[0].sequence.slice(1); },
    x => { x.fragments[0].residues[0].position++; },
    x => { x.fragments[0].residues[0].plddt.A = 101; },
    x => { x.fragments[0].chains.push("A"); },
    x => { x.fragments[0].confidence.iptm = 0.9; },
    x => { x.fragments[0].coordinateUrl = "https://example.com/model.cif"; },
    x => { x.fragments[0].provenance.summaryUrl = "javascript:alert(1)"; },
    x => { x.fragments[1].id = x.fragments[0].id; },
  ];
  for (const change of corruptions) {
    const value = copy(); change(value);
    assert.throws(() => validateStructureManifest(value, data.protein), /Invalid structure manifest/);
  }
});
