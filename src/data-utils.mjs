import { UNCLASSIFIED } from "./chart-data.mjs";
import { submitterCounts } from "./evidence.mjs";
import { conditionDisplayLabel, expandConditionQuery } from "./condition-labels.mjs";
export { sortVariants } from "./variant-sort.mjs";

export const GROUPS = {
  pathogenic: {
    label: "Pathogenic / likely pathogenic",
    short: "Pathogenic",
    color: "#bc4548",
  },
  uncertain: {
    label: "Uncertain significance",
    short: "Uncertain",
    color: "#bd671f",
  },
  conflicting: {
    label: "Conflicting classifications",
    short: "Conflicting",
    color: "#8565a3",
  },
  benign: {
    label: "Benign / likely benign",
    short: "Benign",
    color: "#34835a",
  },
  other: { label: "Other / not classified", short: "Other", color: "#88929b" },
};
export const EMPTY_FILTERS = {
  query: "",
  significance: "",
  review: "",
  domain: "",
  mapping: "",
  type: "",
  range: null,
};
export const formatNumber = (n) => new Intl.NumberFormat("en-US").format(n);
export const humanReason = (s) => (s || "").replaceAll("_", " ");
export const positionLabel = (m) =>
  m.status !== "mapped"
    ? "Not mapped"
    : m.start === m.end
      ? `aa ${m.start}`
      : `aa ${m.start}–${m.end}`;
