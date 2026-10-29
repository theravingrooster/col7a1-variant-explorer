import React, { useEffect, useRef, useState } from "react";
import { createViewer, setSyncSurface, SurfaceType } from "3dmol/build/3Dmol.es6-min.js";
import { CHAIN_COLORS, SELECTED_RESIDUE_COLOR, confidenceColor, fragmentAtomDetails, fragmentSelection } from "./fragment-rendering.mjs";
import CoordinateCanvas from "./CoordinateCanvas.jsx";

// Surfaces are generated locally, only on request; no worker/blob CSP exception.
setSyncSurface(true);

function managedViewer(element, canvas) {
  // 3Dmol 2.5.5 has no disposal API. Retain its three global listener references
  // during the synchronous constructor so unmount can remove them. The native
  // methods are restored before any React callbacks or asynchronous work run.
  const listeners = [], restorers = [];
  for (const target of [document.body, window]) {
    const own = Object.getOwnPropertyDescriptor(target, "addEventListener");
    const add = target.addEventListener;
    target.addEventListener = function (type, handler, options) {
      listeners.push([target, type, handler, options]);
      return add.call(target, type, handler, options);
    };
    restorers.push(() => own ? Object.defineProperty(target, "addEventListener", own) : delete target.addEventListener);
  }
  let viewer;
  const detach = () => listeners.forEach(([target, type, handler, options]) => target.removeEventListener(type, handler, options));
  try {
    // A one-cell viewport keeps 3Dmol on this tested canvas. Its shared offscreen
    // path expects a bitmaprenderer canvas, which cannot reuse a WebGL context.
    viewer = createViewer(element, { canvas, row: 0, col: 0, rows: 1, cols: 1, antialias: true, backgroundAlpha: 0, orthographic: true });
  } catch (error) {
    detach();
    throw error;
  } finally {
    restorers.forEach(restore => restore());
  }
  return { viewer, dispose() {
    detach();
    viewer.setViewChangeCallback(null);
    viewer.stopAnimate();
    viewer.spin(false);
    clearTimeout(viewer.hoverTimeout);
    clearTimeout(viewer.longTouchTimeout);
    // These observer fields are pinned-version adapter details, not app state.
    viewer.divwatcher?.disconnect();
    viewer.intwatcher?.disconnect();
    try { viewer.clear(); } catch { /* A lost context may already have released GPU geometry. */ }
    finally { element.replaceChildren(); }
  } };
}

