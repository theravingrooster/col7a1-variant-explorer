import { evidenceSummary, submitterCounts } from "./evidence.mjs";
import { conditionDisplayLabel } from "./condition-labels.mjs";

// Text order is alphabetical, never a ranking of clinical severity or evidence quality.
export const TABLE_SORT_FIELDS = [
  { key: "hgvs", label: "Variant / HGVS", ascendingLabel: "HGVS A–Z", descendingLabel: "HGVS Z–A", description: "Natural alphabetical order of coding HGVS, falling back to protein HGVS; missing HGVS stays last." },
  { key: "significance", label: "Clinical significance", ascendingLabel: "Clinical significance A–Z", descendingLabel: "Clinical significance Z–A", description: "Alphabetical source classifications, not clinical severity; missing classifications stay last." },
  { key: "review", label: "Review", ascendingLabel: "Review status A–Z", descendingLabel: "Review status Z–A", description: "Alphabetical order of the displayed review label, not an evidence-quality ranking; missing review status stays last." },
  { key: "submitters", label: "Submitters", ascendingLabel: "Submitters: fewest first", descendingLabel: "Submitters: most first", description: "Highest reported source submitter count when source counts differ; counts are never added together. Missing counts stay last." },
  { key: "domain", label: "Domain", ascendingLabel: "Domain A–Z", descendingLabel: "Domain Z–A", description: "Alphabetical source region labels; variants without a mapped domain stay last." },
  { key: "position", label: "Position", ascendingLabel: "Protein position ↑", descendingLabel: "Protein position ↓", description: "First reported protein residue, numerically; unmapped variants stay last." },
  { key: "conditions", label: "Conditions", ascendingLabel: "Conditions A–Z", descendingLabel: "Conditions Z–A", description: "Alphabetical displayed condition names, preserving source entry order; missing conditions stay last." },
  { key: "id", label: "ClinVar", ascendingLabel: "Variation ID ↑", descendingLabel: "Variation ID ↓", description: "Numeric ClinVar Variation ID." },
];

export const SORT_OPTIONS = TABLE_SORT_FIELDS.flatMap(field => [
  { value: field.key, label: field.ascendingLabel },
  { value: `${field.key}-desc`, label: field.descendingLabel },
]);
export const SORT_KEYS = new Set(SORT_OPTIONS.map(option => option.value));
const textOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const text = values => Array.isArray(values) ? values.filter(value => typeof value === "string" && value.trim()).join(" / ") || null : null;

function valueFor(variant, field) {
  switch (field) {
    case "hgvs": return text(variant.codingHgvs) || text(variant.proteinHgvs);
    case "significance": return text(variant.clinicalSignificance);
    case "review": return text(variant.reviewStatus) ? evidenceSummary(variant).shortLabel : null;
    case "submitters": return submitterCounts(variant).at(-1) ?? null;
    case "domain": return variant.proteinMapping?.status === "mapped" ? text(variant.proteinMapping.regionLabels) : null;
    case "position": return variant.proteinMapping?.status === "mapped" && Number.isSafeInteger(variant.proteinMapping.start) ? variant.proteinMapping.start : null;
    case "conditions": return text(variant.conditions?.map(conditionDisplayLabel));
    default: return variant.variationId;
  }
}

/** Sort the whole filtered cohort before pagination. Missing values always stay
 * last and equal keys use ascending Variation ID, independent of input order.
 * Each key is derived once per variant, not repeatedly inside the comparator. */
export function sortVariants(variants, requestedSort = "id") {
  const sort = SORT_KEYS.has(requestedSort) ? requestedSort : "id";
  const descending = sort.endsWith("-desc");
  const field = descending ? sort.slice(0, -5) : sort;
  const direction = descending ? -1 : 1;
  return variants.map(variant => ({ variant, value: valueFor(variant, field) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value !== b.value) return a.value === null ? 1 : -1;
      } else {
        const compared = typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value : textOrder.compare(a.value, b.value);
        if (compared) return compared * direction;
      }
      return a.variant.variationId - b.variant.variationId;
    }).map(item => item.variant);
}