export function searchableText(v) {
  return [
    v.variationId,
    ...v.alleleIds,
    ...v.names,
    // Accept the accession:HGVS form as well as ClinVar's accession(gene):HGVS.
    ...v.names.map((name) => name.replace(/\([^)]*\)(?=:[cgnmr]\.)/gi, "")),
    ...(v.codingHgvs || []),
    ...(v.proteinHgvs || []),
    ...(v.dbSnpIds || [])
      .filter((id) => /^\d+$/.test(id))
      .flatMap((id) => [id, `rs${id}`]),
    ...(v.otherIds || []),
    ...v.geneSymbols,
    ...v.conditions,
    ...v.conditions.map(conditionDisplayLabel),
    ...v.conditionIdentifiers,
    ...v.rcvAccessions,
    ...v.clinicalSignificance,
    ...v.reviewStatus,
    ...v.genomicPositions.flatMap((p) => [
      p.assembly,
      p.chromosomeAccession,
      p.start,
      p.end,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function searchQuery(query) {
  const terms = expandConditionQuery(query)
    .toLowerCase()
    // Preserve coordinates copied from the evidence panel as a single term.
    .replace(
      /\b((?:chr)?(?:\d{1,2}|x|y|m|mt)|n[ct]_\d+(?:\.\d+)?)\s*:\s*(\d[\d,]*)(?:\s*([-–])\s*(\d[\d,]*))?/g,
      (_, reference, start, separator, end) =>
        `${reference}:${start}${separator ? `-${end}` : ""}`,
    )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const coordinates = [];
  const identifiers = [];
  const text = [];
  for (const term of terms) {
    const coordinate = term.match(
      /^((?:chr)?(?:\d{1,2}|x|y|m|mt)|n[ct]_\d+(?:\.\d+)?):(\d[\d,]*)(?:[-–](\d[\d,]*))?$/,
    );
    const identifier = term.match(/^(id|variation|allele):(\d+)$/);
    if (coordinate) {
      const start = Number(coordinate[2].replaceAll(",", ""));
      const end = Number((coordinate[3] || coordinate[2]).replaceAll(",", ""));
      coordinates.push({ reference: coordinate[1], start, end });
    } else if (identifier) {
      identifiers.push({ kind: identifier[1], value: Number(identifier[2]) });
    } else text.push(term);
  }
  // Assembly qualifiers must describe the same genomic position as the query.
  const assemblies = coordinates.length
    ? text.filter((t) => /^grch\d+$/.test(t))
    : [];
  return {
    coordinates,
    identifiers,
    assemblies,
    terms: text.filter((t) => !assemblies.includes(t)),
  };
}

function matchesCoordinates(v, { coordinates, assemblies }) {
  return coordinates.every(({ reference, start, end }) => {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start
    )
      return false;
    const chromosome = reference.replace(/^chr/, "").replace(/^m$/, "mt");
    return v.genomicPositions.some(
      (p) =>
        Number.isSafeInteger(p.start) &&
        Number.isSafeInteger(p.end) &&
        p.start <= end &&
        p.end >= start &&
        assemblies.every((a) => p.assembly?.toLowerCase() === a) &&
        (p.chromosomeAccession?.toLowerCase() === reference ||
          (!reference.includes(".") &&
            p.chromosomeAccession?.toLowerCase().split(".")[0] === reference) ||
          p.chromosome?.toLowerCase().replace(/^chr/, "").replace(/^m$/, "mt") === chromosome),
    );
  });
}

export function filterVariants(variants, filters) {
  const query = searchQuery(filters.query);
  return variants.filter((v) => {
    const m = v.proteinMapping;
    return (
      query.terms.every((t) => (v.searchText ?? searchableText(v)).includes(t)) &&
      query.identifiers.every(({ kind, value }) =>
        kind === "allele" ? v.alleleIds.includes(value) : v.variationId === value,
      ) &&
      matchesCoordinates(v, query) &&
      (!filters.significance ||
        (filters.significance === UNCLASSIFIED
          ? v.clinicalSignificance.length === 0
          : v.clinicalSignificance.includes(filters.significance))) &&
      (!filters.review || v.reviewStatus.includes(filters.review)) &&
      (!filters.domain || m.domainIds.includes(filters.domain)) &&
      (!filters.mapping || m.status === filters.mapping) &&
      (!filters.type || v.types.includes(filters.type)) &&
      (!filters.range ||
        (m.status === "mapped" &&
          m.start <= filters.range[1] &&
          m.end >= filters.range[0]))
    );
  });
}
export function histogram(variants, length, binSize = 25) {
  const bins = Array.from({ length: Math.ceil(length / binSize) }, (_, i) => ({
    start: i * binSize + 1,
    end: Math.min((i + 1) * binSize, length),
    total: 0,
    counts: Object.fromEntries(Object.keys(GROUPS).map((g) => [g, 0])),
  }));
  for (const v of variants) {
    if (v.proteinMapping.status !== "mapped") continue;
    // Each variation contributes once, at the first reported residue of its span.
    const bin = bins[Math.floor((v.proteinMapping.start - 1) / binSize)];
    if (bin) {
      bin.total++;
      bin.counts[v.significanceGroup]++;
    }
  }
  return bins;
}
export function csvCell(value) {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet formula evaluation when opening exported source text.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function variantsCsv(variants, domains, context = {}) {
  const labels = new Map(domains.map((d) => [d.id, d.label]));
  const header = [
    "Variation ID",
    "Allele IDs",
    "Gene symbols",
    "ClinVar name",
    "Coding HGVS",
    "Protein HGVS",
    "Clinical significance",
    "Review status",
    "Conditions (as reported)",
    "Condition identifiers",
    "Variant type",
    "Protein mapping status",
    "Unmapped reason",
    "Protein start (1-based)",
    "Protein end (inclusive)",
    "Mapping extent",
    "Domains",
    "Genomic positions",
    "Last evaluated",
    "ClinVar URL",
    "Source lines",
    "Source row SHA256",
    "Number of submitters (source counts)",
    "Snapshot prepared date",
    "ClinVar release date",
    "Protein mapping method",
    "Protein reference",
    "Protein reference URL",
    "Protein mapping provenance",
  ];
  const rows = variants.map((v) => [
    v.variationId,
    v.alleleIds.join("; "),
    v.geneSymbols.join("; "),
    v.names.join("; "),
    v.codingHgvs.join("; "),
    v.proteinHgvs.join("; "),
    v.clinicalSignificance.join("; "),
    v.reviewStatus.join("; "),
    v.conditions.join("; "),
    v.conditionIdentifiers.join("; "),
    v.types.join("; "),
    v.proteinMapping.status,
    v.proteinMapping.reason,
    v.proteinMapping.start,
    v.proteinMapping.end,
    v.proteinMapping.extent,
    v.proteinMapping.domainIds.map((id) => labels.get(id)).join("; "),
    v.genomicPositions
      .map(
        (p) =>
          `${p.assembly || "unspecified"} ${p.chromosomeAccession || p.chromosome || ""}:${p.start ?? "?"}-${p.end ?? "?"}`,
      )
      .join("; "),
    v.lastEvaluated.join("; "),
    v.url,
    v.sourceRecords.map((s) => s.line).join("; "),
    v.sourceRecords.map((s) => s.sha256).join("; "),
    submitterCounts(v).join("; "),
    context.snapshot?.preparedDate || "Not recorded",
    context.sources?.clinvar?.releaseDate || "Unknown",
    v.proteinMapping.method || "",
    v.proteinMapping.status === "mapped" ? (context.protein?.accession || "Q02388") : "",
    context.protein?.url || "",
    context.processing?.mapping || "",
  ]);
  return (
    "\uFEFF" +
    [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
