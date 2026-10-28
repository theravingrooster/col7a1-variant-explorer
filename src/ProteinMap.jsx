import React, { useEffect, useMemo, useRef, useState } from "react";
import { GROUPS, formatNumber as num, positionLabel } from "./data-utils.mjs";
import { densityBins, mapWindow, variantsInWindow, markerLayout, validMapRange, mapTicks, MAP_GROUPS, MARKER_LIMIT, regionEvidence } from "./map-data.mjs";
import ProteinSchematic from "./ProteinSchematic.jsx";
import "./protein-map.css";

const X = 42, WIDTH = 816, PLOT_TOP = 174;
const color = key => `var(--significance-${key}, ${GROUPS[key]?.color || GROUPS.other.color})`;
const legendLabels = { pathogenic: "Pathogenic / likely", uncertain: "VUS", conflicting: "Conflicting", benign: "Benign / likely", other: "Other" };
const significance = v => v.clinicalSignificance.join(" / ") || "Not reported";
const submitters = v => Array.isArray(v.numberSubmitters) && v.numberSubmitters.length
  ? `${v.numberSubmitters.join(" / ")} submitter${v.numberSubmitters.length === 1 && v.numberSubmitters[0] === 1 ? "" : "s"} (source)`
  : "Submitter count not reported";

function VariantPreview({ variant: v }) {
  return <div className="map-preview-variant">
    <strong className="mono">{v.codingHgvs.join(" / ") || `ClinVar ${v.variationId}`}</strong>
    <span className="mono">{v.proteinHgvs.join(" / ") || "Protein HGVS not reported"} · {positionLabel(v.proteinMapping)}</span>
    <span><i style={{ background: color(v.significanceGroup) }} />{significance(v)}</span>
    <span>{v.reviewStatus.join("; ") || "Review status not reported"}</span>
    <small>{submitters(v)} · ClinVar {v.variationId}</small>
  </div>;
}

