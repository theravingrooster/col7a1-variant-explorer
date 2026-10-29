import test from "node:test";
import assert from "node:assert/strict";
import { confidenceColor, fragmentAtomDetails, fragmentSelection } from "../src/fragment-rendering.mjs";

const vwfa = { id: "vwfa2", start: 1047, end: 1237, length: 191, chains: ["A"], sequence: "G".repeat(191), residues: [{ aminoAcid: "G", plddt: { A: 88.1 } }] };
const collagen = { id: "collagen", start: 2539, end: 2619, length: 81, chains: ["A", "B", "C"], sequence: "G".repeat(81) };

test("fragment highlighting clips canonical intervals to actual coverage, preserving inclusive endpoints", () => {
  assert.deepEqual(fragmentSelection(vwfa, [1047, 1047]), { resi: "1-1" });
  assert.deepEqual(fragmentSelection(vwfa, [1237, 1237]), { resi: "191-191" });
  assert.deepEqual(fragmentSelection(vwfa, [1, 2944]), { resi: "1-191" });
  assert.deepEqual(fragmentSelection(vwfa, [1200, 2944]), { resi: "154-191" });
  assert.deepEqual(fragmentSelection(collagen, [2575, 2575]), { resi: "37-37" });
  assert.equal(fragmentSelection(vwfa, [2539, 2619]), null);
  for (const range of [null, [], [1], [0, 100], [1048, 1047], [1047.5, 1048], [1047, Infinity]])
    assert.equal(fragmentSelection(vwfa, range), null);
});

test("atom inspection reports canonical positions and rejects noncovered residue or chain identifiers", () => {
  const atom = { resi: 1, chain: "A", resn: "GLY", b: 70 };
  assert.deepEqual(fragmentAtomDetails(vwfa, atom), { position: 1047, modelPosition: 1, residueName: "GLY", aminoAcid: "G", chain: "A", plddt: 88.1 });
  for (const chain of collagen.chains) {
    assert.equal(fragmentAtomDetails(collagen, { ...atom, resi: 37, chain }).position, 2575);
    assert.equal(fragmentAtomDetails(collagen, { ...atom, resi: 81, chain }).position, 2619);
  }
  for (const invalid of [{ ...atom, resi: 0 }, { ...atom, resi: 192 }, { ...atom, resi: 1.5 }, { ...atom, chain: "B" }, null])
    assert.equal(fragmentAtomDetails(vwfa, invalid), null);
  assert.equal(atom.b, 70, "Inspection never rewrites source confidence");
});

test("prediction-confidence colors use the displayed thresholds and do not classify invalid scores", () => {
  assert.equal(confidenceColor(100), "#0053d6");
  assert.equal(confidenceColor(90), "#0053d6");
  assert.equal(confidenceColor(89.9), "#65cbf3");
  assert.equal(confidenceColor(70), "#65cbf3");
  assert.equal(confidenceColor(69.9), "#ffdb13");
  assert.equal(confidenceColor(50), "#ffdb13");
  assert.equal(confidenceColor(49.9), "#ff7d45");
  assert.equal(confidenceColor(0), "#ff7d45");
  for (const score of [null, undefined, NaN, -1, 101, Infinity]) assert.equal(confidenceColor(score), "#9a9a9a");
});
