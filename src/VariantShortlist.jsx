import React, { useEffect, useMemo, useRef, useState } from "react";
import ReviewSummary from "./ReviewSummary.jsx";
import ShareViewButton from "./ShareViewButton.jsx";
import { conditionDisplayLabel } from "./condition-labels.mjs";
import { humanReason, positionLabel } from "./data-utils.mjs";
import { researchAnnotations } from "./research-data.mjs";
import "./shortlist.css";

function SourceList({ values, mono = false }) {
  return values?.length ? <ul className={`comparison-list${mono ? " mono" : ""}`}>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul> : <span className="muted">Not reported</span>;
}

function Conditions({ variant }) {
  return variant.conditions.length ? <ul className="comparison-list">{variant.conditions.map((condition, index) => {
    const label = conditionDisplayLabel(condition);
    return <li key={`${index}-${condition}`}>{label}{label !== condition && <small className="comparison-source">ClinVar label: {condition}</small>}</li>;
  })}</ul> : <span className="muted">Not reported</span>;
}

function DomainEvidence({ variant, protein }) {
  const mapping = variant.proteinMapping;
  const domains = mapping.domainIds.map(id => protein.domains.find(domain => domain.id === id)).filter(Boolean);
  return <>
    <strong>{positionLabel(mapping)}</strong>
    {domains.length ? <ul className="comparison-list">{domains.map(domain => <li key={domain.id}>{domain.label}<small className="comparison-source mono">aa {domain.start.toLocaleString("en-US")}–{domain.end.toLocaleString("en-US")}</small></li>)}</ul> : <p className="comparison-source">{mapping.status === "unmapped" ? humanReason(mapping.reason) : "No domain overlap reported"}</p>}
    {mapping.extent === "frameshift_anchor" && <p className="comparison-source">Frameshift anchor only; downstream extent is not mapped.</p>}
  </>;
}

function PatternEvidence({ annotation }) {
  return annotation.patternEvidence.length ? <ul className="comparison-list">{annotation.patternEvidence.map((item, index) => <li key={`${item.key}-${index}`}><strong>{item.label}</strong><small className="comparison-source mono">{item.source}</small></li>)}</ul> : <span className="muted">No recognized HGVS pattern</span>;
}

/** Saved records are independent of the active cohort filters. The parent owns
 * persistence, exports and share URLs; this dialog only selects a comparison. */
