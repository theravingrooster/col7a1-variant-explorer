// Display-only synonym supported by NCBI MedGen C0079294 and GeneReviews NBK1304.
// Match complete source terms, including semicolon-delimited entries, without
// relabeling qualified subtypes or modifying the source arrays/identifiers.
export const DEB_SYNONYM_URL = "https://www.ncbi.nlm.nih.gov/medgen/37179";

export function conditionDisplayLabel(label) {
  return label.replace(/(^|;)(\s*)Epidermolysis bullosa dystrophica(?=\s*(?:;|$))/gi,
    "$1$2Dystrophic epidermolysis bullosa (DEB)");
}

// A DEB search also finds explicitly named dominant/recessive DEB entries.
// Do not infer a subtype or rewrite unrelated abbreviations such as RDEB.
export function expandConditionQuery(query) {
  return query.replace(/\(\s*DEB\s*\)|\bDEB\b|\bdystrophic\s+EB\b/gi,
    "dystrophic epidermolysis bullosa");
}
