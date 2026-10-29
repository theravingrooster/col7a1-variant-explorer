const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const score = (value, max = 100) => finite(value) && value >= 0 && value <= max;
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const range = value => Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger) && value[0] >= 1 && value[0] <= value[1];
const fail = message => { throw new Error(`Invalid structure manifest: ${message}`); };

/** Validate sequence identity and all residue/chain mappings before showing a model.
 * Build-time checks additionally verify hashes and the original mmCIF atom rows. */
export function validateStructureManifest(raw, protein) {
  if (!record(raw) || raw.schemaVersion !== 1 || !record(raw.reference)) fail("unsupported format");
  const reference = raw.reference;
  if (reference.accession !== "Q02388-1" || !Number.isSafeInteger(reference.length) || reference.length !== 2944 || !hash(reference.sequenceSha256) || !hash(reference.sourceSha256)) fail("canonical reference");
  if (protein && (protein.length !== reference.length || !["Q02388", "Q02388-1"].includes(protein.accession))) fail("reference differs from the variant map");
  if (typeof raw.method !== "string" || !raw.method || typeof raw.attribution !== "string" || typeof raw.outputUse !== "string" || raw.outputTermsUrl !== "https://alphafoldserver.com/output-terms" || raw.documentationUrl !== "https://www.ebi.ac.uk/training/online/courses/alphafold/alphafold-3-and-alphafold-server/alphafold-server-your-gateway-to-alphafold-3/interpreting-results-from-alphafold-server/") fail("source attribution");
  if (!Array.isArray(raw.fragments) || !raw.fragments.length || raw.fragments.length > 20) fail("fragment list");
  const ids = new Set();
  for (const fragment of raw.fragments) {
    if (!record(fragment) || typeof fragment.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(fragment.id) || ids.has(fragment.id)) fail("fragment ID");
    ids.add(fragment.id);
    if (typeof fragment.label !== "string" || !fragment.label || typeof fragment.caution !== "string" || !fragment.caution) fail("fragment labels");
    if (!range([fragment.start, fragment.end]) || fragment.end > reference.length || fragment.length !== fragment.end - fragment.start + 1) fail("fragment interval");
    if (typeof fragment.sequence !== "string" || !/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(fragment.sequence) || fragment.sequence.length !== fragment.length) fail("fragment sequence");
    if (protein?.sequence && protein.sequence.slice(fragment.start - 1, fragment.end) !== fragment.sequence) fail("fragment does not match canonical sequence");
    if (!Array.isArray(fragment.chains) || !fragment.chains.length || fragment.chains.length > 10 || fragment.chains.some(chain => typeof chain !== "string" || !/^[A-Za-z0-9]{1,4}$/.test(chain)) || new Set(fragment.chains).size !== fragment.chains.length) fail("chain IDs");
    if (!Number.isSafeInteger(fragment.seed) || fragment.seed < 0 || !Number.isSafeInteger(fragment.modelRank) || fragment.modelRank < 0 || fragment.modelRank > 4 || !Number.isSafeInteger(fragment.atomCount) || fragment.atomCount < fragment.length * fragment.chains.length) fail("model identity");
    if (fragment.coordinateUrl !== `/data/structures/${fragment.id}.cif` || !hash(fragment.coordinateSha256)) fail("coordinate source");
    const confidence = fragment.confidence;
    if (!record(confidence) || !score(confidence.ptm, 1) || !(confidence.iptm === null || score(confidence.iptm, 1)) || !score(confidence.meanAtomPlddt) || !score(confidence.meanCaPlddt) || !finite(confidence.meanIntraChainPae) || confidence.meanIntraChainPae < 0 || !(confidence.meanInterChainPae === null || finite(confidence.meanInterChainPae) && confidence.meanInterChainPae >= 0)) fail("confidence metrics");
    if (fragment.chains.length === 1 && (confidence.iptm !== null || confidence.meanInterChainPae !== null)) fail("single-chain interface metrics");
    if (!Array.isArray(fragment.residues) || fragment.residues.length !== fragment.length) fail("residue coverage");
    fragment.residues.forEach((residue, index) => {
      if (!record(residue) || residue.modelPosition !== index + 1 || residue.position !== fragment.start + index || residue.aminoAcid !== fragment.sequence[index] || !record(residue.plddt) || Object.keys(residue.plddt).length !== fragment.chains.length || fragment.chains.some(chain => !score(residue.plddt[chain]))) fail("residue confidence mapping");
    });
    const provenance = fragment.provenance;
    if (!record(provenance) || !hash(provenance.archiveSha256) || !hash(provenance.jobRequestSha256) || !hash(provenance.summarySha256) || !hash(provenance.fullDataSha256) || provenance.jobRequestUrl !== `/data/structures/${fragment.id}.job.json` || provenance.summaryUrl !== `/data/structures/${fragment.id}.summary.json`) fail("provenance");
    if (!Array.isArray(fragment.domainOverlaps) || fragment.domainOverlaps.some(domain => !record(domain) || typeof domain.label !== "string" || !range([domain.start, domain.end]) || domain.end > reference.length || !fragmentOverlap(fragment, [domain.start, domain.end]))) fail("domain boundaries");
  }
  return raw;
}

/** Inclusive canonical overlap. Null means no overlap, not a fabricated position. */
export function fragmentOverlap(fragment, selectedRange) {
  if (!fragment || !range([fragment.start, fragment.end]) || !range(selectedRange)) return null;
  const start = Math.max(fragment.start, selectedRange[0]);
  const end = Math.min(fragment.end, selectedRange[1]);
  return start <= end ? [start, end] : null;
}

/** Convert 1-based fragment residue numbering to the original canonical sequence. */
export function canonicalPosition(fragment, modelResidue) {
  if (!fragment || !Number.isSafeInteger(modelResidue) || modelResidue < 1 || modelResidue > fragment.length) return null;
  return fragment.start + modelResidue - 1;
}

/** Residue metadata for just the modeled part of a selected canonical interval. */
export function residuesAtRange(fragment, selectedRange) {
  const overlap = fragmentOverlap(fragment, selectedRange);
  return overlap ? fragment.residues.filter(residue => residue.position >= overlap[0] && residue.position <= overlap[1]) : [];
}