function WebGLCanvas({ suppliedCanvas, onWebGLUnavailable, coordinateText, fragment, representation = "backbone", colorMode = "confidence", activeRange = null, onResidueHover, onResidueSelect, onReady, onError, onStatus }) {
  const hostRef = useRef(null), engineRef = useRef(null), managedRef = useRef(null);
  const current = useRef(null), callbacks = useRef(null), loadedRef = useRef(null), firstView = useRef(null), defaultView = useRef(null);
  const frameRef = useRef(null), surfaceRevision = useRef(0), styleKey = useRef("");
  current.current = { coordinateText, fragment, representation, colorMode, activeRange };
  callbacks.current = { onResidueHover, onResidueSelect, onReady, onError, onStatus, onWebGLUnavailable };

  function notifyError(error) {
    callbacks.current.onStatus?.("error");
    callbacks.current.onError?.(error instanceof Error ? error.message : String(error));
  }
  function renderStyle() {
    const viewer = engineRef.current, state = current.current;
    if (!viewer || !loadedRef.current || loadedRef.current.fragment.id !== state.fragment.id || loadedRef.current.text !== state.coordinateText) return;
    const key = `${state.fragment.id}:${state.representation}:${state.colorMode}`;
    const changed = key !== styleKey.current;
    const atomColor = state.colorMode === "chain"
      ? atom => CHAIN_COLORS[state.fragment.chains.indexOf(atom.chain) % CHAIN_COLORS.length] || "#9a9a9a"
      : atom => confidenceColor(atom.b);
    const backbone = { cartoon: { colorfunc: atomColor, thickness: .22, width: 1.1, arrows: true } };
    viewer.setStyle({}, state.representation === "sticks" ? { stick: { colorfunc: atomColor, radius: .12 } } : backbone);
    // Invisible C-alpha pick spheres make thin backbones easy to inspect.
    viewer.addStyle({ atom: "CA" }, { clicksphere: { radius: 1.15 } });
    const selection = fragmentSelection(state.fragment, state.activeRange);
    if (selection) {
      const size = Math.min(state.fragment.end, state.activeRange[1]) - Math.max(state.fragment.start, state.activeRange[0]) + 1;
      if (size <= 12) viewer.addStyle(selection, { stick: { radius: .18, color: SELECTED_RESIDUE_COLOR } });
      viewer.addStyle({ ...selection, atom: "CA" }, { sphere: { radius: size <= 12 ? .48 : .28, color: SELECTED_RESIDUE_COLOR } });
    }
    if (changed) {
      styleKey.current = key;
      const revision = ++surfaceRevision.current;
      viewer.removeAllSurfaces();
      if (state.representation === "surface") {
        callbacks.current.onStatus?.("surface");
        Promise.resolve(viewer.addSurface(SurfaceType.VDW, { opacity: .65, colorfunc: atomColor }, {}))
          .then(() => {
            if (engineRef.current === viewer && revision === surfaceRevision.current) {
              viewer.render(); callbacks.current.onStatus?.("ready");
            }
          }).catch(error => { if (engineRef.current === viewer && revision === surfaceRevision.current) notifyError(error); });
      } else callbacks.current.onStatus?.("ready");
    }
    hostRef.current.dataset.representation = state.representation;
    hostRef.current.dataset.colorMode = state.colorMode;
    hostRef.current.dataset.highlightedRange = selection ? state.activeRange.join("-") : "";
    viewer.render();
  }
  function queueStyle() {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => { try { renderStyle(); } catch (error) { notifyError(error); } });
  }
  function loadModel() {
    const viewer = engineRef.current, state = current.current;
    if (!viewer) return;
    if (loadedRef.current?.text === state.coordinateText && loadedRef.current?.fragment.id === state.fragment?.id) return;
    ++surfaceRevision.current;
    viewer.clear();
    loadedRef.current = null;
    firstView.current = null;
    hostRef.current.dataset.fragmentId = "";
    hostRef.current.dataset.atomCount = "0";
    callbacks.current.onReady?.(null);
    callbacks.current.onResidueHover?.(null);
    styleKey.current = "";
    if (!state.coordinateText || !state.fragment) return;
    const model = viewer.addModel(state.coordinateText, "cif", { doAssembly: false, normalizeAssembly: false });
    const atoms = model.selectedAtoms({ atom: "CA" });
    if (atoms.length !== state.fragment.length * state.fragment.chains.length || atoms.some(atom => !fragmentAtomDetails(state.fragment, atom))) {
      viewer.clear(); throw new Error("The model's residue numbering does not match the verified fragment.");
    }
    loadedRef.current = { text: state.coordinateText, fragment: state.fragment };
    viewer.setHoverDuration(80);
    const details = atom => {
      const loaded = loadedRef.current;
      return loaded && loaded.fragment.id === current.current.fragment.id && loaded.text === current.current.coordinateText
        ? fragmentAtomDetails(loaded.fragment, atom) : null;
    };
    viewer.setHoverable({ atom: "CA" }, true, atom => callbacks.current.onResidueHover?.(details(atom)), () => callbacks.current.onResidueHover?.(null));
    viewer.setClickable({ atom: "CA" }, true, atom => { const residue = details(atom); if (residue) callbacks.current.onResidueSelect?.(residue); });
    renderStyle();
    if (defaultView.current) viewer.setView(defaultView.current.slice());
    viewer.zoomTo();
    // Choose an initial horizontal view for extended fragments; no atom moves.
    const spans = ["x", "y", "z"].map(axis => Math.max(...atoms.map(a => a[axis])) - Math.min(...atoms.map(a => a[axis])));
    if (spans[1] > spans[0] * 1.5 && spans[1] > spans[2]) viewer.rotate(90, "z");
    else if (spans[2] > spans[0] * 1.5 && spans[2] > spans[1]) viewer.rotate(90, "y");
    viewer.render();
    firstView.current = viewer.getView().slice();
    hostRef.current.dataset.fragmentId = state.fragment.id;
    hostRef.current.dataset.atomCount = String(model.selectedAtoms({}).length);
    callbacks.current.onResidueHover?.(null);
    callbacks.current.onReady?.({
      reset() { if (firstView.current) viewer.setView(firstView.current.slice()); },
      zoom(factor) { viewer.zoom(factor); viewer.render(); },
      focus(range = current.current.activeRange) {
        if (!loadedRef.current || loadedRef.current.fragment.id !== current.current.fragment.id) return;
        const selection = fragmentSelection(current.current.fragment, range);
        if (selection) { viewer.zoomTo(selection); viewer.render(); }
      },
    });
  }
  useEffect(() => {
    const host = hostRef.current;
    let alive = true, failedInitialization = false;
    function initializeOrResize() {
      if (!alive || failedInitialization || !host.clientWidth || !host.clientHeight) return;
      try {
        if (!engineRef.current) {
          try { managedRef.current = managedViewer(host, suppliedCanvas); }
          catch {
            failedInitialization = true;
            host.replaceChildren();
            callbacks.current.onWebGLUnavailable?.();
            return;
          }
          engineRef.current = managedRef.current.viewer;
          defaultView.current = engineRef.current.getView().slice();
          engineRef.current.setViewChangeCallback(() => {
            host.dataset.view = engineRef.current?.getView().map(n => Number(n).toFixed(3)).join(",") || "";
          });
          loadModel();
        } else engineRef.current.resize();
        theme();
      } catch (error) { notifyError(error); }
    }
    function theme() {
      if (!engineRef.current) return;
      const background = getComputedStyle(host).getPropertyValue("--surface-raised").trim() || "#ffffff";
      engineRef.current.setBackgroundColor(background, 1);
    }
    const resize = new ResizeObserver(initializeOrResize);
    resize.observe(host);
    const themeObserver = new MutationObserver(theme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    initializeOrResize();
    return () => {
      alive = false; ++surfaceRevision.current;
      cancelAnimationFrame(frameRef.current);
      resize.disconnect(); themeObserver.disconnect();
      callbacks.current.onReady?.(null);
      callbacks.current.onResidueHover?.(null);
      managedRef.current?.dispose();
      managedRef.current = null; engineRef.current = null; loadedRef.current = null;
    };
  }, []);
  useEffect(() => { try { loadModel(); } catch (error) { notifyError(error); } }, [coordinateText, fragment.id]);
  useEffect(queueStyle, [representation, colorMode, activeRange?.[0], activeRange?.[1]]);

  function keyboard(event) {
    const viewer = engineRef.current;
    if (!viewer || event.target !== event.currentTarget) return;
    const rotations = { ArrowLeft: [-12, "y"], ArrowRight: [12, "y"], ArrowUp: [-12, "x"], ArrowDown: [12, "x"] };
    if (rotations[event.key]) {
      event.preventDefault();
      if (event.shiftKey) viewer.translate(event.key === "ArrowLeft" ? -12 : event.key === "ArrowRight" ? 12 : 0, event.key === "ArrowUp" ? -12 : event.key === "ArrowDown" ? 12 : 0);
      else viewer.rotate(...rotations[event.key]);
    } else if (["+", "=", "-", "_"].includes(event.key)) {
      event.preventDefault(); viewer.zoom(["+", "="].includes(event.key) ? 1.2 : 1 / 1.2);
    } else if (event.key === "Home") {
      event.preventDefault(); if (firstView.current) viewer.setView(firstView.current.slice());
    } else return;
    viewer.render();
  }
  function leavePointer() {
    const viewer = engineRef.current;
    if (viewer) {
      // Cancel the library's delayed pick and allow the same residue to be
      // announced when the pointer re-enters after leaving the viewer.
      clearTimeout(viewer.hoverTimeout);
      viewer.current_hover = null;
    }
    callbacks.current.onResidueHover?.(null);
  }
  return <div ref={hostRef} className="fragment-canvas" role="group" tabIndex={0}
    data-renderer="webgl"
    aria-label={`Interactive AlphaFold fragment: ${fragment.label}, residues ${fragment.start} to ${fragment.end}. Arrow keys rotate, Shift and arrows pan, plus and minus zoom, Home resets.`}
    onKeyDown={keyboard} onPointerLeave={leavePointer} />;
}

