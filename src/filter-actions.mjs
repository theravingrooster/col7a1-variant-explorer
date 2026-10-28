/**
 * Apply one UI filter change without retaining incompatible spatial filters.
 * Values are validated by the controls/URL reader before reaching this helper.
 * Domain selection starts a new region focus; clearing a domain leaves an
 * explicitly selected residue range intact. Non-spatial filters are preserved.
 */
export function updateFilter(filters, key, value) {
  const next = { ...filters, [key]: value };
  if (key === "domain" && value) {
    next.range = null;
    if (next.mapping === "unmapped") next.mapping = "";
  } else if (key === "mapping" && value === "unmapped") {
    next.domain = "";
    next.range = null;
  } else if (key === "range" && value && next.mapping === "unmapped") {
    next.mapping = "";
  }
  return next;
}

/** Toggle a grouped domain/classification bar as one coherent action. */
export function toggleDomainClassification(filters, domain, significance) {
  const selected = filters.domain === domain && filters.significance === significance;
  if (selected) return { ...filters, domain: "", significance: "", range: null };
  return { ...updateFilter(filters, "domain", domain), significance };
}
