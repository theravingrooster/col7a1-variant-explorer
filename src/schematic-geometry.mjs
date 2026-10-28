import { createProteinView, projectProteinPoint } from "./protein-view.mjs";

// Illustrative domain architecture only. These coordinates are not a molecular model.
// Residues locate a segment along each schematic region; lengths are deliberately not to scale.
const TAU = Math.PI * 2;
const DEPTH_LAYERS = 12;
const REGIONS = {
  NC1: { from: 52, to: 192, turns: 2, steps: 54 },
  Collagenous: { from: 192, to: 438, turns: 5, steps: 90 },
  NC2: { from: 438, to: 494, turns: 1, steps: 30 },
};

export function schematicRegions(protein) {
  return protein.domains.filter(domain => domain.level === "region" && REGIONS[domain.label])
    .map(domain => ({ ...domain, ...REGIONS[domain.label] }))
    .sort((a, b) => a.start - b.start);
}

export function intersectRange(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2 ||
      ![...a, ...b].every(Number.isFinite) || a[0] > a[1] || b[0] > b[1]) return null;
  const start = Math.max(a[0], b[0]), end = Math.min(a[1], b[1]);
  return start <= end ? [start, end] : null;
}

export function linkedSchematicRange(protein, activeRange, selectedDomain = "") {
  const selected = protein.domains.find(domain => domain.id === selectedDomain);
  const candidate = activeRange ?? (selected ? [selected.start, selected.end] : null);
  return intersectRange(candidate, [1, protein.length]);
}

function point(region, fraction, strand) {
  const phase = strand * TAU / 3;
  const envelope = Math.sin(Math.PI * fraction) ** 2;
  // Folded ribbons distinguish the nonhelical regions from the collagenous braid.
  // Their contours are illustrative, not coordinates for any individual domain.
  const localY = region.label === "NC1" ? 12 + 28 * envelope * Math.cos(5 * Math.PI * fraction)
    : region.label === "NC2" ? 12 + 8 * envelope
    : 12 * Math.cos(fraction * TAU * region.turns);
  const localZ = region.label === "NC1" ? 28 * envelope * Math.sin(7 * Math.PI * fraction)
    : region.label === "NC2" ? 12 * envelope * Math.sin(fraction * TAU)
    : 12 * Math.sin(fraction * TAU * region.turns);
  const fold = region.label === "NC1" ? 16 * Math.sin(fraction * TAU * 3) * Math.sin(Math.PI * fraction)
    : region.label === "NC2" ? 4 * Math.sin(fraction * TAU) : 0;
  return [region.from + (region.to - region.from) * fraction + fold,
    118 + Math.sin(phase) * localY + Math.cos(phase) * localZ,
    Math.cos(phase) * localY - Math.sin(phase) * localZ];
}

/** Stable region/depth path keys; returned order is back-to-front for the current
 * pose. Imperative SVG renderers must update DOM order as well as path geometry. */
export function schematicFrame(regions, view = createProteinView(), activeRange = null) {
  const segments = [];
  let back = Infinity, front = -Infinity;
  for (const region of regions) for (let strand = 0; strand < 3; strand++) {
    for (let i = 0; i < region.steps; i++) {
      const from = i / region.steps, to = (i + 1) / region.steps;
      const a = projectProteinPoint(point(region, from, strand), view);
      const b = projectProteinPoint(point(region, to, strand), view);
      const z = (a.z + b.z) / 2;
      back = Math.min(back, z); front = Math.max(front, z);
      const residueStart = region.start + from * (region.end - region.start);
      const residueEnd = region.start + to * (region.end - region.start);
      segments.push({ regionId: region.id, a, b, z, highlighted: Boolean(intersectRange(activeRange, [residueStart, residueEnd])) });
    }
  }
  const buckets = [];
  for (let layer = 0; layer < DEPTH_LAYERS; layer++) for (const region of regions) for (const highlighted of [false, true]) {
    buckets.push({ key: `${region.id}-${layer}-${highlighted}`, regionId: region.id, layer,
      depth: Math.min(2, Math.floor(layer * 3 / DEPTH_LAYERS)), highlighted, d: "", segments: 0, z: 0 });
  }
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  const span = Math.max(front - back, 1e-8);
  for (const segment of segments) {
    const layer = Math.min(DEPTH_LAYERS - 1, Math.floor((segment.z - back) / span * DEPTH_LAYERS));
    const bucket = byKey.get(`${segment.regionId}-${layer}-${segment.highlighted}`);
    bucket.d += `M${segment.a.x.toFixed(2)},${segment.a.y.toFixed(2)}L${segment.b.x.toFixed(2)},${segment.b.y.toFixed(2)}`;
    bucket.segments++;
    bucket.z += segment.z;
  }
  for (const bucket of buckets) bucket.z = bucket.segments ? bucket.z / bucket.segments : back + span * (bucket.layer + .5) / DEPTH_LAYERS;
  return buckets.sort((a, b) => a.layer - b.layer || a.z - b.z || Number(a.highlighted) - Number(b.highlighted));
}

export function projectedRegionLabels(regions, view = createProteinView()) {
  return regions.map(region => ({ id: region.id, ...projectProteinPoint([(region.from + region.to) / 2, 118, 0], view) }));
}
