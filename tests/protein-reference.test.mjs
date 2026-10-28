import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const source = JSON.parse(await readFile(new URL("../Q02388.json", import.meta.url)));
const { protein } = data;
const major = label => protein.domains.find(domain => domain.label === label);
const length = domain => domain.end - domain.start + 1;

test("the 2944-residue precursor is partitioned without gaps, overlaps, or signal-peptide renumbering", () => {
  assert.equal(protein.length, 2944);
  assert.equal(protein.sequence.length, protein.length);
  assert.equal(protein.sequence, source.sequence.value);
  assert.equal(createHash("md5").update(protein.sequence).digest("hex").toUpperCase(), source.sequence.md5);
  const regions = ["Signal peptide", "NC1", "Collagenous", "NC2"].map(major);
  assert.deepEqual(regions.map(({ start, end }) => [start, end]), [[1, 16], [17, 1253], [1254, 2784], [2785, 2944]]);
  assert.equal(regions.reduce((total, domain) => total + length(domain), 0), protein.length);
  for (let i = 1; i < regions.length; i++) assert.equal(regions[i].start, regions[i - 1].end + 1);
  assert.equal(length(major("NC1")), 1237);
  assert.equal(length(major("Signal peptide")) + length(major("NC1")), 1253);
});

test("all displayed regions and subdomains retain exact coordinates and evidence from their UniProt source pointers", () => {
  assert.equal(protein.domains.length, 16);
  for (const domain of protein.domains) {
    assert.equal(domain.source.sourceId, "uniprot");
    const pointer = domain.source.jsonPointer.match(/^\/features\/(\d+)$/);
    assert.ok(pointer, domain.label);
    const feature = source.features[Number(pointer[1])];
    assert.equal(domain.type, feature.type, domain.label);
    assert.equal(domain.description, feature.description || "", domain.label);
    assert.deepEqual([domain.start, domain.end], [feature.location.start.value, feature.location.end.value], domain.label);
    assert.deepEqual(domain.evidence, feature.evidences || [], domain.label);
    assert.ok(domain.start >= 1 && domain.end <= protein.length && length(domain) > 0, domain.label);
  }
});

test("precise subdomain boundaries keep their computational provenance rather than being attributed to the sequence paper", () => {
  const subdomains = protein.domains.filter(domain => domain.level === "subdomain");
  assert.equal(subdomains.length, 12);
  for (const domain of subdomains) {
    assert.ok(domain.evidence.some(item => item.evidenceCode === "ECO:0000255" && item.source === "PROSITE-ProRule"), domain.label);
  }
  for (const domain of protein.domains.filter(domain => domain.level === "region")) assert.deepEqual(domain.evidence, []);
  const paper = source.references.find(reference => reference.citation.id === "8051117");
  assert.ok(paper.referencePositions.includes("NUCLEOTIDE SEQUENCE [MRNA] (ISOFORM 1)"));
  assert.equal(paper.citation.publicationDate, "1994");
});

test("the historical collagenous/NC2 length difference does not silently remap the canonical Ala2784 record", () => {
  // Christiano et al. 1994 reports 1530/161 residues; the retained UniProt intervals yield 1531/160.
  assert.equal(length(major("Collagenous")), 1530 + 1);
  assert.equal(length(major("NC2")), 161 - 1);
  assert.equal(protein.sequence[2784 - 1], "A");
  const variant = data.variants.find(item => item.variationId === 2859164);
  assert.deepEqual(variant.proteinHgvs, ["p.Ala2784="]);
  assert.equal(variant.proteinMapping.start, 2784);
  assert.equal(variant.proteinMapping.end, 2784);
  assert.deepEqual(variant.proteinMapping.domainIds, [major("Collagenous").id]);
  assert.deepEqual(variant.proteinMapping.regionLabels, ["Collagenous"]);
});
