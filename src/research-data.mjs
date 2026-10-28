// Research facets derived only from the existing ClinVar labels and explicit HGVS.
// These are record-level descriptors, not inheritance, phase, splice-effect,
// loss-of-function, or treatment-eligibility predictions.
export const CONDITION_OPTIONS = Object.freeze([
  { value: "recessive", label: "Recessive EB reported" },
  { value: "dominant", label: "Dominant EB reported" },
  { value: "both", label: "Both recessive and dominant labels" },
]);

export const HGVS_PATTERN_OPTIONS = Object.freeze([
  { value: "frameshift", label: "Frameshift HGVS" },
  { value: "stop-gain", label: "Stop introduced (protein HGVS)" },
  { value: "missense", label: "Missense HGVS" },
  { value: "glycine", label: "Glycine substitution HGVS" },
  { value: "splice-site", label: "Splice-site ±1/2 SNV" },
  { value: "synonymous", label: "Protein unchanged (HGVS)" },
  { value: "protein-indel", label: "Protein indel / duplication HGVS" },
  { value: "unresolved", label: "Other / unresolved HGVS" },
]);

export const CONDITION_LABELS = Object.freeze(Object.fromEntries(CONDITION_OPTIONS.map(option => [option.value, option.label])));
export const HGVS_PATTERN_LABELS = Object.freeze(Object.fromEntries(HGVS_PATTERN_OPTIONS.map(option => [option.value, option.label])));

const CONDITION_TERMS = {
  recessive: new Set([
    "Recessive dystrophic epidermolysis bullosa",
    "Epidermolysis bullosa dystrophica inversa, autosomal recessive",
    "Epidermolysis bullosa pruriginosa, autosomal recessive",
    "Epidermolysis bullosa dystrophica, autosomal recessive, localisata variant",
    "Epidermolysis bullosa, pretibial, autosomal recessive",
  ].map(value => value.toLowerCase())),
  dominant: new Set([
    "Generalized dominant dystrophic epidermolysis bullosa",
    "Dominant dystrophic epidermolysis bullosa with absence of skin",
    "Epidermolysis bullosa pruriginosa, autosomal dominant",
  ].map(value => value.toLowerCase())),
};

const AA = "(?:Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val)";
const POSITION = "([1-9]\\d*)";
const RESIDUE = `${AA}${POSITION}`;
const SINGLE = new RegExp(`^(${AA}|Ter|\\*)${POSITION}(${AA}|Ter|\\*|=)$`);
const FRAMESHIFT = new RegExp(`^${AA}${POSITION}(?:${AA})?fs(?:(?:Ter|\\*)(?:[1-9]\\d*|\\?))?$`);
const DELETION_DUPLICATION = new RegExp(`^${RESIDUE}(?:_${RESIDUE})?(?:del|dup)$`);
// Ter/* is allowed only at the end of an explicitly introduced sequence.
const INSERTED_SEQUENCE = `((?:${AA})+(?:Ter|\\*)?|Ter|\\*)`;
const DELINS = new RegExp(`^${RESIDUE}(?:_${RESIDUE})?delins${INSERTED_SEQUENCE}$`);
const INSERTION = new RegExp(`^${RESIDUE}_${RESIDUE}ins${INSERTED_SEQUENCE}$`);
const SPLICE_SITE_SNV = /^c\.([1-9]\d*)[+-]([12])([ACGT])>([ACGT])$/;
const strings = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string").map(value => value.trim()).filter(Boolean))];
const validPosition = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validSpan = match => validPosition(match[1]) && (!match[2] || (validPosition(match[2]) && Number(match[2]) >= Number(match[1])));

function conditionAnnotations(variant) {
  const sourceTerms = strings(strings(variant.conditions).flatMap(value => value.split(";")));
  const matchedConditions = sourceTerms.filter(value => Object.values(CONDITION_TERMS).some(terms => terms.has(value.toLowerCase())));
  const conditionKeys = ["recessive", "dominant"].filter(key => matchedConditions.some(value => CONDITION_TERMS[key].has(value.toLowerCase())));
  if (conditionKeys.length === 2) conditionKeys.push("both");
  return { conditionKeys, matchedConditions };
}

function proteinPatterns(source) {
  // Parentheses denote a predicted protein description; the pattern remains a
  // source-reported description and is never promoted to functional evidence.
  const description = source.match(/^p\.(?:\(([^()]+)\)|([^()]+))$/);
  if (!description) return [];
  const body = description[1] || description[2];
  const frameshift = body.match(FRAMESHIFT);
  if (frameshift && validPosition(frameshift[1])) return ["frameshift"];
  const single = body.match(SINGLE);
  if (single && validPosition(single[2])) {
    const [, from, , to] = single;
    if (to === "=") return ["synonymous"];
    if (from === "Ter" || from === "*") return []; // Stop-loss/extension is a different event.
    if (to === "Ter" || to === "*") return ["stop-gain"];
    if (from !== to) return from === "Gly" ? ["missense", "glycine"] : ["missense"];
    return []; // Do not interpret nonstandard same-amino-acid substitutions.
  }
  const simpleIndel = body.match(DELETION_DUPLICATION);
  if (simpleIndel && validSpan(simpleIndel)) return ["protein-indel"];
  const delins = body.match(DELINS);
  if (delins && validSpan(delins)) return /(?:Ter|\*)$/.test(delins[3]) ? ["stop-gain", "protein-indel"] : ["protein-indel"];
  const insertion = body.match(INSERTION);
  if (insertion && validSpan(insertion) && Number(insertion[2]) === Number(insertion[1]) + 1)
    return /(?:Ter|\*)$/.test(insertion[3]) ? ["stop-gain", "protein-indel"] : ["protein-indel"];
  return [];
}

export function researchAnnotations(variant = {}) {
  const conditions = conditionAnnotations(variant);
  const protein = strings(variant.proteinHgvs), coding = strings(variant.codingHgvs);
  const patternEvidence = [];
  const add = (key, source) => {
    if (!patternEvidence.some(item => item.key === key && item.source === source))
      patternEvidence.push({ key, label: HGVS_PATTERN_LABELS[key], source });
  };
  for (const source of protein) for (const key of proteinPatterns(source)) add(key, source);
  for (const source of coding) {
    const match = source.match(SPLICE_SITE_SNV);
    if (match && validPosition(match[1]) && match[3] !== match[4]) add("splice-site", source);
  }
  const patterns = HGVS_PATTERN_OPTIONS.map(option => option.value).filter(key => patternEvidence.some(item => item.key === key));
  if (!patterns.length) {
    patterns.push("unresolved");
    for (const source of [...protein, ...coding]) add("unresolved", source);
  }
  return {
    ...conditions,
    conditionLabels: conditions.conditionKeys.map(key => CONDITION_LABELS[key]),
    patterns,
    patternEvidence,
    summary: patterns.map(key => HGVS_PATTERN_LABELS[key]).join(" · "),
  };
}

export function conditionMatches(variant, key) {
  return Object.hasOwn(CONDITION_LABELS, key) && conditionAnnotations(variant).conditionKeys.includes(key);
}

export function patternMatches(variant, key) {
  return Object.hasOwn(HGVS_PATTERN_LABELS, key) && researchAnnotations(variant).patterns.includes(key);
}
