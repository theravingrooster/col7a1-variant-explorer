import React, { useEffect, useMemo, useRef, useState } from "react";
import { intersectRange, linkedSchematicRange, schematicFrame, schematicRegions } from "./schematic-geometry.mjs";
import { createProteinView, rotateProteinView, zoomProteinView, panProteinView, VIEWBOX } from "./protein-view.mjs";
import { startRotationDrag, moveRotationDrag, endRotationDrag } from "./rotation-drag.mjs";
import "./protein-schematic.css";

const number = value => value.toLocaleString("en-US");

export default function ProteinSchematic({ protein, activeRange = null, selectedDomain = "", onRegionHover, onRegionSelect }) {
  const regions = useMemo(() => schematicRegions(protein), [protein]);
  const highlightRange = linkedSchematicRange(protein, activeRange, selectedDomain);
  const [running, setRunning] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [inView, setInView] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const rootRef = useRef(null), canvasRef = useRef(null), pathsRef = useRef(new Map());
  const viewRef = useRef(createProteinView()), rangeRef = useRef(null);
  const dragRef = useRef(null), cleanupDragRef = useRef(null), endGestureRef = useRef(null), suppressClickRef = useRef(false);
  rangeRef.current = highlightRange;
  const initialFrame = useMemo(() => schematicFrame(regions, createProteinView()), [regions]);
  const animate = running && !dragging && !pointerInside && !focusWithin && inView && documentVisible;
  const highlightedRegions = regions.filter(region => intersectRange(highlightRange, [region.start, region.end]));
  const signal = highlightRange && !highlightedRegions.length;

  function paint(view) {
    // Reuse projected, depth-ordered paths; pointer frames do not rerender the table.
    for (const path of schematicFrame(regions, view, rangeRef.current)) {
      const node = pathsRef.current.get(path.key);
      if (!node) continue;
      node.setAttribute("d", path.d);
      node.setAttribute("class", `schematic-strand depth-${path.depth}${path.highlighted ? " is-linked" : ""}`);
      node.parentNode?.appendChild(node);
    }
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.dataset.orientation = view.orientation.map(value => value.toFixed(6)).join(",");
      canvas.dataset.zoom = view.zoom.toFixed(3);
      canvas.dataset.pan = view.pan.map(value => value.toFixed(2)).join(",");
      canvas.style.setProperty("--protein-zoom", view.zoom);
    }
  }
  function applyView(view) {
    const oldZoom = viewRef.current.zoom;
    viewRef.current = view;
    paint(view);
    if (oldZoom !== view.zoom) setZoom(view.zoom);
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
      dragRef.current = null;
      endGestureRef.current = null;
      cleanupDragRef.current?.();
    };
  }, []);

  useEffect(() => { paint(viewRef.current); }, [regions, highlightRange?.[0], highlightRange?.[1]]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wheel = event => {
      event.preventDefault();
      if (dragRef.current) return;
      setRunning(false);
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      applyView(zoomProteinView(viewRef.current, Math.exp(-Math.max(-200, Math.min(200, pixels)) * .002)));
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [regions]);

  useEffect(() => {
    if (!animate) return;
    let frame, previous = 0;
    const tick = now => {
      if (!previous) previous = now;
      const elapsed = now - previous;
      if (elapsed >= 25) {
        applyView(rotateProteinView(viewRef.current, Math.min(elapsed, 80) * .015, 0));
        previous = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, regions]);

  function hoverRegion(region) {
    if (!dragRef.current?.dragging) onRegionHover?.(region);
  }
  function leaveRegion() { hoverRegion(null); }
  function manualView(view) { setRunning(false); applyView(view); }
  function resetView() { manualView(createProteinView()); }
  function keyboardView(event) {
    if (event.target !== event.currentTarget) return;
    const directions = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
    const delta = directions[event.key];
    if (delta) {
      event.preventDefault();
      manualView(event.shiftKey
        ? panProteinView(viewRef.current, ...delta, canvasRef.current.getBoundingClientRect())
        : rotateProteinView(viewRef.current, ...delta));
    } else if (["+", "=", "-", "_"].includes(event.key)) {
      event.preventDefault(); manualView(zoomProteinView(viewRef.current, ["+", "="].includes(event.key) ? 1.2 : 1 / 1.2));
    } else if (event.key === "Home") { event.preventDefault(); resetView(); }
  }

  function beginDrag(event) {
    if (dragRef.current) return;
    const canvas = event.currentTarget;
    const initial = startRotationDrag(event, viewRef.current, canvas.getBoundingClientRect());
    if (!initial) return;
    suppressClickRef.current = false;
    dragRef.current = initial;
    setRunning(false);
    setPointerInside(true);
    const move = pointer => {
      const previous = dragRef.current;
      if (!previous || pointer.pointerId !== previous.pointerId) return;
      const next = moveRotationDrag(previous, pointer);
      dragRef.current = next;
      if (!next.dragging) return;
      if (pointer.cancelable) pointer.preventDefault();
      if (!previous.dragging) {
        setDragging(true);
        onRegionHover?.(null);
        try { canvas.setPointerCapture(pointer.pointerId); } catch { /* Pointer may have been cancelled. */ }
      }
      applyView(next.view);
    };
    const finish = (pointer, cancelled = false) => {
      const result = endRotationDrag(dragRef.current, pointer, cancelled);
      if (!result) return;
      dragRef.current = null;
      endGestureRef.current = null;
      suppressClickRef.current = result.suppressClick;
      cleanupDragRef.current?.();
      cleanupDragRef.current = null;
      setDragging(false);
      if (result.dragged) applyView(result.view);
      const bounds = canvas.getBoundingClientRect();
      const inside = initial.pointerType !== "touch" && !cancelled && pointer && pointer.clientX >= bounds.left && pointer.clientX <= bounds.right && pointer.clientY >= bounds.top && pointer.clientY <= bounds.bottom;
      setPointerInside(Boolean(inside));
      if (!inside || result.suppressClick) onRegionHover?.(null);
    };
    const release = pointer => finish(pointer);
    const cancel = pointer => finish(pointer, true);
    const blur = () => finish(null, true);
    endGestureRef.current = finish;
    cleanupDragRef.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      try { if (canvas.hasPointerCapture?.(initial.pointerId)) canvas.releasePointerCapture(initial.pointerId); } catch { /* Already released. */ }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
  }
  function suppressDragClick(event) {
    if (suppressClickRef.current && event.detail > 0) {
      event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false;
    }
  }
  const focusedLabel = highlightedRegions.length === 1 ? highlightedRegions[0].label : "Selected interval";

  return <section ref={rootRef} className={`protein-schematic${highlightedRegions.length ? " has-highlight" : ""}${dragging ? " is-dragging" : ""}`} aria-label="Collagen VII schematic"
    data-rotating={animate ? "true" : "false"} data-dragging={dragging ? "true" : "false"} data-active-start={highlightRange?.[0] ?? ""} data-active-end={highlightRange?.[1] ?? ""}
    onFocusCapture={event => setFocusWithin(Boolean(event.target.closest(".schematic-region, .schematic-canvas")))}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setFocusWithin(false); leaveRegion(); } }}>
    <div className="schematic-heading"><span>THE WHOLE PROTEIN</span><span className="schematic-tag">Illustrative 3D schematic</span></div>
    <div className="schematic-viewer">
      <svg ref={canvasRef} viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} role="group" tabIndex="0" aria-label="Interactive 3D collagen VII schematic" aria-describedby="schematic-interaction-help schematic-keyboard-help" className="schematic-canvas"
        onKeyDown={keyboardView} onPointerDown={beginDrag} onClickCapture={suppressDragClick} onContextMenu={event => event.preventDefault()}
        onLostPointerCapture={event => { if (event.target === event.currentTarget) endGestureRef.current?.(event, true); }}
        onPointerEnter={event => { if (event.pointerType !== "touch") setPointerInside(true); }}
        onPointerMove={event => {
          if (event.pointerType === "touch" || dragRef.current?.dragging) return;
          const id = event.target.closest("[data-schematic-path-region]")?.dataset.schematicPathRegion;
          hoverRegion(regions.find(region => region.id === id) || null);
        }} onPointerLeave={() => { setPointerInside(false); leaveRegion(); }}>
        <title>Illustrative collagen VII homotrimer. Drag in any direction to rotate in three dimensions.</title>
        <g aria-hidden="true" className="schematic-strands">
          {initialFrame.map(path => {
            const region = regions.find(item => item.id === path.regionId);
            return <path key={path.key} ref={node => { if (node) pathsRef.current.set(path.key, node); else pathsRef.current.delete(path.key); }}
              d={path.d} data-schematic-highlight={path.highlighted ? "true" : "false"} data-schematic-path-region={path.regionId}
              className={`schematic-strand depth-${path.depth}${path.highlighted ? " is-linked" : ""}`}
              onClick={() => onRegionSelect?.(region)}><title>{`${region.label} · aa ${number(region.start)}–${number(region.end)}`}</title></path>;
          })}
        </g>
      </svg>
      <div className="schematic-view-tools" role="group" aria-label="Protein view controls">
        <button type="button" aria-label="Zoom out of protein" title="Zoom out" onClick={() => manualView(zoomProteinView(viewRef.current, 1 / 1.2))}>−</button>
        <output aria-label="Protein zoom">{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label="Zoom in on protein" title="Zoom in" onClick={() => manualView(zoomProteinView(viewRef.current, 1.2))}>+</button>
        <button type="button" className="schematic-reset" aria-label="Reset protein view" onClick={resetView}>Reset view</button>
      </div>
    </div>
    <p className="schematic-interaction-hint" id="schematic-interaction-help">Drag in any direction to rotate · scroll to zoom · right-drag or Ctrl-drag to pan.</p>
    <div className="schematic-region-list" role="group" aria-label="Select a protein region">
      {regions.map(region => <button key={region.id} type="button" aria-label={`Select ${region.label} on protein schematic`}
        aria-pressed={selectedDomain === region.id} data-schematic-region={region.id} data-active={intersectRange(highlightRange, [region.start, region.end]) ? "true" : "false"}
        className="schematic-region" onPointerEnter={event => { if (event.pointerType !== "touch") hoverRegion(region); }} onPointerLeave={leaveRegion}
        onFocus={() => hoverRegion(region)} onBlur={leaveRegion} onClick={() => onRegionSelect?.(region)}>
        <span>{region.label}</span><small>aa {number(region.start)}–{number(region.end)}</small>
      </button>)}
    </div>
    <div className="schematic-context" aria-live="off">
      {highlightRange ? <><strong>{signal ? "Signal peptide" : focusedLabel}</strong><span>aa {number(highlightRange[0])}–{number(highlightRange[1])}{signal ? " · precursor only; not shown" : " · linked to the residue map"}</span></>
        : <><strong>Three chains. One collagen VII molecule.</strong><span>Hover or click the protein or a region to connect with the map.</span></>}
    </div>
    <div className="schematic-controls">
      <button className="schematic-rotation-button" type="button" aria-label={running ? "Pause protein rotation" : "Start protein rotation"}
        onClick={() => setRunning(value => !value)}><span aria-hidden="true">{running ? "Ⅱ" : "↻"}</span>{running ? "Pause" : "Auto rotate"}</button>
      <details className="schematic-keyboard"><summary>Controls</summary><p id="schematic-keyboard-help">Drag with one finger to rotate on touchscreens. With the viewer focused: arrow keys rotate, Shift + arrows pan, + / − zoom, and Home resets the view. Click a region to filter.</p></details>
    </div>
    <p className="schematic-disclaimer">Schematic, not a resolved structure. Region shapes and lengths are not to scale.</p>
  </section>;
}
