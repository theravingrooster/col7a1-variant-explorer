import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONDITION_OPTIONS, HGVS_PATTERN_OPTIONS, researchAnnotations,
  conditionMatches, patternMatches,
} from "../src/research-data.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const variant = (protein, coding = [], conditions = []) => ({
  proteinHgvs: typeof protein === "string" ? [protein] : protein,
  codingHgvs: typeof coding === "string" ? [coding] : coding,
  conditions,
});
const patterns = (protein, coding) => researchAnnotations(variant(protein, coding)).patterns;

test("condition facets require complete explicit source terms and retain mixed inheritance labels", () => {
  const v = variant([], [], [" Recessive dystrophic epidermolysis bullosa ;Generalized dominant dystrophic epidermolysis bullosa", "7 conditions", "not provided"]);
  const info = researchAnnotations(v);
  assert.deepEqual(info.conditionKeys, ["recessive", "dominant", "both"]);
  assert.deepEqual(info.matchedConditions, ["Recessive dystrophic epidermolysis bullosa", "Generalized dominant dystrophic epidermolysis bullosa"]);
  assert.equal(conditionMatches(v, "both"), true);
  for (const label of ["Epidermolysis bullosa dystrophica", "Dystrophic epidermolysis bullosa (DEB)", "COL7A1-related disorder", "7 conditions", "not recessive dystrophic epidermolysis bullosa", "Recessive dystrophic epidermolysis bullosa, unrecognized subtype"])
    assert.deepEqual(researchAnnotations(variant([], [], [label])).conditionKeys, []);
});

test("qualified recessive source labels are recognized without altering their wording", () => {
  for (const label of [
    "Epidermolysis bullosa dystrophica inversa, autosomal recessive",
    "Epidermolysis bullosa pruriginosa, autosomal recessive",
    "Epidermolysis bullosa dystrophica, autosomal recessive, localisata variant",
    "Epidermolysis bullosa, pretibial, autosomal recessive",
  ]) {
    const info = researchAnnotations(variant([], [], [label]));
    assert.deepEqual(info.conditionKeys, ["recessive"]);
    assert.deepEqual(info.matchedConditions, [label]);
  }
});

test("missense and glycine facets reject stops, unchanged residues, unsupported amino acids and uncertain descriptions", () => {
  assert.deepEqual(patterns("p.Gly2040Ser"), ["missense", "glycine"]);
  assert.deepEqual(patterns("p.(Gly2040Arg)"), ["missense", "glycine"]);
  assert.deepEqual(patterns("p.Met2798Lys"), ["missense"]);
  assert.deepEqual(patterns("p.Gly2040Ter"), ["stop-gain"]);
  assert.deepEqual(patterns("p.Gly2040="), ["synonymous"]);
  for (const p of ["p.Gly2040Gly", "p.Xaa2040Ser", "p.Gly2040Xaa", "p.Gly0Ser", "p.Gly2040?", "p.?", "p.Gly2040SerextTer2"])
    assert.deepEqual(patterns(p), ["unresolved"], p);
});

test("frameshift stays distinct from an introduced stop and stop-loss is not mislabeled", () => {
  for (const p of ["p.Asn825fs", "p.Arg97ProfsTer23", "p.(Arg97Profs*23)", "p.Arg97fsTer?"])
    assert.deepEqual(patterns(p), ["frameshift"], p);
  assert.deepEqual(patterns("p.Arg1630Ter"), ["stop-gain"]);
  assert.deepEqual(patterns("p.Arg1630*"), ["stop-gain"]);
  assert.deepEqual(patterns("p.Ter2945="), ["synonymous"]);
  for (const p of ["p.Ter2945Gln", "p.Ter2945GlnextTer10", "p.Arg97Terfs", "p.Arg97fsTer"])
    assert.deepEqual(patterns(p), ["unresolved"], p);
});

