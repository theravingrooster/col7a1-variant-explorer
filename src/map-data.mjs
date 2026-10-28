/** Protein-map coordinates are 1-based inclusive; no new molecular inference. */
export const MAP_GROUPS = ["pathogenic", "uncertain", "conflicting", "benign", "other"];
export const MARKER_LIMIT = 180;

export function mapWindow(protein, filters = {}) {
  const domain = protein.domains.find(d => d.id === filters.domain);
  return filters.range ? [...filters.range] : domain ? [domain.start, domain.end] : [1, protein.length];
}

export function variantsInWindow(variants, [start, end]) {
  return variants.filter(v => v.proteinMapping.status === "mapped" &&
    v.proteinMapping.start <= end && v.proteinMapping.end >= start);
}

export function densityBins(variants, range, targetBins = 120) {
  const [start, end] = range;
  const binSize = Math.max(1, Math.ceil((end - start + 1) / targetBins));
  const bins = Array.from({ length: Math.ceil((end - start + 1) / binSize) }, (_, i) => ({
    start: start + i * binSize,
    end: Math.min(end, start + (i + 1) * binSize - 1),
    total: 0,
    counts: Object.fromEntries(MAP_GROUPS.map(key => [key, 0])),
    samples: [],
  }));
  // Each overlapping variant contributes once. Intervals beginning before a
  // zoomed window are counted at its left edge, not discarded or counted twice.
  for (const variant of variantsInWindow(variants, range)) {
    const index = Math.floor((Math.max(start, variant.proteinMapping.start) - start) / binSize);
    const bin = bins[index];
    bin.total++;
    bin.counts[MAP_GROUPS.includes(variant.significanceGroup) ? variant.significanceGroup : "other"]++;
    if (bin.samples.length < 3) bin.samples.push(variant);
  }
  return { bins, binSize };
}

/** Compact SVG position lanes. A tick may represent several source variants
 * sharing the same anchor and significance group; count them without inventing
 * multiple physical positions. Long intervals crossing into the view are
 * clamped to its left edge, with that convention exposed in the UI. */
export function positionTracks(variants, range) {
  const tracks = new Map(MAP_GROUPS.map(group => [group, new Map()]));
  for (const variant of variantsInWindow(variants, range)) {
    const group = MAP_GROUPS.includes(variant.significanceGroup) ? variant.significanceGroup : "other";
    const position = Math.max(range[0], variant.proteinMapping.start);
    const points = tracks.get(group);
    const point = points.get(position) || { position, count: 0, clipped: 0 };
    point.count++;
    if (variant.proteinMapping.start < range[0]) point.clipped++;
    points.set(position, point);
  }
  return MAP_GROUPS.map(group => ({
    group,
    points: [...tracks.get(group).values()].sort((a, b) => a.position - b.position),
  }));
}

/** Domain membership is the same source-derived overlap used by the table. */
export function regionEvidence(variants, domain, sampleLimit = 2) {
  const matching = variants.filter(v => v.proteinMapping.domainIds?.includes(domain.id));
  return { ...domain, total: matching.length, samples: matching.slice(0, sampleLimit) };
}

export function markerLayout(variants, range, width = 1040) {
  const [start, end] = range;
  const scale = n => (n - start + .5) / (end - start + 1) * width;
  const lanes = [];
  const markers = variantsInWindow(variants, range)
    .sort((a, b) => a.proteinMapping.start - b.proteinMapping.start || a.variationId - b.variationId)
    .map(variant => {
      const m = variant.proteinMapping;
      const x = scale(Math.max(start, m.start));
      const endX = scale(Math.min(end, m.end));
      let lane = lanes.findIndex(last => x - last >= 20);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = Math.max(x, endX);
      return { variant, x, endX, lane, clippedStart: m.start < start, clippedEnd: m.end > end };
    });
  return { markers, lanes: lanes.length };
}

export function validMapRange(start, end, length) {
  if (!/^\d+$/.test(String(start)) || !/^\d+$/.test(String(end))) return null;
  const range = [Number(start), Number(end)];
  return range.every(Number.isSafeInteger) && range[0] >= 1 && range[1] >= range[0] && range[1] <= length ? range : null;
}

export function mapTicks([start, end]) {
  const span = end - start;
  if (!span) return [start];
  const raw = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= raw));
  const ticks = [start];
  for (let n = Math.ceil(start / step) * step; n < end; n += step) {
    if (n > start && n - start > span * .07 && end - n > span * .07) ticks.push(n);
  }
  return [...new Set([...ticks, end])];
}
