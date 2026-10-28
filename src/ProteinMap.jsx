import React, { useEffect, useMemo, useRef, useState } from "react";
import { GROUPS, formatNumber as num, positionLabel } from "./data-utils.mjs";
import { densityBins, mapWindow, variantsInWindow, markerLayout, validMapRange, mapTicks, MARKER_LIMIT } from "./map-data.mjs";
import "./protein-map.css";

const X = 60, WIDTH = 1040, TOP = 56, BOTTOM = 274;
const color = key => `var(--significance-${key}, ${GROUPS[key]?.color || GROUPS.other.color})`;
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
  const { bins, binSize } = useMemo(() => densityBins(visible, range), [visible, range]);
  const layout = useMemo(() => visible.length <= MARKER_LIMIT ? markerLayout(visible, range, WIDTH) : null, [visible, range]);
  const markerMode = visible.length > 0 && layout && layout.lanes <= 13;
  const [modePreference, setModePreference] = useState("auto");
  const markersShown = markerMode && modePreference !== "density";
  const [hovered, setHovered] = useState(null);
  const mapRef = useRef(null);
  const restoreMapFocus = useRef(false);
  const hideTimer = useRef(null);
  const [focused, setFocused] = useState(0);
  const [rangeStart, setRangeStart] = useState(String(start));
  const [rangeEnd, setRangeEnd] = useState(String(end));
  const [rangeError, setRangeError] = useState("");
  const regions = protein.domains.filter(d => d.level !== "subdomain");
  const subdomains = protein.domains.filter(d => d.level === "subdomain");
  const ticks = mapTicks(range);
  const span = end - start + 1;
  const x = n => X + (n - start) / span * WIDTH;
  const centerX = n => x(n + .5);
  const max = Math.max(1, ...bins.map(bin => bin.total));
  const currentItems = markersShown ? layout.markers : bins;
  const focusedIndex = Math.min(focused, Math.max(0, currentItems.length - 1));
  const hoveredItem = hovered?.kind === "marker" ? layout?.markers[hovered.index] : hovered?.kind === "bin" ? bins[hovered.index] : null;
  const zoomed = start !== 1 || end !== protein.length || Boolean(filters.domain || filters.range);

  useEffect(() => {
    setRangeStart(String(start)); setRangeEnd(String(end)); setRangeError("");
    setHovered(null); setFocused(0);
    if (restoreMapFocus.current) {
      restoreMapFocus.current = false;
      mapRef.current?.querySelector('[data-marker="0"], [data-bin="0"]')?.focus();
    }
  }, [start, end, variants, markersShown]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (!hovered) return;
    const dismiss = event => {
      if (event.key === "Escape") {
        clearTimeout(hideTimer.current);
        setHovered(null);
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [hovered]);
  function reveal(item) {
    clearTimeout(hideTimer.current);
    setHovered(item);
  }
  function hideAfterPointerLeaves() {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(null), 120);
  }

  function chooseDomain(domain) {
    onFilter("range", null);
    onFilter("domain", filters.domain === domain.id ? "" : domain.id);
    if (filters.mapping === "unmapped") onFilter("mapping", "");
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
    if (!next) {
      setRangeError(`Enter a whole-number range from 1 to ${num(protein.length)}, with start ≤ end.`);
      return;
    }
    setRangeError(""); onFilter("domain", ""); onFilter("range", next);
    if (filters.mapping === "unmapped") onFilter("mapping", "");
    setModePreference("auto");
  }
  function navigate(event, index, kind, activate) {
    const offsets = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: currentItems.length - 1 - index };
    if (Object.hasOwn(offsets, event.key)) {
      event.preventDefault();
      const next = Math.max(0, Math.min(currentItems.length - 1, index + offsets[event.key]));
      event.currentTarget.closest("svg")?.querySelector(`[data-${kind}="${next}"]`)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); activate();
    } else if (event.key === "Escape") {
      event.preventDefault(); setHovered(null);
    }
  }
  function showUnmapped() {
    resetRegion(); onFilter("mapping", filters.mapping === "unmapped" ? "" : "unmapped");
  }
  const tooltipDescription = hoveredItem ? "map-evidence-tooltip" : undefined;

  return <section className="panel protein-panel protein-workspace" aria-labelledby="protein-title">
    <div className="panel-heading">
      <div><p className="eyebrow">START WITH THE PROTEIN</p><h2 id="protein-title">Explore collagen VII</h2>
        <p className="map-introduction">Select a domain or density bar to narrow the view. Inspect individual variants as you zoom in.</p></div>
      <a href={protein.url} target="_blank" rel="noreferrer" className="text-link">UniProt Q02388 <span aria-hidden="true">↗</span></a>
    </div>
    <div className="map-summary">
      <span><strong>{num(visible.length)}</strong> mapped variants in view <span className="muted">/ {num(variants.length)} current results</span></span>
      <span className="map-unmapped"><strong>{num(variants.length - mapped.length)}</strong> without protein mapping
        <button className="text-button" onClick={showUnmapped} aria-pressed={filters.mapping === "unmapped"}>{filters.mapping === "unmapped" ? "Include mapped variants" : "Show unmapped variants"}</button></span>
    </div>
    <div className="map-region-guide" aria-label="Protein region filters">
      {regions.map(d => <button key={d.id} aria-pressed={filters.domain === d.id} onClick={() => chooseDomain(d)}>
        {d.label}<span>aa {num(d.start)}–{num(d.end)}</span>
      </button>)}
      {zoomed && <button className="map-reset" onClick={resetRegion}>Reset map region</button>}
    </div>
    <div className="map-tools">
      <form className="map-range-form" onSubmit={applyRange} noValidate>
        <span className="map-tool-label">Residue range</span>
        <label><span className="sr-only">Range start (amino acid)</span><input type="text" inputMode="numeric" value={rangeStart} onChange={e => setRangeStart(e.target.value)} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "map-range-error" : undefined} /></label>
        <span aria-hidden="true">–</span>
        <label><span className="sr-only">Range end (amino acid)</span><input type="text" inputMode="numeric" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "map-range-error" : undefined} /></label>
        <button className="button" type="submit">Apply residue range</button>
      </form>
      <div className="map-display-controls"><span className="mono">aa {num(start)}–{num(end)}</span>
        {markerMode && <button className="button" aria-pressed={!markersShown} onClick={() => { setModePreference(markersShown ? "density" : "auto"); setHovered(null); }}>{markersShown ? "Show density" : "Show individual variants"}</button>}
      </div>
    </div>
    {rangeError && <p className="map-range-error" id="map-range-error" role="alert">{rangeError}</p>}
    <div className="map-plot-container">
      <div className="map-scroll" role="region" aria-label="Protein distribution map; scroll horizontally to inspect all residues" tabIndex={0}>
        <svg ref={mapRef} className="protein-map" role="group" viewBox="0 0 1140 442" aria-label="Interactive COL7A1 protein map" aria-describedby="map-instructions">
          <text x={X} y="25" className="svg-caption">{markersShown ? "INDIVIDUAL VARIANTS · SELECT A MARKER FOR EVIDENCE" : `VARIANTS PER ${binSize} RESIDUE${binSize === 1 ? "" : "S"}`}</text>
          <text x={X + WIDTH} y="25" textAnchor="end" className="svg-caption">{markersShown ? `${visible.length} VARIANTS` : `CURRENT MAX ${Math.max(0, ...bins.map(b => b.total))}`}</text>
          {ticks.map(n => <line key={n} x1={centerX(n)} x2={centerX(n)} y1={TOP} y2="398" className="grid-line" />)}
          {!markersShown && [...new Set([0, Math.ceil(max / 2), max])].map(count => <g key={count} aria-hidden="true">
            <line x1={X} x2={X + WIDTH} y1={BOTTOM - count / max * (BOTTOM - TOP)} y2={BOTTOM - count / max * (BOTTOM - TOP)} className="map-count-grid" />
            <text x={X - 12} y={BOTTOM - count / max * (BOTTOM - TOP) + 4} textAnchor="end" className="map-count-label">{count}</text>
          </g>)}
          {markersShown ? layout.markers.map((marker, index) => {
            const v = marker.variant;
            const cy = BOTTOM - 15 - marker.lane * 16;
            const cx = X + marker.x;
            return <g key={v.variationId} role="button" tabIndex={focusedIndex === index ? 0 : -1} data-marker={index}
              className={`map-variant-marker ${selected?.variationId === v.variationId ? "is-selected" : ""}`}
              aria-label={`Open variant ${v.variationId}: ${v.proteinHgvs.join(" / ") || v.codingHgvs.join(" / ")}, ${significance(v)}`}
              aria-describedby={hovered?.kind === "marker" && hovered.index === index ? tooltipDescription : undefined}
              onMouseEnter={() => reveal({kind:"marker",index})} onMouseLeave={hideAfterPointerLeaves}
              onFocus={() => { reveal({kind:"marker",index}); setFocused(index); }} onBlur={() => setHovered(null)}
              onClick={() => onSelect(v)} onKeyDown={e => navigate(e,index,"marker",() => onSelect(v))}>
              <title>{`${v.codingHgvs.join(" / ")} · ${v.proteinHgvs.join(" / ")} · ${significance(v)} · ${v.reviewStatus.join("; ")} · ${submitters(v)}`}</title>
              <rect x={cx - 9} y={cy - 8} width={Math.max(18, marker.endX - marker.x + 18)} height="16" fill="transparent" />
              {marker.endX > marker.x && <line x1={cx} x2={X + marker.endX} y1={cy} y2={cy} stroke={color(v.significanceGroup)} strokeWidth="3" />}
              <circle cx={cx} cy={cy} r="5.5" fill={marker.clippedStart ? "var(--surface-raised)" : color(v.significanceGroup)} stroke={color(v.significanceGroup)} strokeWidth="2" />
              {marker.clippedEnd && <path d={`M ${X + marker.endX - 4} ${cy - 4} l 5 4 l -5 4`} fill="none" stroke={color(v.significanceGroup)} strokeWidth="2" />}
            </g>;
          }) : bins.map((bin, index) => {
            let cumulative = 0;
            return <g key={bin.start} role="button" tabIndex={focusedIndex === index ? 0 : -1} data-bin={index} className="histogram-bin"
              aria-pressed={filters.range?.[0] === bin.start && filters.range?.[1] === bin.end}
              aria-label={`Filter amino acids ${bin.start} to ${bin.end}, ${bin.total} variants`}
              aria-describedby={hovered?.kind === "bin" && hovered.index === index ? tooltipDescription : undefined}
              onClick={() => chooseBin(bin)} onKeyDown={e => navigate(e,index,"bin",() => chooseBin(bin))}
              onMouseEnter={() => reveal({kind:"bin",index})} onMouseLeave={hideAfterPointerLeaves}
              onFocus={() => {reveal({kind:"bin",index});setFocused(index);}} onBlur={() => setHovered(null)}>
              <title>{`aa ${bin.start}–${bin.end}: ${bin.total} variants; select to zoom and filter`}</title>
              <rect x={x(bin.start)} y={TOP} width={(bin.end - bin.start + 1) / span * WIDTH} height={BOTTOM - TOP} fill="transparent" />
              {Object.keys(GROUPS).map(key => {
                const height = bin.counts[key] / max * (BOTTOM - TOP); cumulative += height;
                return <rect key={key} x={x(bin.start)} y={BOTTOM - cumulative} width={Math.max(1,(bin.end - bin.start + 1) / span * WIDTH - 2)} height={height} fill={color(key)} />;
              })}
            </g>;
          })}
          {!visible.length && <text x={X + WIDTH / 2} y="166" textAnchor="middle" className="map-empty-label">No mapped variants in the current results</text>}
          <line x1={X} x2={X + WIDTH} y1={BOTTOM} y2={BOTTOM} className="map-baseline" />
          <text x={X} y="298" className="svg-caption">PROTEIN REGIONS · SELECT TO FILTER AND ZOOM</text>
          {regions.filter(d => d.start <= end && d.end >= start).map(d => {
            const left = x(Math.max(start,d.start)), width = (Math.min(end,d.end) - Math.max(start,d.start) + 1) / span * WIDTH;
            return <g key={d.id} role="button" tabIndex="0" aria-pressed={filters.domain === d.id} aria-label={`Filter ${d.label}, amino acids ${d.start} to ${d.end}`} className="domain-block"
              onClick={() => chooseDomain(d)} onKeyDown={e => {if(e.key === "Enter" || e.key === " "){e.preventDefault();chooseDomain(d);}}}>
              <title>{`${d.label} · aa ${d.start}–${d.end} · ${d.description || ""}`}</title>
              <rect x={left} y="310" width={width} height="38" rx="3" className={`domain-${d.label.toLowerCase().replaceAll(" ","-")} ${filters.domain === d.id ? "active-domain" : ""}`} />
              {width > 45 && <text x={left + width / 2} y="334" textAnchor="middle" className="domain-label">{d.label}</text>}
            </g>;
          })}
          <text x={X} y="370" className="svg-caption">ANNOTATED SUBDOMAINS</text>
          {subdomains.filter(d => d.start <= end && d.end >= start).map(d => <g key={d.id} role="button" tabIndex="0" aria-pressed={filters.domain === d.id} aria-label={`Filter ${d.label}, amino acids ${d.start} to ${d.end}`} className="subdomain-block"
            onClick={() => chooseDomain(d)} onKeyDown={e => {if(e.key === "Enter" || e.key === " "){e.preventDefault();chooseDomain(d);}}}>
            <title>{`${d.label} · aa ${d.start}–${d.end}`}</title>
            <rect x={x(Math.max(start,d.start))} y="381" width={(Math.min(end,d.end) - Math.max(start,d.start) + 1) / span * WIDTH} height="17" rx="2" className={filters.domain === d.id ? "active-subdomain" : ""} />
          </g>)}
          {ticks.map(n => <text key={n} x={centerX(n)} y="422" textAnchor={n === start ? "start" : n === end ? "end" : "middle"} className="axis-label">{num(n)}</text>)}
        </svg>
      </div>
      {hoveredItem && <div className={`map-evidence-tooltip ${hovered.kind === "marker" ? hoveredItem.x > WIDTH / 2 ? "tooltip-left" : "" : hoveredItem.start > start + span / 2 ? "tooltip-left" : ""}`} id="map-evidence-tooltip" role="tooltip" onMouseEnter={() => clearTimeout(hideTimer.current)} onMouseLeave={hideAfterPointerLeaves}>
        {hovered.kind === "marker" ? <><p className="eyebrow">VARIANT EVIDENCE · SELECT TO OPEN</p><VariantPreview variant={hoveredItem.variant} />
          {(hoveredItem.clippedStart || hoveredItem.clippedEnd) && <p className="map-tooltip-note">The reported interval extends beyond this view. Its full position is shown above.</p>}</>
          : <><strong>aa {num(hoveredItem.start)}–{num(hoveredItem.end)} · {num(hoveredItem.total)} variants</strong>
            <p className="map-tooltip-note">{hoveredItem.total ? `Showing ${hoveredItem.samples.length} of ${hoveredItem.total}; select this bar to zoom and filter.` : "No variants are counted in this bin."}</p>
            {hoveredItem.samples.map(v => <VariantPreview key={v.variationId} variant={v} />)}</>}
      </div>}
    </div>
    <div className="map-footer"><div className="legend">{Object.entries(GROUPS).map(([key,g]) => <span key={key}><i style={{background:color(key)}} />{g.label}</span>)}</div></div>
    <p className="map-note" id="map-instructions">
      {markersShown ? "Each marker is one variant; horizontal lines show reported spans. Hollow markers start before the visible range. " : "Density counts each variant once at its first reported residue (or the left edge when its interval crosses into this view). "}
      Filters use interval overlap. Frameshifts show only their reported anchor. Use left/right arrows, Home/End, and Enter to explore; Escape dismisses the tooltip.
    </p>
    <p className="map-provenance"><strong>Mapping:</strong> explicit protein HGVS with a RefSeq accession linked to UniProt Q02388-1; endpoint residues checked against its sequence. Domains use 1-based, inclusive UniProt intervals, including the signal peptide. Domain overlap does not establish clinical effect.</p>
  </section>;
}