export default function VariantShortlist({ variants, protein, data, onClose, onRemove, onOpenVariant, onExport, shareUrlFor, storageNotice = "", shared = false, onOpenSaved }) {
  const dialogRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState(() => variants.slice(0, 4).map(variant => variant.variationId));
  const comparison = variants.filter(variant => selectedIds.includes(variant.variationId));
  const annotations = useMemo(() => new Map(variants.map(variant => [variant.variationId, researchAnnotations(variant)])), [variants]);
  const selectedCount = comparison.length;
  const shortlistUrl = variants.length ? shareUrlFor(variants.map(variant => variant.variationId)) : null;
  const compareUrl = selectedCount >= 2 ? shareUrlFor(comparison.map(variant => variant.variationId)) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  function toggle(id) {
    setSelectedIds(previous => {
      const valid = previous.filter(value => variants.some(variant => variant.variationId === value));
      if (valid.includes(id)) return valid.filter(value => value !== id);
      return valid.length < 4 ? [...valid, id] : valid;
    });
  }
  function remove(id) {
    setSelectedIds(previous => previous.filter(value => value !== id));
    onRemove(id);
  }
  const rows = [
    ["Coding HGVS", variant => <SourceList values={variant.codingHgvs} mono />],
    ["Protein HGVS", variant => <SourceList values={variant.proteinHgvs} mono />],
    ["Clinical significance", variant => <span className={`badge ${variant.significanceGroup}`}><span className="dot" />{variant.clinicalSignificance.join(" / ") || "Not reported"}</span>],
    ["Review & submitters", variant => <ReviewSummary variant={variant} full />],
    ["HGVS patterns", variant => <PatternEvidence annotation={annotations.get(variant.variationId)} />],
    ["Position & domains", variant => <DomainEvidence variant={variant} protein={protein} />],
    ["Conditions", variant => <Conditions variant={variant} />],
    ["Last evaluated", variant => <SourceList values={variant.lastEvaluated} />],
    ["Full source names", variant => <SourceList values={variant.names} mono />],
  ];

  return <dialog ref={dialogRef} className="shortlist-dialog" aria-labelledby="shortlist-title" aria-describedby="shortlist-help"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <div className="shortlist-header">
      <div><p className="eyebrow">RESEARCH SHORTLIST</p><h2 id="shortlist-title">{shared ? "Shared shortlist" : "Saved variants"} <span>{variants.length}</span></h2></div>
      <button className="icon-button" type="button" aria-label="Close shortlist" onClick={onClose} autoFocus>×</button>
    </div>
    <p className="shortlist-help" id="shortlist-help">{!shared && "Saved variants stay here when you change filters. "}Select 2–4 to compare their evidence.</p>
    {shared && <div className="shortlist-shared-note"><p>Shared shortlist. Your browser’s saved list is unchanged.</p>{onOpenSaved && <button className="button" type="button" onClick={onOpenSaved}>Open my saved shortlist</button>}</div>}
    {storageNotice && <p className="shortlist-storage-notice" role="status">{storageNotice}</p>}

    {variants.length ? <>
      <div className="shortlist-actions">
        <span role="status">{selectedCount} of 4 selected for comparison</span>
        <div className="shortlist-all-actions" role="group" aria-label="Entire shortlist actions">
          <ShareViewButton url={shortlistUrl} label="Copy shortlist link" />
          <button className="button" type="button" onClick={() => onExport(variants)}>Export shortlist <span aria-hidden="true">↓</span></button>
        </div>
      </div>
      <div className="shortlist-saved-scroll" role="region" aria-label="Saved variants; scroll to browse" tabIndex={0}>
        <ul className="shortlist-saved-list">{variants.map(variant => {
          const selected = comparison.some(item => item.variationId === variant.variationId);
          return <li key={variant.variationId} data-saved-variant={variant.variationId}>
            <label className="shortlist-check"><input type="checkbox" checked={selected} disabled={!selected && selectedCount >= 4}
              aria-label={`Compare variant ${variant.variationId}`} onChange={() => toggle(variant.variationId)} /><span className="sr-only">Compare</span></label>
            <button className="shortlist-variant" type="button" onClick={() => onOpenVariant(variant)} aria-label={`View evidence for saved variant ${variant.variationId}`}>
              <strong className="mono">{variant.codingHgvs.join(" / ") || `Variation ${variant.variationId}`}</strong>
              <span className="mono">{variant.proteinHgvs.join(" / ") || "No protein HGVS"} · ClinVar {variant.variationId}</span>
            </button>
            <button className="text-button shortlist-remove" type="button" onClick={() => remove(variant.variationId)} aria-label={`Remove variant ${variant.variationId} from shortlist`}>Remove</button>
          </li>;
        })}</ul>
      </div>

      <div className="shortlist-comparison-heading">
        <h3 id="shortlist-comparison-title">Evidence comparison</h3>
        {selectedCount >= 2 && <div className="shortlist-comparison-actions" role="group" aria-label="Selected comparison actions">
          <ShareViewButton url={compareUrl} label="Copy comparison link" />
          <button className="button" type="button" onClick={() => onExport(comparison, "comparison")}>Export comparison <span aria-hidden="true">↓</span></button>
        </div>}
      </div>
      <p className="shortlist-method-note">A comparison does not establish phase, inheritance, or an RDEB diagnosis. HGVS patterns describe the reported notation, not measured RNA or protein effects.</p>
      {selectedCount >= 2 ? <>
        <p className="shortlist-scroll-help" id="comparison-scroll-help">Scroll across to compare all selected variants. Protein boundaries are 1-based and inclusive.</p>
        <div className="shortlist-comparison-scroll" role="region" aria-label="Selected variant evidence comparison" aria-describedby="comparison-scroll-help" tabIndex={0}>
          <table className="comparison-table" style={{ minWidth: 145 + comparison.length * 245 }}>
            <caption className="sr-only">Source evidence for the selected saved COL7A1 variants</caption>
            <thead><tr><th scope="col">Evidence</th>{comparison.map(variant => <th scope="col" key={variant.variationId}>
              <a className="comparison-clinvar" href={variant.url} target="_blank" rel="noreferrer">ClinVar {variant.variationId} <span aria-hidden="true">↗</span></a>
              <button className="text-button" type="button" onClick={() => onOpenVariant(variant)} aria-label={`Open comparison evidence for variant ${variant.variationId}`}>View evidence</button>
            </th>)}</tr></thead>
            <tbody>{rows.map(([label, render]) => <tr key={label}><th scope="row">{label}</th>{comparison.map(variant => <td key={variant.variationId}>{render(variant)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="shortlist-method-note">ClinVar conditions and classifications are source aggregates, not paired condition-level assertions. Source submitter counts are not added together. Snapshot prepared {data?.snapshot?.preparedDate || "date not recorded"}; ClinVar release {data?.sources?.clinvar?.releaseDate || "unknown in source"}.</p>
      </> : <p className="shortlist-empty-comparison">{selectedCount === 1 ? "Select one more saved variant to compare." : "Select at least two saved variants to compare."}</p>}
    </> : <div className="shortlist-empty"><h3>{shared ? "No variants in this shared shortlist" : "No saved variants yet"}</h3><p>Use “Save” in the table or variant evidence to build a research shortlist.</p><button className="button" type="button" onClick={onClose}>Return to explorer</button></div>}
  </dialog>;
}
