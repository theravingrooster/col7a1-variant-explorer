/** ClinVar source review status, not an inference from submitter counts. */
export const MULTIPLE_SUBMITTERS_REVIEW =
  "criteria provided, multiple submitters, no conflicts";

export function submitterCounts(variant) {
  return [...new Set((variant.numberSubmitters || []).filter(
    (count) => Number.isSafeInteger(count) && count >= 0,
  ))].sort((a, b) => a - b);
}

/** Preserve distinct source counts; assembly rows never add submitters. */
export function submittersLabel(variant) {
  const counts = submitterCounts(variant);
  if (!counts.length) return "Submitter count not reported";
  if (counts.length > 1)
    return `${counts.join(" / ")} submitters (source counts differ)`;
  return `${counts[0]} ${counts[0] === 1 ? "submitter" : "submitters"}`;
}

/** Evidence labels describe review provenance, never clinical severity. */
export function evidenceSummary(variant) {
  const statuses = [...new Set(variant.reviewStatus || [])];
  const fullLabel = statuses.join("; ") || "Not reported";
  const multipleSubmittersNoConflicts = statuses.includes(MULTIPLE_SUBMITTERS_REVIEW);
  let shortLabel = "Review status reported", tone = "unknown";
  if (!statuses.length) shortLabel = "Review not reported";
  else if (statuses.length > 1) {
    // Do not collapse differing source review statuses into a single quality tier.
    shortLabel = "Multiple review statuses";
    tone = statuses.some(s => /conflicting/i.test(s)) ? "conflicting" : "unknown";
  } else if (/conflicting/i.test(statuses[0])) {
    shortLabel = "Conflicting classifications";
    tone = "conflicting";
  } else if (multipleSubmittersNoConflicts) {
    shortLabel = "Multiple submitters, no conflicts";
    tone = "consensus";
  } else if (statuses[0] === "reviewed by expert panel") {
    shortLabel = "Expert panel review";
    tone = "expert";
  } else if (statuses[0] === "practice guideline") {
    shortLabel = "Practice guideline";
    tone = "expert";
  } else if (statuses[0] === "criteria provided, single submitter") {
    shortLabel = "Single submitter review";
    tone = "single";
  } else if (statuses[0] === "no assertion criteria provided") {
    shortLabel = "No assertion criteria";
    tone = "limited";
  } else if (statuses[0] === "no classification for the single variant") {
    shortLabel = "No variant classification";
    tone = "limited";
  }
  return {
    shortLabel, fullLabel, tone, multipleSubmittersNoConflicts,
    submittersLabel: submittersLabel(variant),
    submitterCounts: submitterCounts(variant),
  };
}
