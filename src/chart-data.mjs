// This key is a filter value, never a reassigned clinical classification.
export const UNCLASSIFIED = "__not_classified__";

const CLASSIFICATIONS = [
  ["Pathogenic", "Pathogenic", "pathogenic", "#b8503e"],
  ["Likely pathogenic", "Likely pathogenic", "likely-pathogenic", "#c98162"],
  ["Pathogenic/Likely pathogenic", "Pathogenic / likely pathogenic", "pathogenic-combined", "#964936"],
  ["Uncertain significance", "Uncertain significance (VUS)", "uncertain", "#b78a30"],
  ["Conflicting classifications of pathogenicity", "Conflicting classifications", "conflicting", "#8565a3"],
  ["Benign", "Benign", "benign", "#458985"],
  ["Likely benign", "Likely benign", "likely-benign", "#70a39a"],
  ["Benign/Likely benign", "Benign / likely benign", "benign-combined", "#346f67"],
  ["no classification for the single variant", "No classification (source)", "other", "#88929b"],
  [UNCLASSIFIED, "Not reported", "not-reported", "#a4aaa9"],
];

const METADATA = new Map(CLASSIFICATIONS.map(([key, label, tone, color], order) =>
  [key, { key, label, tone, color, order }],
));

function labelsFor(variant) {
  const labels = [...new Set(variant.clinicalSignificance)];
  return labels.length ? labels : [UNCLASSIFIED];
}

function metadata(key) {
  return METADATA.get(key) || {
    key, label: key, tone: "other", color: "#88929b", order: CLASSIFICATIONS.length,
  };
}

/**
 * Count every filtered record once per distinct source classification. Pass the
 * full dataset as allVariants to retain a stable catalogue, including zero bars.
 * Unknown future source classifications remain distinct and filterable.
 */
export function classificationSummary(variants, allVariants = variants) {
  const counts = new Map();
  for (const variant of allVariants)
    for (const key of labelsFor(variant)) counts.set(key, 0);
  for (const variant of variants)
    for (const key of labelsFor(variant)) counts.set(key, (counts.get(key) || 0) + 1);
  return [...counts].map(([key, count]) => ({ ...metadata(key), count }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/**
 * Inclusive domain overlap uses the same domain IDs as the table filter.
 * A spanning record can contribute to multiple regions; a record with multiple
 * source classifications can contribute to multiple grouped bars in one region.
 * `total` remains the unique-record count for that region, not the sum of bars.
 */
export function domainSummary(variants, domains, categories = classificationSummary(variants)) {
  const domainNames = ["NC1", "Collagenous", "NC2"];
  return domainNames.flatMap((label) => {
    const domain = domains.find((item) => item.level === "region" && item.label === label);
    if (!domain) return [];
    const members = variants.filter((variant) =>
      variant.proteinMapping.status === "mapped" &&
      variant.proteinMapping.domainIds.includes(domain.id),
    );
    const counts = new Map(categories.map(({ key }) => [key, 0]));
    for (const variant of members)
      for (const key of labelsFor(variant)) counts.set(key, (counts.get(key) || 0) + 1);
    // Keep unknown labels if an incomplete catalogue was supplied by a caller.
    const allCategories = [...categories];
    for (const key of counts.keys())
      if (!allCategories.some((category) => category.key === key)) allCategories.push(metadata(key));
    return [{
      id: domain.id,
      key: domain.id,
      label: domain.label,
      start: domain.start,
      end: domain.end,
      total: members.length,
      counts: Object.fromEntries(counts),
      series: allCategories.map((category) => ({ ...category, count: counts.get(category.key) || 0 })),
    }];
  });
}

export function chartCoverage(variants, domains) {
  const majorIds = new Set(domains.filter((domain) =>
    domain.level === "region" && ["NC1", "Collagenous", "NC2"].includes(domain.label),
  ).map((domain) => domain.id));
  let mapped = 0, outsideMajorDomains = 0, spanningDomains = 0, multipleClassifications = 0;
  for (const variant of variants) {
    if (new Set(variant.clinicalSignificance).size > 1) multipleClassifications++;
    if (variant.proteinMapping.status !== "mapped") continue;
    mapped++;
    const overlaps = [...new Set(variant.proteinMapping.domainIds)].filter((id) => majorIds.has(id)).length;
    if (!overlaps) outsideMajorDomains++;
    if (overlaps > 1) spanningDomains++;
  }
  return { total: variants.length, mapped, unmapped: variants.length - mapped, outsideMajorDomains, spanningDomains, multipleClassifications };
}