export default function ProteinMap({ protein, variants, filters, onFilter, selected, onSelect }) {
  const range = useMemo(() => mapWindow(protein, filters), [protein, filters.domain, filters.range]);
  const [start, end] = range;
  const mapped = useMemo(() => variants.filter(v => v.proteinMapping.status === "mapped"), [variants]);
  const visible = useMemo(() => variantsInWindow(mapped, range), [mapped, range]);
  const { bins, binSize } = useMemo(() => densityBins(visible, range, 60), [visible, range]);
  const groupCounts = useMemo(() => Object.fromEntries(MAP_GROUPS.map(key => [key, bins.reduce((total, bin) => total + bin.counts[key], 0)])), [bins]);
  const layout = useMemo(() => visible.length <= MARKER_LIMIT ? markerLayout(visible, range, WIDTH) : null, [visible, range]);
  const markerMode = visible.length > 0 && layout && layout.lanes <= 9;
  const regionPreviews = useMemo(() => new Map(protein.domains.map(d => [d.id, regionEvidence(variants, d, 1)])), [variants, protein.domains]);
  const [modePreference, setModePreference] = useState("auto");
  const [showRange, setShowRange] = useState(false);
  const markersShown = markerMode && modePreference !== "density";
  const [hovered, setHovered] = useState(null);
  const [schematicHover, setSchematicHover] = useState(null);
  const mapRef = useRef(null);
  const evidenceRef = useRef(null);
  const restoreMapFocus = useRef(false);
  const hideTimer = useRef(null);
  const [focused, setFocused] = useState(0);
  const [rangeStart, setRangeStart] = useState(String(start));
  const [rangeEnd, setRangeEnd] = useState(String(end));
  const [rangeError, setRangeError] = useState("");
  const regions = protein.domains.filter(d => d.level !== "subdomain");
  const subdomains = protein.domains.filter(d => d.level === "subdomain");
  const selectedRegion = protein.domains.find(d => d.id === filters.domain);
  const ticks = mapTicks(range);
  const span = end - start + 1;
  const x = n => X + (n - start) / span * WIDTH;
  const centerX = n => x(n + .5);
  const max = Math.max(1, ...bins.map(bin => bin.total));
  const currentItems = markersShown ? layout.markers : bins;
  const focusedIndex = Math.min(focused, Math.max(0, currentItems.length - 1));
  const hoveredItem = hovered?.kind === "marker" ? layout?.markers[hovered.index] : hovered?.kind === "bin" ? bins[hovered.index] : hovered?.kind === "region" ? regionPreviews.get(hovered.id) : null;
  const zoomed = start !== 1 || end !== protein.length || Boolean(filters.domain || filters.range);
  const hoveredPosition = hovered?.kind === "marker" ? hoveredItem?.variant.proteinMapping : hoveredItem;
  const linkedPosition = schematicHover || hoveredPosition;
  const activeRange = linkedPosition ? [linkedPosition.start, linkedPosition.end] : zoomed ? range : null;
  const plotBottom = PLOT_TOP + (markersShown ? Math.max(100, layout.lanes * 17 + 14) : 96);
  const inLinkedRange = d => activeRange && d.start <= activeRange[1] && d.end >= activeRange[0];
  const tooltipDescription = hoveredItem ? "map-evidence-tooltip" : undefined;

  useEffect(() => {
    setRangeStart(String(start)); setRangeEnd(String(end)); setRangeError("");
    setHovered(null); setSchematicHover(null); setFocused(0);
    if (restoreMapFocus.current) {
      restoreMapFocus.current = false;
      mapRef.current?.querySelector('[data-marker="0"], [data-bin="0"]')?.focus();
    }
  }, [start, end, variants, markersShown]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => { if (evidenceRef.current) evidenceRef.current.scrollTop = 0; }, [hovered]);
  useEffect(() => {
    if (!hovered) return;
    const dismiss = event => {
      if (event.key === "Escape") {
        clearTimeout(hideTimer.current); setHovered(null);
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [hovered]);
  function reveal(item, event) {
    clearTimeout(hideTimer.current);
    setSchematicHover(null);
    setHovered({ ...item, keyboard: event?.type === "focus" });
  }
  function hideAfterPointerLeaves() {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(current =>
      current?.keyboard || evidenceRef.current?.contains(document.activeElement) ? current : null), 100);
  }
  function leaveMapTarget(event) {
    if (!event.relatedTarget?.closest?.(".map-evidence-slot")) setHovered(null);
  }
  function chooseDomain(domain) {
    onFilter("domain", filters.domain === domain.id ? "" : domain.id);
    setModePreference("auto");
  }
  function chooseBin(bin) {
    restoreMapFocus.current = document.activeElement?.hasAttribute("data-bin");
    onFilter("range", filters.range?.[0] === bin.start && filters.range?.[1] === bin.end ? null : [bin.start, bin.end]);
    setModePreference("auto");
  }
  function resetRegion() {
    onFilter("domain", ""); onFilter("range", null); setModePreference("auto");
  }
  function applyRange(event) {
    event.preventDefault();
    const next = validMapRange(rangeStart, rangeEnd, protein.length);
    if (!next) { setRangeError(`Enter a whole-number range from 1 to ${num(protein.length)}, with start ≤ end.`); return; }
    setRangeError(""); onFilter("domain", ""); onFilter("range", next); setModePreference("auto");
  }
  function navigate(event, index, kind, activate) {
    const offsets = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: currentItems.length - 1 - index };
    if (Object.hasOwn(offsets, event.key)) {
      event.preventDefault();
      const next = Math.max(0, Math.min(currentItems.length - 1, index + offsets[event.key]));
      event.currentTarget.closest("svg")?.querySelector(`[data-${kind}="${next}"]`)?.focus();
    } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
    else if (event.key === "Escape") { event.preventDefault(); setHovered(null); }
  }
  function showUnmapped() {
    resetRegion(); onFilter("mapping", filters.mapping === "unmapped" ? "" : "unmapped");
  }
  function regionInteraction(d) {
    return {
      role: "button", tabIndex: 0, "aria-pressed": filters.domain === d.id,
      "aria-label": `Filter ${d.label}, amino acids ${d.start} to ${d.end}`,
      "aria-describedby": hovered?.kind === "region" && hovered.id === d.id ? tooltipDescription : undefined,
      onMouseEnter: e => reveal({ kind: "region", id: d.id }, e),
      onFocus: e => reveal({ kind: "region", id: d.id }, e), onBlur: leaveMapTarget,
      onClick: () => chooseDomain(d),
      onKeyDown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chooseDomain(d); } },
    };
  }

  return <section className="panel protein-panel protein-workspace" aria-labelledby="protein-title">
    <div className="panel-heading">
      <div><p className="eyebrow">PROTEIN EXPLORER</p><h2 id="protein-title">Explore collagen VII</h2>
        <p className="map-introduction">Hover to connect a residue with the protein. Select a region to explore its variants.</p>
        <a className="map-reference-link" href="#protein-reference" onClick={() => { document.getElementById("source-methods").open = true; }}>{num(protein.length)} aa precursor · Primary paper & boundary comparison</a></div>
      <a href={protein.url} target="_blank" rel="noreferrer" className="text-link">UniProt Q02388 <span aria-hidden="true">↗</span></a>
    </div>
    <div className="protein-explorer-grid">
      <ProteinSchematic protein={protein} activeRange={activeRange} selectedDomain={filters.domain}
        onRegionHover={domain => { clearTimeout(hideTimer.current); setHovered(null); setSchematicHover(domain); }} onRegionSelect={chooseDomain} />
      <div className="residue-workspace" onMouseEnter={() => clearTimeout(hideTimer.current)} onMouseLeave={hideAfterPointerLeaves}>
        <div className="residue-heading"><div><h3>Residue map</h3><p>{selectedRegion?.label || (zoomed ? "Selected range" : "Full protein")} <span>· aa {num(start)}–{num(end)}</span></p></div>
          {zoomed && <button className="text-button" onClick={resetRegion}>Reset map region</button>}
        </div>
        <div className="map-tools">
          <div className="map-display-controls">
            <span className="map-display-note">{markersShown ? "Each marker is one variant" : "Stacked by clinical significance"}</span>
            {markerMode && <button className="text-button" aria-pressed={!markersShown} onClick={() => { setModePreference(markersShown ? "density" : "auto"); setHovered(null); }}>{markersShown ? "Show density" : "Show individual variants"}</button>}
          </div>
          <button className="text-button range-disclosure" aria-expanded={showRange} aria-controls="residue-range-controls" onClick={() => setShowRange(!showRange)}>Set residue range <span aria-hidden="true">{showRange ? "−" : "+"}</span></button>
        </div>
        <div id="residue-range-controls" hidden={!showRange}>
          <form className="map-range-form" onSubmit={applyRange} noValidate>
            <label><span>From residue</span><input aria-label="Range start (amino acid)" type="text" inputMode="numeric" value={rangeStart} onChange={e => setRangeStart(e.target.value)} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "map-range-error" : undefined} /></label>
            <label><span>To residue</span><input aria-label="Range end (amino acid)" type="text" inputMode="numeric" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "map-range-error" : undefined} /></label>
            <button className="button" type="submit">Apply residue range</button>
          </form>
          {rangeError && <p className="map-range-error" id="map-range-error" role="alert">{rangeError}</p>}
        </div>
        <div className="map-plot-container">
          <div className="map-scroll" role="region" aria-label="Protein distribution map; scroll horizontally to inspect all residues" tabIndex={0}>
            <svg ref={mapRef} className="protein-map" role="group" viewBox={`0 0 900 ${plotBottom + 34}`} aria-label="Interactive COL7A1 protein map" aria-describedby="map-instructions">
              <text x={X} y="15" className="svg-caption">Protein regions</text>
              {activeRange && activeRange[0] <= end && activeRange[1] >= start && <rect aria-hidden="true" data-linked-range={`${activeRange[0]}-${activeRange[1]}`} data-start={activeRange[0]} data-end={activeRange[1]} className="map-linked-highlight" x={x(Math.max(start, activeRange[0]))} y="112" width={Math.max(3, (Math.min(end, activeRange[1]) - Math.max(start, activeRange[0]) + 1) / span * WIDTH)} height="6" rx="2" />}
              {regions.filter(d => d.start <= end && d.end >= start).map(d => {
                const left = x(Math.max(start, d.start)), width = (Math.min(end, d.end) - Math.max(start, d.start) + 1) / span * WIDTH;
                return <g key={d.id} {...regionInteraction(d)} className={`domain-block ${inLinkedRange(d) ? "is-linked" : ""}`}>
                  <rect x={left} y="29" width={width} height="34" rx="4" className={`domain-${d.label.toLowerCase().replaceAll(" ", "-")} ${filters.domain === d.id ? "active-domain" : ""}`} />
                  {width > 35 && <text x={left + width / 2} y="51" textAnchor="middle" className="domain-label">{d.label}</text>}
                </g>;
              })}
              <text x={X} y="84" className="svg-caption">Subdomains</text>
              {subdomains.filter(d => d.start <= end && d.end >= start).map(d => <g key={d.id} {...regionInteraction(d)} className={`subdomain-block ${inLinkedRange(d) ? "is-linked" : ""}`}>
                <rect x={x(Math.max(start, d.start))} y="94" width={(Math.min(end, d.end) - Math.max(start, d.start) + 1) / span * WIDTH} height="15" rx="3" className={filters.domain === d.id ? "active-subdomain" : ""} />
              </g>)}
              {ticks.map(n => <g key={n} aria-hidden="true"><line x1={centerX(n)} x2={centerX(n)} y1="113" y2="118" className="map-count-grid" /><text x={centerX(n)} y="135" textAnchor={n === start ? "start" : n === end ? "end" : "middle"} className="axis-label">{num(n)}</text></g>)}
              <text x={X} y="161" className="svg-caption">{markersShown ? "Individual variants" : `Variant count · ${binSize} residue bins`}</text>
              <text x={X + WIDTH} y="161" textAnchor="end" className="svg-caption">{markersShown ? `${visible.length} variants` : "Select a bar to zoom"}</text>
              {!markersShown && [0, max].map(count => <g key={count} aria-hidden="true">
                <line x1={X} x2={X + WIDTH} y1={plotBottom - count / max * (plotBottom - PLOT_TOP)} y2={plotBottom - count / max * (plotBottom - PLOT_TOP)} className="map-count-grid" />
                <text x={X - 9} y={plotBottom - count / max * (plotBottom - PLOT_TOP) + 4} textAnchor="end" className="map-count-label">{count}</text>
              </g>)}
              {markersShown ? layout.markers.map((marker, index) => {
                const v = marker.variant, cy = plotBottom - 12 - marker.lane * 17, cx = X + marker.x;
                return <g key={v.variationId} role="button" tabIndex={focusedIndex === index ? 0 : -1} data-marker={index}
                  className={`map-variant-marker ${selected?.variationId === v.variationId ? "is-selected" : ""}`}
                  aria-label={`Open variant ${v.variationId}: ${v.proteinHgvs.join(" / ") || v.codingHgvs.join(" / ")}, ${significance(v)}`}
                  aria-describedby={hovered?.kind === "marker" && hovered.index === index ? tooltipDescription : undefined}
                  onMouseEnter={e => reveal({ kind: "marker", index }, e)}
                  onFocus={e => { reveal({ kind: "marker", index }, e); setFocused(index); }} onBlur={leaveMapTarget}
                  onClick={() => onSelect(v)} onKeyDown={e => navigate(e, index, "marker", () => onSelect(v))}>
                  <rect x={cx - 10} y={cy - 8} width={Math.max(20, marker.endX - marker.x + 20)} height="16" fill="transparent" />
                  {marker.endX > marker.x && <line x1={cx} x2={X + marker.endX} y1={cy} y2={cy} stroke={color(v.significanceGroup)} strokeWidth="3" />}
                  <circle cx={cx} cy={cy} r="5.5" fill={marker.clippedStart ? "var(--surface-raised)" : color(v.significanceGroup)} stroke={color(v.significanceGroup)} strokeWidth="1.5" />
                  {marker.clippedEnd && <path d={`M ${X + marker.endX - 4} ${cy - 4} l 5 4 l -5 4`} fill="none" stroke={color(v.significanceGroup)} strokeWidth="2" />}
                </g>;
              }) : bins.map((bin, index) => {
                let cumulative = 0;
                const barX = x(bin.start), barWidth = Math.max(1, (bin.end - bin.start + 1) / span * WIDTH - 3);
                return <g key={bin.start} role="button" tabIndex={focusedIndex === index ? 0 : -1} data-bin={index} className="histogram-bin"
                  aria-pressed={filters.range?.[0] === bin.start && filters.range?.[1] === bin.end}
                  aria-label={`Filter amino acids ${bin.start} to ${bin.end}, ${bin.total} variants${MAP_GROUPS.filter(key => bin.counts[key] > 0).map(key => `; ${GROUPS[key].label}: ${bin.counts[key]}`).join("")}`}
                  aria-describedby={hovered?.kind === "bin" && hovered.index === index ? tooltipDescription : undefined}
                  onClick={() => chooseBin(bin)} onKeyDown={e => navigate(e, index, "bin", () => chooseBin(bin))}
                  onMouseEnter={e => reveal({ kind: "bin", index }, e)}
                  onFocus={e => { reveal({ kind: "bin", index }, e); setFocused(index); }} onBlur={leaveMapTarget}>
                  <rect x={barX} y={PLOT_TOP} width={barWidth + 3} height={plotBottom - PLOT_TOP} fill="transparent" />
                  {MAP_GROUPS.map(key => {
                    const height = bin.counts[key] / max * (plotBottom - PLOT_TOP); cumulative += height;
                    return <rect key={key} data-density-group={key} x={barX} y={plotBottom - cumulative} width={barWidth} height={height} fill={color(key)} />;
                  })}
                  <rect className="density-outline" x={barX} y={plotBottom - bin.total / max * (plotBottom - PLOT_TOP)} width={barWidth} height={bin.total / max * (plotBottom - PLOT_TOP)} fill="none" />
                </g>;
              })}
              {!visible.length && <text x={X + WIDTH / 2} y={PLOT_TOP + 50} textAnchor="middle" className="map-empty-label">No mapped variants in these results</text>}
              <line x1={X} x2={X + WIDTH} y1={plotBottom} y2={plotBottom} className="map-baseline" />
            </svg>
          </div>
        </div>
        <div className="map-significance-legend" role="group" aria-label="Clinical significance of mapped variants in view">
          <p>Mapped variants in view</p>
          <ul>{MAP_GROUPS.map(key => <li key={key} data-map-significance={key} data-count={groupCounts[key]} aria-label={`${GROUPS[key].label}: ${num(groupCounts[key])} mapped variants`}>
            <i aria-hidden="true" style={{ background: color(key) }} /><span title={GROUPS[key].label}>{legendLabels[key]}</span><strong>{num(groupCounts[key])}</strong>
          </li>)}</ul>
        </div>
        <div className="map-context-line"><span className="map-context-dot" aria-hidden="true" />{linkedPosition ? <span>{schematicHover?.label || (hovered?.kind === "region" ? hoveredItem?.label : "Linked residues")} · aa {num(linkedPosition.start)}–{num(linkedPosition.end)}</span> : <span>Hover a region to highlight it in both views.</span>}</div>
        <div ref={evidenceRef} className="map-evidence-slot" role="region" aria-label="Map hover details" tabIndex={0}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null); }}>
          {hoveredItem ? <div className="map-evidence-tooltip" id="map-evidence-tooltip" role="tooltip">
            <div className="map-evidence-overview">
              <p className="eyebrow">{hovered.kind === "marker" ? "VARIANT EVIDENCE" : "REGION EVIDENCE"}</p>
              {hovered.kind === "marker" ? <><strong>{positionLabel(hoveredItem.variant.proteinMapping)}</strong>
                <p className="map-tooltip-note">Select the marker to open the full evidence.</p>
                {(hoveredItem.clippedStart || hoveredItem.clippedEnd) && <p className="map-tooltip-note">Reported interval extends beyond this view.</p>}</>
                : <><strong>{hovered.kind === "region" ? `${hoveredItem.label} · ` : ""}aa {num(hoveredItem.start)}–{num(hoveredItem.end)}</strong>
                  <p className="map-tooltip-note">{num(hoveredItem.total)} {hovered.kind === "region" ? "matching variants" : "variants counted"} · Select to focus</p>
                  {hovered.kind === "bin" && <dl className="map-count-breakdown" aria-label="Clinical significance counts">{MAP_GROUPS.filter(key => hoveredItem.counts[key] > 0).map(key => <div key={key}>
                    <dt><i aria-hidden="true" style={{ background: color(key) }} />{legendLabels[key]}</dt><dd>{num(hoveredItem.counts[key])}</dd>
                  </div>)}</dl>}
                  {hoveredItem.total > 1 && <p className="map-tooltip-note">Example 1 of {num(hoveredItem.total)} shown. Select the region for all records.</p>}
                </>}
            </div>
            {hovered.kind === "marker" ? <VariantPreview variant={hoveredItem.variant} /> : hoveredItem.samples.slice(0, 1).map(v => <VariantPreview key={v.variationId} variant={v} />)}
          </div> : <div className="map-evidence-empty"><strong>Inspect a region or variant</strong><span>Hover or use keyboard focus on the map. Evidence appears here, keeping nearby variants clear.</span></div>}
        </div>
        <div className="map-summary"><span><strong>{num(visible.length)}</strong> mapped variants <span className="muted">/ {num(variants.length)} results</span></span>
          <button className="text-button map-unmapped" onClick={showUnmapped} aria-label={filters.mapping === "unmapped" ? "Include mapped variants" : "Show unmapped variants"} aria-pressed={filters.mapping === "unmapped"}>{filters.mapping === "unmapped" ? "Include mapped variants" : `${num(variants.length - mapped.length)} without protein mapping`}</button>
        </div>
      </div>
    </div>
    <details className="map-reading-notes"><summary>How to read this map</summary><div>
      <p id="map-instructions">Each dot is one variant; horizontal lines show reported spans. Stacked bars show counts by clinical significance, with total height showing all variants in a bin. VUS means uncertain significance; pathogenic and benign groups each include their likely classifications. Density counts each variant once at its first reported residue, or the left edge when its interval crosses into view. Filters use interval overlap. Frameshifts show only their reported anchor. The short indicator beneath the subdomains marks the linked residues; evidence appears below the chart. Use left/right arrows, Home/End, and Enter to explore; Escape clears the hover details.</p>
      <p>Mapping uses explicit protein HGVS linked to Q02388-1 with endpoint residues checked against its sequence. Domain boundaries are 1-based, inclusive UniProt intervals. The sequence map includes the signal peptide; the rotating schematic shows a procollagen VII homotrimer with the signal peptide omitted and NC2 still intact. Domain overlap does not establish clinical effect.</p>
    </div></details>
    <details className="map-reading-notes"><summary>Why no amino-acid position?</summary><div>
      <p>DNA variants do not always have a direct amino-acid position. Intronic variants and variants in untranslated regions (UTRs) lie outside the protein-coding sequence. A splice variant may change the protein, but its exact effect can remain unknown without RNA or other supporting evidence. HGVS uses <code>p.?</code> when a protein consequence cannot be reliably predicted.</p>
      <p>Other records may lack a protein HGVS description or a verified match to this reference protein. This map uses explicit, sequence-checked protein annotations and does not infer amino-acid positions from DNA coordinates. Open a variant’s evidence to see its mapping reason.</p>
      <p><strong>Missing protein mapping does not mean benign.</strong> These records remain available in the table and through the “without protein mapping” filter. <a href="https://hgvs-nomenclature.org/stable/recommendations/uncertain/" target="_blank" rel="noreferrer">HGVS uncertain consequences ↗</a></p>
    </div></details>
  </section>;
}
