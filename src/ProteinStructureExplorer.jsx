import React, { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import ProteinSchematic from "./ProteinSchematic.jsx";
import manifest from "../public/data/structures/manifest.json";
import { fragmentOverlap } from "./structure-data.mjs";
import { CHAIN_COLORS, SELECTED_RESIDUE_COLOR } from "./fragment-rendering.mjs";
import "./protein-structures.css";

const FragmentCanvas = lazy(() => import("./FragmentCanvas.jsx"));
const coordinates = new Map();
const number = value => value.toLocaleString("en-US");
const score = value => Number.isFinite(value) ? value.toFixed(2) : "Not applicable";

class CanvasBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p className="fragment-error" role="alert">The molecular viewer could not load. Reload this page to retry, or use the whole-protein overview.</p> : this.props.children;
  }
}

export default function ProteinStructureExplorer({ protein, variants, activeRange, selectedDomain, onRegionHover, onRegionSelect, onRangeSelect }) {
  const [view, setView] = useState("fragments");
  const [fragmentId, setFragmentId] = useState(manifest.fragments[0].id);
  const fragment = manifest.fragments.find(item => item.id === fragmentId);
  const [coordinateState, setCoordinateState] = useState({ id: "", text: "", error: "" });
  const [retry, setRetry] = useState(0);
  const [representation, setRepresentation] = useState("backbone");
  const [colorMode, setColorMode] = useState("confidence");
  const [hover, setHover] = useState(null);
  const [picked, setPicked] = useState(null);
  const [positionInput, setPositionInput] = useState("");
  const [positionError, setPositionError] = useState("");
  const [canvasError, setCanvasError] = useState("");
  const [ready, setReady] = useState(false);
  const [renderer, setRenderer] = useState("");
  const controls = useRef(null);
  const onRegionHoverRef = useRef(onRegionHover);
  onRegionHoverRef.current = onRegionHover;
  const overlap = fragmentOverlap(fragment, activeRange);
  const linkedRange = hover ? [hover.position, hover.position] : activeRange || (picked ? [picked.position, picked.position] : null);
  const fragmentVariants = useMemo(() => variants.filter(v => v.proteinMapping.status === "mapped" && v.proteinMapping.start <= fragment.end && v.proteinMapping.end >= fragment.start), [variants, fragment]);
  const inspected = hover || picked;

  useEffect(() => { if (!activeRange) setPicked(null); }, [activeRange?.[0], activeRange?.[1]]);

  useEffect(() => {
    setHover(null); setPicked(null); setPositionInput(""); setPositionError(""); setCanvasError(""); setReady(false);
    onRegionHoverRef.current?.(null);
    const abort = new AbortController();
    const cached = coordinates.get(fragment.coordinateUrl);
    setCoordinateState({ id: fragment.id, text: cached || "", error: "" });
    if (!cached) fetch(fragment.coordinateUrl, { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error("The fragment coordinate file could not be loaded.");
      return response.text();
    }).then(text => {
      if (abort.signal.aborted) return;
      coordinates.set(fragment.coordinateUrl, text);
      setCoordinateState({ id: fragment.id, text, error: "" });
    }).catch(error => {
      if (!abort.signal.aborted) setCoordinateState({ id: fragment.id, text: "", error: error.message });
    });
    return () => abort.abort();
  }, [fragment, retry]);

  function selectView(next) {
    setView(next); setHover(null); onRegionHover?.(null);
  }
  function hoverResidue(residue) {
    setHover(residue);
    onRegionHover?.(residue ? { start: residue.position, end: residue.position } : null);
  }
  function selectResidue(residue) {
    setPicked(residue); setPositionInput(String(residue.position)); setPositionError("");
    onRangeSelect([residue.position, residue.position]);
  }
  function selectPosition(event) {
    event.preventDefault();
    const value = positionInput.trim();
    const residue = /^\d+$/.test(value) ? fragment.residues.find(item => item.position === Number(value)) : null;
    if (!residue) { setPositionError(`Choose a modeled residue from ${fragment.start} to ${fragment.end}.`); return; }
    selectResidue({ position: residue.position, residueName: residue.aminoAcid, chain: fragment.chains[0], plddt: residue.plddt[fragment.chains[0]] });
    controls.current?.focus([residue.position, residue.position]);
  }
  const loadedText = coordinateState.id === fragment.id ? coordinateState.text : "";
  const error = coordinateState.id === fragment.id ? coordinateState.error || canvasError : "";
  return <section className="structure-explorer" aria-label="Protein structure views">
    <div className="structure-view-tabs" role="group" aria-label="Protein view">
      <button type="button" aria-pressed={view === "fragments"} onClick={() => selectView("fragments")}>AlphaFold fragments</button>
      <button type="button" aria-pressed={view === "overview"} onClick={() => selectView("overview")}>Whole-protein overview</button>
    </div>
    <div hidden={view !== "fragments"} className="fragment-workspace">
      <div className="fragment-heading"><h3>AlphaFold fragment structures</h3><span className="fragment-method">Predicted · fragment only</span></div>
      <div className="fragment-choices" role="group" aria-label="Choose a predicted fragment">
        {manifest.fragments.map(item => <button key={item.id} type="button" aria-pressed={fragment.id === item.id} onClick={() => setFragmentId(item.id)}>
          <strong>{item.label}</strong><span>aa {number(item.start)}–{number(item.end)} · {item.chains.length} {item.chains.length === 1 ? "chain" : "chains"}</span>
        </button>)}
      </div>
      <p className="fragment-coverage-label"><strong>{number(fragment.length)} of {number(protein.length)} sequence positions</strong> · {fragment.chains.length === 1 ? "One isolated chain" : "Three copies of the same fragment"}. Fragments are displayed separately and are not joined.</p>
      <div className="fragment-coverage" role="img" aria-label={`Modeled coverage: residues ${fragment.start} through ${fragment.end} of ${protein.length}`}><span style={{ left: `${(fragment.start - 1) / protein.length * 100}%`, width: `${fragment.length / protein.length * 100}%` }} /></div>
      <div className="fragment-toolbar">
        <label>Display<select aria-label="Structure representation" value={representation} onChange={event => setRepresentation(event.target.value)}><option value="backbone">Thin backbone</option><option value="sticks">Atoms & bonds</option><option value="surface" disabled={renderer === "compatibility"}>Molecular surface{renderer === "compatibility" ? " (needs WebGL)" : ""}</option></select></label>
        <label>Color<select aria-label="Structure coloring" value={colorMode} onChange={event => setColorMode(event.target.value)}><option value="confidence">Prediction confidence</option><option value="chain">Chain</option></select></label>
        <div className="fragment-view-buttons"><button type="button" disabled={!ready} aria-label="Zoom out of fragment" onClick={() => controls.current?.zoom(1 / 1.25)}>−</button><button type="button" disabled={!ready} aria-label="Zoom in on fragment" onClick={() => controls.current?.zoom(1.25)}>+</button><button type="button" disabled={!ready} onClick={() => controls.current?.reset()}>Reset structure view</button></div>
      </div>
      <div className="fragment-stage" data-fragment={fragment.id} data-model-status={error ? "error" : ready ? "ready" : "loading"}>
        <CanvasBoundary><Suspense fallback={<p className="fragment-loading" role="status">Loading molecular viewer…</p>}>
          <FragmentCanvas coordinateText={loadedText} fragment={fragment} representation={representation} colorMode={colorMode} activeRange={linkedRange}
            onRendererChange={next => { setRenderer(next); setCanvasError(""); if (next === "compatibility") setRepresentation(mode => mode === "surface" ? "backbone" : mode); }}
            onResidueHover={hoverResidue} onResidueSelect={selectResidue} onReady={api => { controls.current = api; setReady(Boolean(api)); }} onError={message => { setCanvasError(message); setReady(false); }} />
        </Suspense></CanvasBoundary>
        {!loadedText && !error && <p className="fragment-loading" role="status">Loading fragment coordinates…</p>}
        {error && <div className="fragment-error" role="alert"><p>{error}</p>{canvasError ? <button type="button" className="text-button" onClick={() => location.reload()}>Reload viewer</button> : <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>Retry coordinates</button>}<span> The overview and variant table remain available.</span></div>}
      </div>
      <p className="fragment-interaction-hint">Drag to rotate · scroll to zoom · right-drag to pan · click a residue to filter variants. Keyboard: arrows rotate, + / − zoom, Home resets.</p>
      {renderer === "compatibility" && <p className="fragment-compatibility-note">Compatibility view: the same predicted coordinates, rendered without WebGL. Surface display requires WebGL.</p>}
      <div className="fragment-color-key" aria-label={colorMode === "confidence" ? "AlphaFold pLDDT confidence legend" : "Protein chain color legend"}>
        {colorMode === "confidence" ? <><span>pLDDT</span>{[["Very high ≥90", "#0053d6"], ["Confident 70–90", "#65cbf3"], ["Low 50–70", "#ffdb13"], ["Very low <50", "#ff7d45"]].map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</> : fragment.chains.map((chain, i) => <span key={chain}><i style={{ background: CHAIN_COLORS[i % CHAIN_COLORS.length] }} />Chain {chain}</span>)}
        <span><i style={{ background: SELECTED_RESIDUE_COLOR }} />Selected residues</span>
      </div>
      <div className="fragment-inspector" aria-live="off">
        <div>{inspected ? <><strong>{inspected.residueName} {number(inspected.position)} · chain {inspected.chain}</strong><span>Model residue {inspected.position - fragment.start + 1} · pLDDT {inspected.plddt?.toFixed(1) ?? "unavailable"}</span></> : <><strong>{number(fragmentVariants.length)} matching variants overlap this fragment</strong><span>Hover over the structure to inspect an amino acid. Highlighting uses canonical COL7A1 numbering.</span></>}</div>
        <button type="button" className="button" onClick={() => onRangeSelect([fragment.start, fragment.end])}>Show variants in this fragment</button>
      </div>
      <div className="fragment-linked-note">{activeRange ? overlap ? <>Linked map interval: aa {number(activeRange[0])}–{number(activeRange[1])}. {overlap[0] !== activeRange[0] || overlap[1] !== activeRange[1] ? "Only the overlapping modeled residues are highlighted." : "Modeled residues are highlighted."} <button type="button" className="text-button" disabled={!ready} onClick={() => controls.current?.focus(overlap)}>Focus selection</button></> : <>The selected interval (aa {number(activeRange[0])}–{number(activeRange[1])}) is outside this fragment. Choose another fragment or use the overview.</> : "Only these two intervals currently have prediction files in this viewer. Uncovered residues have no modeled coordinates here."}</div>
      <form className="fragment-position-form" onSubmit={selectPosition} noValidate><label>Go to amino acid<input aria-label="Fragment amino acid position" inputMode="numeric" value={positionInput} onChange={event => { setPositionInput(event.target.value); setPositionError(""); }} placeholder={`${fragment.start}–${fragment.end}`} aria-invalid={Boolean(positionError)} /></label><button className="button" type="submit">Select residue</button>{positionError && <span role="alert">{positionError}</span>}</form>
      <p className="fragment-confidence-note"><strong>{fragment.chains.length > 1 ? "Chain arrangement is uncertain." : "A predicted fragment, not an experimental structure."}</strong> {fragment.chains.length > 1 ? `Interface confidence ipTM ${score(fragment.confidence.iptm)}; the three-chain arrangement is not established by this model.` : `Overall fold confidence pTM ${score(fragment.confidence.ptm)}. Confidence describes the model, not a variant’s clinical significance.`}</p>
      <details className="fragment-provenance"><summary>Model provenance, confidence & downloads</summary><div>
        <p>{fragment.caution}</p>
        <p>Overlapping annotated domains: {fragment.domainOverlaps.map(domain => `${domain.label} (aa ${domain.start}–${domain.end})`).join("; ")}. These annotation boundaries are distinct from the modeled fragment endpoints.</p>
        <p>Q02388-1 residues {fragment.start}–{fragment.end}, {fragment.chains.length} {fragment.chains.length === 1 ? "chain" : "chains"}; AlphaFold Server seed {fragment.seed}, top-ranked model (rank {fragment.modelRank}). The input sequence matches this reference interval exactly. No fragments have been stitched, aligned into a full protein, or used to predict variant effects.</p>
        <p>pTM {score(fragment.confidence.ptm)} · ipTM {score(fragment.confidence.iptm)} · mean Cα pLDDT {fragment.confidence.meanCaPlddt.toFixed(1)}{Number.isFinite(fragment.confidence.meanInterChainPae) ? ` · mean inter-chain PAE ${fragment.confidence.meanInterChainPae.toFixed(1)} Å` : ""}. Local confidence does not establish the relative arrangement of domains or chains.</p>
        <div className="fragment-downloads"><a href={fragment.coordinateUrl} download>Original mmCIF</a><a href={fragment.provenance.jobRequestUrl} download>Model inputs</a><a href={fragment.provenance.summaryUrl} download>Confidence summary</a><a href="/data/structures/manifest.json" download>Mapping & file hashes</a><a href="https://alphafoldserver.com/output-terms" target="_blank" rel="noreferrer">AlphaFold output terms ↗</a></div>
        <p>{manifest.attribution} Non-commercial use terms apply. Molecular graphics: 3Dmol.js. Variant classifications still come from the existing ClinVar snapshot.</p>
      </div></details>
    </div>
    {view === "overview" && <ProteinSchematic protein={protein} activeRange={activeRange} selectedDomain={selectedDomain} onRegionHover={onRegionHover} onRegionSelect={onRegionSelect} />}
  </section>;
}