test("explicit protein indels can also introduce a stop without implying frame or functional effect", () => {
  for (const p of ["p.Phe197dup", "p.Glu2851del", "p.Glu492_Val493del", "p.Leu2044_Pro2045insArgLeu", "p.Pro1413_Gly1414delinsThrAsp"])
    assert.deepEqual(patterns(p), ["protein-indel"], p);
  for (const p of ["p.Gly1994delinsGluTer", "p.Tyr2852_Ser2853insTer", "p.Ser291_Val292insTrp*", "p.(Gly1752_Pro1753delinsTer)"])
    assert.deepEqual(patterns(p), ["stop-gain", "protein-indel"], p);
  for (const p of ["p.Gly12delinsTerLeu", "p.Gly12_Gly10del", "p.Gly12_Gly14insAla", "p.2084PGP[2]", "p.Gly12delinsXaa", "p.Gly12_Gly13ins?"])
    assert.deepEqual(patterns(p), ["unresolved"], p);
});

test("splice-site facet includes only exact coding ±1/2 SNVs and avoids UTR offsets, longer offsets and complex events", () => {
  for (const c of ["c.4119+1G>T", "c.4119+2T>C", "c.267-1G>C", "c.267-2A>G"])
    assert.deepEqual(patterns([], c), ["splice-site"], c);
  for (const c of ["c.4119+10G>T", "c.4119+12G>T", "c.267-20G>C", "c.-1-7dup", "c.-1-1G>T", "c.*5+1G>T", "c.5772+1del", "c.6751-2_6751-1del", "c.267-1G>G", "c.0+1G>T"])
    assert.deepEqual(patterns([], c), ["unresolved"], c);
});

test("annotations preserve source strings, allow overlapping descriptors and do not mutate or duplicate source evidence", () => {
  const v = variant(["p.(Gly2040Ser)", "p.(Gly2040Ser)", "p.Arg97ProfsTer23"], ["c.4119+1G>T", "c.4119+1G>T"], ["Recessive dystrophic epidermolysis bullosa"]);
  const original = structuredClone(v);
  const info = researchAnnotations(v);
  assert.deepEqual(info.patterns, ["frameshift", "missense", "glycine", "splice-site"]);
  assert.deepEqual(info.patternEvidence.map(item => [item.key, item.source]), [
    ["missense", "p.(Gly2040Ser)"], ["glycine", "p.(Gly2040Ser)"],
    ["frameshift", "p.Arg97ProfsTer23"], ["splice-site", "c.4119+1G>T"],
  ]);
  assert.ok(info.patternEvidence.every(item => item.label));
  assert.ok(info.summary.includes("Frameshift HGVS"));
  assert.deepEqual(v, original);
});

test("real snapshot facet counts preserve mixed conditions and unmapped splice-site records", () => {
  const annotations = data.variants.map(researchAnnotations);
  assert.deepEqual(Object.fromEntries(CONDITION_OPTIONS.map(option => [option.value, annotations.filter(info => info.conditionKeys.includes(option.value)).length])), { recessive:786, dominant:89, both:31 });
  assert.deepEqual(Object.fromEntries(HGVS_PATTERN_OPTIONS.map(option => [option.value, annotations.filter(info => info.patterns.includes(option.value)).length])), {
    frameshift:361, "stop-gain":193, missense:2184, glycine:570,
    "splice-site":261, synonymous:1497, "protein-indel":49, unresolved:1992,
  });
  const splice = data.variants.filter(v => patternMatches(v, "splice-site"));
  assert.equal(splice.length, 261);
  assert.ok(splice.every(v => v.proteinMapping.status === "unmapped"));
  const mixed = data.variants.find(v => v.variationId === 17425);
  assert.equal(conditionMatches(mixed, "recessive"), true);
  assert.equal(conditionMatches(mixed, "dominant"), true);
  assert.equal(conditionMatches(mixed, "both"), true);
  assert.equal(conditionMatches(data.variants.find(v => v.variationId === 345787), "recessive"), false);
});

test("empty and unsupported records have an explicit unresolved bucket without fabricated evidence", () => {
  assert.deepEqual(researchAnnotations({}).patterns, ["unresolved"]);
  assert.deepEqual(researchAnnotations({}).patternEvidence, []);
  const info = researchAnnotations(variant("p.?", "c.123+8G>A"));
  assert.deepEqual(info.patterns, ["unresolved"]);
  assert.deepEqual(info.patternEvidence.map(item => item.source), ["p.?", "c.123+8G>A"]);
  assert.equal(conditionMatches({}, "unknown"), false);
  assert.equal(patternMatches({}, "unknown"), false);
});