export default function FragmentCanvas(props) {
  const [renderer, setRenderer] = useState(null);
  const rendererChange = useRef(props.onRendererChange);
  rendererChange.current = props.onRendererChange;

  useEffect(() => {
    const canvas = document.createElement("canvas");
    let context = null;
    try {
      // Reuse this very canvas in 3Dmol; probing never consumes a second context.
      const options = { alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false };
      context = canvas.getContext("webgl2", options) || canvas.getContext("webgl", options) || canvas.getContext("experimental-webgl", options);
    } catch { /* Some browsers disable WebGL even though Canvas2D is available. */ }
    if (!context || context.isContextLost()) {
      setRenderer({ mode: "compatibility" });
      return;
    }
    function contextLost(event) {
      // Stop 3Dmol's automatic context retry. The coordinate fallback remains
      // interactive without depending on GPU availability or browser settings.
      event.preventDefault();
      event.stopImmediatePropagation();
      setRenderer({ mode: "compatibility" });
    }
    canvas.addEventListener("webglcontextlost", contextLost, true);
    setRenderer({ mode: "webgl", canvas });
    return () => canvas.removeEventListener("webglcontextlost", contextLost, true);
  }, []);
  useEffect(() => { if (renderer) rendererChange.current?.(renderer.mode); }, [renderer?.mode]);

  if (!renderer) return <p className="fragment-loading" role="status">Preparing coordinate viewer…</p>;
  if (renderer.mode === "compatibility") return <CoordinateCanvas {...props} representation={props.representation === "surface" ? "backbone" : props.representation} />;
  return <WebGLCanvas {...props} suppliedCanvas={renderer.canvas} onWebGLUnavailable={() => setRenderer({ mode: "compatibility" })} />;
}
