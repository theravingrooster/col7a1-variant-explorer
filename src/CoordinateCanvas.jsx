import React, { useEffect, useRef } from "react";
import { Parsers } from "3dmol/build/3Dmol.es6-min.js";
import { CHAIN_COLORS, SELECTED_RESIDUE_COLOR, confidenceColor, fragmentAtomDetails } from "./fragment-rendering.mjs";
import { backboneConnections, createCoordinateView, focusCoordinateView, panCoordinateView, projectCoordinates, rotateCoordinateView, zoomCoordinateView } from "./coordinate-projection.mjs";

/** CPU compatibility renderer of the same original coordinates. No WebGL needed. */
export default function CoordinateCanvas({ coordinateText, fragment, representation = "backbone", colorMode = "confidence", activeRange = null, onResidueHover, onResidueSelect, onReady, onError, onStatus }) {
  const hostRef = useRef(null), canvasRef = useRef(null), modelRef = useRef(null), viewRef = useRef(null), firstView = useRef(null);
  const frame = useRef(null), drag = useRef(null), pickCache = useRef([]), hoverKey = useRef("");
  const current = useRef(null), callbacks = useRef(null);
  current.current = { coordinateText, fragment, representation, colorMode, activeRange };
  callbacks.current = { onResidueHover, onResidueSelect, onReady, onError, onStatus };

  function clearHover() { hoverKey.current = ""; callbacks.current.onResidueHover?.(null); }
  function paint() {
    const host = hostRef.current, canvas = canvasRef.current, model = modelRef.current, state = current.current;
    if (!host || !canvas || !host.clientWidth || !host.clientHeight) return;
    const width = host.clientWidth, height = host.clientHeight, ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    const context = canvas.getContext("2d");
    if (!context) { callbacks.current.onError?.("This browser cannot create a coordinate drawing canvas."); return; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = getComputedStyle(host).getPropertyValue("--surface-raised").trim() || "#ffffff";
    context.fillRect(0, 0, width, height);
    if (!model || model.id !== state.fragment.id || model.text !== state.coordinateText || !viewRef.current) { pickCache.current = []; return; }
    const points = projectCoordinates(model.atoms, viewRef.current, width, height);
    const atomColor = index => state.colorMode === "chain" ? CHAIN_COLORS[state.fragment.chains.indexOf(model.atoms[index].chain) % CHAIN_COLORS.length] || "#999999" : confidenceColor(model.atoms[index].b);
    const lines = state.representation === "sticks" ? model.bonds : model.backbone;
    const ordered = lines.map(([a, b]) => ({ a, b, z: (points[a].z + points[b].z) / 2 })).sort((a, b) => a.z - b.z);
    context.lineCap = "round";
    context.lineWidth = state.representation === "sticks" ? 1.65 : 2.3;
    for (const { a, b } of ordered) {
      const p = points[a], q = points[b], mid = [(p.x + q.x) / 2, (p.y + q.y) / 2];
      context.beginPath(); context.strokeStyle = atomColor(a); context.moveTo(p.x, p.y); context.lineTo(...mid); context.stroke();
      context.beginPath(); context.strokeStyle = atomColor(b); context.moveTo(...mid); context.lineTo(q.x, q.y); context.stroke();
    }
    if (state.representation === "sticks") {
      points.map((point, index) => ({ ...point, index })).sort((a, b) => a.z - b.z).forEach(point => {
        context.fillStyle = atomColor(point.index); context.beginPath(); context.arc(point.x, point.y, 1.7, 0, Math.PI * 2); context.fill();
      });
    }
    const selected = state.activeRange;
    pickCache.current = model.alpha.map(index => ({ ...points[index], index }));
    if (selected) {
      for (const point of [...pickCache.current].sort((a, b) => a.z - b.z)) {
        const position = state.fragment.start + model.atoms[point.index].resi - 1;
        if (position < selected[0] || position > selected[1]) continue;
        context.fillStyle = SELECTED_RESIDUE_COLOR; context.beginPath(); context.arc(point.x, point.y, selected[1] - selected[0] < 12 ? 5 : 2.7, 0, Math.PI * 2); context.fill();
      }
    }
    host.dataset.view = [...viewRef.current.orientation, viewRef.current.zoom, ...viewRef.current.pan, ...viewRef.current.center].map(n => n.toFixed(3)).join(",");
    host.dataset.representation = state.representation === "surface" ? "backbone" : state.representation;
    host.dataset.colorMode = state.colorMode;
    host.dataset.highlightedRange = selected && selected[0] <= state.fragment.end && selected[1] >= state.fragment.start ? selected.join("-") : "";
  }
  function draw() { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(paint); }
  function moveView(next) { if (!next) return; viewRef.current = next; draw(); }
  function pick(event) {
    const model = modelRef.current, state = current.current;
    if (!model || model.id !== state.fragment.id || model.text !== state.coordinateText) return null;
    const bounds = hostRef.current.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const match = pickCache.current.filter(point => Math.hypot(point.x - x, point.y - y) <= 10).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || b.z - a.z)[0];
    return match ? fragmentAtomDetails(state.fragment, model.atoms[match.index]) : null;
  }

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    const resize = new ResizeObserver(draw); resize.observe(host);
    const theme = new MutationObserver(draw); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const wheel = event => { if (!viewRef.current) return; event.preventDefault(); moveView(zoomCoordinateView(viewRef.current, Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * .002))); };
    host.addEventListener("wheel", wheel, { passive: false });
    canvas.style.width = "100%"; canvas.style.height = "100%";
    return () => { cancelAnimationFrame(frame.current); resize.disconnect(); theme.disconnect(); host.removeEventListener("wheel", wheel); callbacks.current.onReady?.(null); clearHover(); modelRef.current = null; };
  }, []);

  useEffect(() => {
    modelRef.current = null; viewRef.current = null; pickCache.current = [];
    hostRef.current.dataset.fragmentId = ""; hostRef.current.dataset.atomCount = "0"; callbacks.current.onReady?.(null); clearHover(); draw();
    if (!coordinateText) return;
    try {
      const atoms = Parsers.cif(coordinateText, { doAssembly: false })[0];
      if (!Array.isArray(atoms) || atoms.length !== fragment.atomCount) throw new Error("The coordinate file does not match the verified atomic model.");
      const alpha = atoms.map((atom, index) => atom.atom === "CA" ? index : -1).filter(index => index >= 0);
      if (alpha.length !== fragment.length * fragment.chains.length || alpha.some(index => !fragmentAtomDetails(fragment, atoms[index]))) throw new Error("The model's residue numbering does not match the verified fragment.");
      const bonds = [];
      atoms.forEach((atom, index) => (atom.bonds || []).forEach(other => { if (Number.isInteger(other) && other > index && other < atoms.length) bonds.push([index, other]); }));
      modelRef.current = { id: fragment.id, text: coordinateText, atoms, alpha, bonds, backbone: backboneConnections(atoms) };
      firstView.current = createCoordinateView(atoms); viewRef.current = structuredClone(firstView.current);
      hostRef.current.dataset.fragmentId = fragment.id; hostRef.current.dataset.atomCount = String(atoms.length);
      callbacks.current.onReady?.({
        reset() { moveView(structuredClone(firstView.current)); },
        zoom(factor) { moveView(zoomCoordinateView(viewRef.current, factor)); },
        focus(range = current.current.activeRange) {
          if (!range) return;
          const selected = modelRef.current.atoms.filter(atom => { const position = current.current.fragment.start + atom.resi - 1; return position >= range[0] && position <= range[1]; });
          if (selected.length) moveView(focusCoordinateView(viewRef.current, selected));
        },
      });
      callbacks.current.onStatus?.("ready"); draw();
    } catch (error) { callbacks.current.onError?.(error.message); }
  }, [coordinateText, fragment.id]);
  useEffect(draw, [representation, colorMode, activeRange?.[0], activeRange?.[1]]);

  function pointerDown(event) {
    if (!viewRef.current || (event.button !== 0 && event.button !== 2)) return;
    drag.current = { id: event.pointerId, start: [event.clientX, event.clientY], last: [event.clientX, event.clientY], moved: false, pan: event.button === 2 || event.ctrlKey || event.metaKey };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Cancelled pointers need no capture. */ }
  }
  function pointerMove(event) {
    const gesture = drag.current;
    if (gesture && gesture.id === event.pointerId) {
      const dx = event.clientX - gesture.last[0], dy = event.clientY - gesture.last[1];
      gesture.last = [event.clientX, event.clientY];
      if (!gesture.moved && Math.hypot(event.clientX - gesture.start[0], event.clientY - gesture.start[1]) < 4) return;
      gesture.moved = true; clearHover();
      moveView(gesture.pan ? panCoordinateView(viewRef.current, dx, dy) : rotateCoordinateView(viewRef.current, dx, dy));
      return;
    }
    const details = pick(event), key = details ? `${details.chain}:${details.position}` : "";
    if (key !== hoverKey.current) { hoverKey.current = key; callbacks.current.onResidueHover?.(details); }
  }
  function pointerUp(event) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    drag.current = null;
    if (!gesture.moved && event.button === 0) { const details = pick(event); if (details) callbacks.current.onResidueSelect?.(details); }
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
  }
  function keyboard(event) {
    if (!viewRef.current || event.target !== event.currentTarget) return;
    const deltas = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
    if (deltas[event.key]) { event.preventDefault(); moveView(event.shiftKey ? panCoordinateView(viewRef.current, ...deltas[event.key]) : rotateCoordinateView(viewRef.current, ...deltas[event.key])); }
    else if (["+", "=", "-", "_"].includes(event.key)) { event.preventDefault(); moveView(zoomCoordinateView(viewRef.current, ["+", "="].includes(event.key) ? 1.2 : 1 / 1.2)); }
    else if (event.key === "Home") { event.preventDefault(); moveView(structuredClone(firstView.current)); }
  }
  return <div ref={hostRef} className="fragment-canvas" data-renderer="compatibility" role="group" tabIndex={0}
    aria-label={`Interactive AlphaFold fragment: ${fragment.label}, residues ${fragment.start} to ${fragment.end}. Arrow keys rotate, Shift and arrows pan, plus and minus zoom, Home resets.`}
    onKeyDown={keyboard} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
    onPointerCancel={() => { drag.current = null; clearHover(); }} onLostPointerCapture={() => { drag.current = null; }}
    onPointerLeave={clearHover} onContextMenu={event => event.preventDefault()}><canvas ref={canvasRef} aria-hidden="true" /></div>;
}
