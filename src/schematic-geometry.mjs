// Illustrative domain architecture only. These coordinates are not a molecular model.
// Residues locate a segment along each schematic region; lengths are deliberately not to scale.
const TAU = Math.PI * 2;
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

function point(region, fraction, strand, angle) {
  const phase = angle + strand * TAU / 3;
  const envelope = Math.sin(Math.PI * fraction) ** 2;
  // Folded ribbons distinguish the nonhelical regions from the collagenous braid.
  // Their contours are illustrative, not coordinates for any individual domain.
  const localY = region.label === "NC1" ? 12 + 28 * envelope * Math.cos(5 * Math.PI * fraction)
    : region.label === "NC2" ? 12 + 8 * envelope
    : 12 * Math.cos(fraction * TAU * region.turns);
  const localZ = region.label === "NC1" ? 28 * envelope * Math.sin(7 * Math.PI * fraction)
    : region.label === "NC2" ? 12 * envelope * Math.sin(fraction * TAU)
    : 12 * Math.sin(fraction * TAU * region.turns);
  const radius = Math.max(1, Math.hypot(localY, localZ));
  const fold = region.label === "NC1" ? 16 * Math.sin(fraction * TAU * 3) * Math.sin(Math.PI * fraction)
    : region.label === "NC2" ? 4 * Math.sin(fraction * TAU) : 0;
  const x = region.from + (region.to - region.from) * fraction + fold;
  const z = Math.cos(phase) * localY - Math.sin(phase) * localZ;
  return { x, y: 118 - (x - 260) * .075 + Math.sin(phase) * localY + Math.cos(phase) * localZ, z, radius };
}

export function schematicFrame(regions, angleDegrees, activeRange = null) {
  const angle = (Number.isFinite(angleDegrees) ? angleDegrees : 0) * Math.PI / 180;
  const buckets = [];
  // Three depth layers make the rotation legible with only 18 SVG paths.
  for (let depth = 0; depth < 3; depth++) for (const region of regions) for (const highlighted of [false, true]) {
    buckets.push({ key: `${region.id}-${depth}-${highlighted}`, regionId: region.id, depth, highlighted, d: "", segments: 0 });
  }
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  for (const region of regions) for (let strand = 0; strand < 3; strand++) {
    for (let i = 0; i < region.steps; i++) {
      const from = i / region.steps, to = (i + 1) / region.steps;
      const a = point(region, from, strand, angle), b = point(region, to, strand, angle);
      const middle = point(region, (from + to) / 2, strand, angle);
      const depth = middle.z < -middle.radius / 3 ? 0 : middle.z > middle.radius / 3 ? 2 : 1;
      const residueStart = region.start + from * (region.end - region.start);
      const residueEnd = region.start + to * (region.end - region.start);
      const highlighted = Boolean(intersectRange(activeRange, [residueStart, residueEnd]));
      const bucket = byKey.get(`${region.id}-${depth}-${highlighted}`);
      bucket.d += `M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`;
      bucket.segments++;
    }
  }
  return buckets;
}
