import React, { useEffect, useRef } from "react";
import { formatNumber as num, humanReason, positionLabel } from "./data-utils.mjs";
import ReviewSummary from "./ReviewSummary.jsx";
import ShareViewButton from "./ShareViewButton.jsx";

function ClinVarLink({ variant }) {
  return <a className="button primary" href={variant.url} target="_blank" rel="noreferrer">Open in ClinVar <span aria-hidden="true">↗</span></a>;
}

export default function VariantDetails({ variant: v, protein, data, viewUrl, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
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
  const m = v.proteinMapping;
  const overlappingDomains = m.domainIds.map(id => protein.domains.find(d => d.id === id)).filter(Boolean);
  const snapshotDate = data?.snapshot?.preparedDate;
  return (
    <dialog ref={ref} className="detail-dialog research-detail" aria-labelledby="detail-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
      }}>
      <div className="detail-header">
        <p className="eyebrow">CLINVAR VARIATION {v.variationId}</p>
        <button className="icon-button" onClick={onClose} aria-label="Close variant details" autoFocus>×</button>
      </div>
      <div className="detail-identity">
        <div>
          <h2 id="detail-title" className="mono">{v.codingHgvs.join(" / ") || `Variation ${v.variationId}`}</h2>
          <p className="protein-hgvs mono">{v.proteinHgvs.join(" / ") || "No protein HGVS reported"}</p>
          <span className={`badge ${v.significanceGroup}`}><span className="dot" />{v.clinicalSignificance.join(" / ") || "Not reported"}</span>
        </div>
        <div className="detail-source-links">
          <ClinVarLink variant={v} />
          <a className="button" href={protein.url} target="_blank" rel="noreferrer">UniProt Q02388 <span aria-hidden="true">↗</span></a>
        </div>
      </div>

      <section className="detail-hgvs" aria-labelledby="detail-hgvs-title">
        <h3 id="detail-hgvs-title">Full HGVS & source names</h3>
        {v.names.length ? <ul className="source-hgvs-list">{v.names.map(name => <li key={name}><code>{name}</code></li>)}</ul> : <p className="muted">No ClinVar source names reported.</p>}
        <p className="evidence-context">ClinVar names are reproduced verbatim, including reference accessions where supplied.</p>
      </section>

      <section className="detail-evidence" aria-labelledby="evidence-quality-title">
        <h3 id="evidence-quality-title">Review & submitters</h3>
        <ReviewSummary variant={v} full />
        <p className="evidence-context">Review status and submitter counts are ClinVar source aggregates. A larger count alone does not establish agreement or pathogenicity; counts are not summed across genome assemblies.</p>
      </section>

      {viewUrl && <div className="detail-share"><ShareViewButton url={viewUrl} /></div>}

      <dl className="detail-grid evidence-facts">
        <div><dt>Protein position</dt><dd>{positionLabel(m)}</dd><small>{m.status === "unmapped" ? humanReason(m.reason) : "1-based, inclusive · Q02388-1"}</small></div>
        <div><dt>Domain & subdomain overlap</dt><dd>{overlappingDomains.length ? <ul className="detail-domain-list">{overlappingDomains.map(domain => <li key={domain.id}><strong>{domain.label}</strong><span className="mono">aa {num(domain.start)}–{num(domain.end)}</span></li>)}</ul> : "No mapped overlap"}</dd><small>UniProt boundaries · 1-based, inclusive</small></div>
        <div><dt>Variant type</dt><dd>{v.types.join("; ") || "Not reported"}</dd></div>
        <div><dt>Last evaluated (ClinVar)</dt><dd>{v.lastEvaluated.join("; ") || "Not reported"}</dd><small>Per-record evaluation date</small></div>
      </dl>

      {m.extent === "frameshift_anchor" && <p className="info-note">This maps the frameshift anchor only. It does not describe the downstream extent of the altered protein.</p>}
      <section className="detail-conditions" aria-labelledby="detail-conditions-title">
        <h3 id="detail-conditions-title">Conditions, as reported</h3>
        {v.conditions.length ? <ul className="conditions">{v.conditions.map(c => <li key={c}>{c}</li>)}</ul> : <p className="muted">No conditions reported.</p>}
        <p className="evidence-context">Source summaries such as “7 conditions” are retained verbatim. These records are not a complete condition-level assertion file.</p>
      </section>

      <details className="detail-disclosure">
        <summary>Genomic coordinates <span>{v.genomicPositions.length} source position{v.genomicPositions.length === 1 ? "" : "s"}</span></summary>
        <div className="coordinate-list">
          {v.genomicPositions.map((p, i) => <div key={i}>
            <strong>{p.assembly || "Unspecified assembly"}</strong>
            <span className="mono">{p.chromosomeAccession || p.chromosome}: {p.start ?? "?"}–{p.end ?? "?"}</span>
            <small>VCF: {p.vcfPosition ?? "not available"} · {p.vcfReference ?? "?"} → {p.vcfAlternate ?? "?"}</small>
          </div>)}
        </div>
      </details>
      <details className="detail-disclosure">
        <summary>Source evidence & mapping <span>{v.sourceRecords.length} original row{v.sourceRecords.length === 1 ? "" : "s"}</span></summary>
        <div className="detail-provenance">
          <dl className="provenance-facts">
            <div><dt>Gene symbols</dt><dd>{v.geneSymbols.join("; ")}</dd></div>
            <div><dt>Allele IDs</dt><dd>{v.alleleIds.join(", ")}</dd></div>
            <div><dt>Mapping method</dt><dd>{m.status === "mapped" ? "Explicit protein HGVS with reference-residue checks against Q02388-1; inclusive overlap with UniProt domains." : `Unmapped: ${humanReason(m.reason)}.`}</dd></div>
            <div><dt>Mapping extent</dt><dd>{humanReason(m.extent) || "Not applicable"}</dd></div>
            <div><dt>Snapshot prepared</dt><dd>{snapshotDate || "Not recorded"}</dd></div>
            <div><dt>ClinVar release date</dt><dd>{data?.sources?.clinvar?.releaseDate || "Unknown in supplied source"}</dd></div>
          </dl>
          <p>Original ClinVar lines (header = line 1):</p>
          <ul className="source-lines">{v.sourceRecords.map(s => <li key={s.line}><strong>Line {num(s.line)}</strong><code>{s.sha256}</code></li>)}</ul>
          <p className="evidence-context">Hashes cover each original tab-separated row without its line ending. The filtered TSV preserves those source fields and original line numbers. Positional mapping and source classifications are not a clinical interpretation.</p>
          <a className="button" href="./data/clinvar-col7a1.tsv" download>Download all source rows ↓</a>
        </div>
      </details>
    </dialog>
  );
}
