import React, { useEffect, useMemo, useRef, useState } from "react";
import { intersectRange, linkedSchematicRange, schematicFrame, schematicRegions } from "./schematic-geometry.mjs";
import "./protein-schematic.css";

const number = value => value.toLocaleString("en-US");

export default function ProteinSchematic({ protein, activeRange = null, selectedDomain = "", onRegionHover, onRegionSelect }) {
  const regions = useMemo(() => schematicRegions(protein), [protein]);
  const linkedRange = linkedSchematicRange(protein, activeRange, selectedDomain);
  const [localRegion, setLocalRegion] = useState(null);
  const [running, setRunning] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [inView, setInView] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden);
  const rootRef = useRef(null), pathsRef = useRef(new Map()), sliderRef = useRef(null);
  const angleRef = useRef(24), rangeRef = useRef(null);
  const highlightRange = localRegion ? [localRegion.start, localRegion.end] : linkedRange;
  rangeRef.current = highlightRange;
  const initialFrame = useMemo(() => schematicFrame(regions, 24), [regions]);
  const animate = running && !pointerInside && !focusWithin && inView && documentVisible;
  const highlightedRegions = regions.filter(region => intersectRange(highlightRange, [region.start, region.end]));
  const signal = highlightRange && !highlightedRegions.length;

  function paint(angle) {
    for (const path of schematicFrame(regions, angle, rangeRef.current)) pathsRef.current.get(path.key)?.setAttribute("d", path.d);
    if (sliderRef.current) sliderRef.current.value = String(Math.round(angle));
  }

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => { if (query.matches) setRunning(false); };
    const onVisibilityChange = () => setDocumentVisible(!document.hidden);
    query.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => setInView(entries[0].isIntersecting));
    if (rootRef.current) observer?.observe(rootRef.current);
    return () => {
      query.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => { paint(angleRef.current); }, [regions, highlightRange?.[0], highlightRange?.[1]]);

  useEffect(() => {
    if (!animate) return;
    let frame, previous = 0;
    const tick = now => {
      if (!previous) previous = now;
      const elapsed = now - previous;
      if (elapsed >= 40) {
        angleRef.current = (angleRef.current + Math.min(elapsed, 80) * .012) % 360;
        paint(angleRef.current);
        previous = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, regions]);

  function hoverRegion(region) {
    setLocalRegion(region);
    onRegionHover?.(region);
  }
  function leaveRegion() { hoverRegion(null); }
  function rotateManually(event) {
    setRunning(false);
    angleRef.current = Number(event.target.value);
    paint(angleRef.current);
  }
  function selectRegion(region) { onRegionSelect?.(region); }
  const focusedLabel = localRegion?.label || (highlightedRegions.length === 1 ? highlightedRegions[0].label : "Selected interval");

  return <section ref={rootRef} className={`protein-schematic${highlightedRegions.length ? " has-highlight" : ""}`} aria-label="Collagen VII schematic"
    data-rotating={animate ? "true" : "false"} data-active-start={highlightRange?.[0] ?? ""} data-active-end={highlightRange?.[1] ?? ""}
    onFocusCapture={event => setFocusWithin(Boolean(event.target.closest(".schematic-region")))}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setFocusWithin(false); leaveRegion(); } }}>
    <div className="schematic-heading"><span>THE WHOLE PROTEIN</span><span className="schematic-tag">Illustrative</span></div>
    <svg viewBox="0 0 550 224" role="group" aria-label="Rotating illustrative collagen VII schematic" className="schematic-canvas"
      onMouseEnter={() => setPointerInside(true)} onMouseLeave={() => { setPointerInside(false); leaveRegion(); }}>
      <title>Illustrative collagen VII homotrimer with linked NC1, collagenous and NC2 regions</title>
      <ellipse cx="276" cy="170" rx="215" ry="8" className="schematic-shadow" />
      <line x1="42" x2="504" y1="178" y2="178" className="schematic-axis" />
      <text x="42" y="196" className="schematic-end-label">N</text><text x="499" y="196" className="schematic-end-label">C</text>
      <g aria-hidden="true" className="schematic-strands">
        {initialFrame.map(path => <path key={path.key} ref={node => { if (node) pathsRef.current.set(path.key, node); else pathsRef.current.delete(path.key); }}
          d={path.d} data-schematic-highlight={path.highlighted ? "true" : "false"} data-schematic-path-region={path.regionId}
          className={`schematic-strand depth-${path.depth}${path.highlighted ? " is-linked" : ""}`} />)}
      </g>
      {regions.map(region => {
        const active = Boolean(intersectRange(highlightRange, [region.start, region.end]));
        return <g key={region.id} role="button" tabIndex="0" aria-label={`Select ${region.label} on protein schematic`}
          aria-pressed={selectedDomain === region.id} data-schematic-region={region.id} data-active={active ? "true" : "false"}
          className="schematic-region" onMouseEnter={() => hoverRegion(region)} onMouseLeave={leaveRegion}
          onFocus={() => hoverRegion(region)} onBlur={leaveRegion} onClick={() => selectRegion(region)}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectRegion(region); } }}>
          <title>{`${region.label} · amino acids ${number(region.start)}–${number(region.end)} · select to filter`}</title>
          <rect x={region.from - 5} y="58" width={region.to - region.from + 10} height="115" rx="12" className="schematic-hit-area" />
          <text x={(region.from + region.to) / 2} y="36" textAnchor="middle" className="schematic-region-label">{region.label}</text>
          <line x1={(region.from + region.to) / 2} x2={(region.from + region.to) / 2} y1="44" y2="58" className="schematic-leader" />
        </g>;
      })}
    </svg>
    <div className="schematic-context" aria-live="off">
      {highlightRange ? <><strong>{signal ? "Signal peptide" : focusedLabel}</strong><span>aa {number(highlightRange[0])}–{number(highlightRange[1])}{signal ? " · precursor only; not shown" : " · linked to the residue map"}</span></>
        : <><strong>Three chains. One collagen VII molecule.</strong><span>Hover a region to connect this view to the map.</span></>}
    </div>
    <div className="schematic-controls">
      <button className="schematic-rotation-button" type="button" aria-label={running ? "Pause protein rotation" : "Start protein rotation"}
        onClick={() => setRunning(value => !value)}><span aria-hidden="true">{running ? "Ⅱ" : "↻"}</span>{running ? "Pause" : "Rotate"}</button>
      <label><span>Angle</span><input ref={sliderRef} type="range" min="0" max="360" step="1" defaultValue="24" aria-label="Protein rotation angle" onChange={rotateManually} /></label>
    </div>
    <p className="schematic-disclaimer">Schematic, not a resolved structure. Region shapes and lengths are not to scale.</p>
  </section>;
}
