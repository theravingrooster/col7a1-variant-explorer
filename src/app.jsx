import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  EMPTY_FILTERS,
  GROUPS,
  filterVariants,
  formatNumber as num,
  histogram,
  humanReason,
  positionLabel,
  searchableText,
  sortVariants,
  variantsCsv,
} from "./data-utils.mjs";
import "./styles.css";
import { validateDataset } from "./dataset-validation.mjs";
import { readExplorerState, writeExplorerState, EXPLORER_PAGE_SIZE as PAGE_SIZE, MAX_SEARCH_LENGTH } from "./explorer-state.mjs";

const Arrow = () => <span aria-hidden="true">↗</span>;
function ExternalLink({ href, children, ...props }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children} <Arrow />
    </a>
  );
}
function Badge({ variant }) {
  return (
    <span className={`badge ${variant.significanceGroup}`}>
      <span className="dot" />
      {variant.clinicalSignificance.join(" / ") || "Not classified"}
    </span>
  );
}
function Select({ label, value, onChange, options, all = "All" }) {
  return (
    <label className="select-label">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}
function ProteinMap({ protein, variants, filters, onFilter, selected }) {
  const bins = useMemo(
    () => histogram(variants, protein.length),
    [variants, protein.length],
  );
  const max = Math.max(1, ...bins.map((b) => b.total));
  const mapped = variants.filter(
    (v) => v.proteinMapping.status === "mapped",
  ).length;
  const [hovered, setHovered] = useState(null);
  const [focusedBin, setFocusedBin] = useState(0);
  const hoveredBin = hovered === null ? null : bins[hovered];
  const x = (n) => 20 + ((n - 1) / protein.length) * 1100;
  const regions = protein.domains.filter((d) => d.level !== "subdomain");
  const subdomains = protein.domains.filter((d) => d.level === "subdomain");
  function activateBin(bin) {
    onFilter(
      "range",
      filters.range?.[0] === bin.start && filters.range?.[1] === bin.end
        ? null
        : [bin.start, bin.end],
    );
  }
  return (
    <section className="panel protein-panel" aria-labelledby="protein-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PROTEIN ARCHITECTURE</p>
          <h2 id="protein-title">A view along collagen VII</h2>
        </div>
        <ExternalLink href={protein.url} className="text-link">
          UniProt Q02388
        </ExternalLink>
      </div>
      <div className="map-summary">
        <span>
          <strong>{num(mapped)}</strong> mapped in current results{" "}
          <span className="muted">
            / {num(variants.length - mapped)} unmapped
          </span>
        </span>
        <span className="mono">{num(protein.length)} amino acids</span>
      </div>
      <div className="map-scroll">
        <svg
          className="protein-map"
          role="group"
          viewBox="0 0 1140 255"
          aria-label="Variant distribution over the COL7A1 protein domains. Select a bar or domain to filter the table."
          aria-describedby="map-instructions"
        >
          <text x="20" y="17" className="svg-caption">
            VARIANT COUNT
          </text>
          <text x="1120" y="17" textAnchor="end" className="svg-caption">
            25-RESIDUE BINS · MAX {max}
          </text>
          {[500, 1000, 1500, 2000, 2500].map((n) => (
            <line
              key={n}
              x1={x(n)}
              x2={x(n)}
              y1="27"
              y2="217"
              className="grid-line"
            />
          ))}
          {bins.map((bin, index) => {
            let cumulative = 0;
            return (
              <g
                key={bin.start}
                role="button"
                tabIndex={focusedBin === index ? 0 : -1}
                data-bin={index}
                aria-pressed={filters.range?.[0] === bin.start && filters.range?.[1] === bin.end}
                aria-label={`Filter amino acids ${bin.start} to ${bin.end}, ${bin.total} variants`}
                onClick={() => activateBin(bin)}
                onKeyDown={(e) => {
                  const offsets = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: bins.length - 1 - index };
                  if (Object.hasOwn(offsets, e.key)) {
                    e.preventDefault();
                    const next = Math.max(0, Math.min(bins.length - 1, index + offsets[e.key]));
                    e.currentTarget.parentElement.querySelector(`[data-bin="${next}"]`)?.focus();
                    return;
                  }
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activateBin(bin);
                  }
                }}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => { setHovered(index); setFocusedBin(index); }}
                onBlur={() => setHovered(null)}
                className="histogram-bin"
              >
                <title>{`aa ${bin.start}–${bin.end}: ${bin.total} variants (counted at the first reported residue)`}</title>
                <rect
                  x={x(bin.start)}
                  y="27"
                  width={1100 / bins.length}
                  height="100"
                  fill={
                    filters.range?.[0] === bin.start ? "#d7e8e1" : "transparent"
                  }
                />
                {Object.entries(GROUPS).map(([key, group]) => {
                  const height = (bin.counts[key] / max) * 92;
                  cumulative += height;
                  return (
                    <rect
                      key={key}
                      x={x(bin.start)}
                      y={127 - cumulative}
                      width={Math.max(1, 1100 / bins.length - 2)}
                      height={height}
                      fill={group.color}
                    />
                  );
                })}
              </g>
            );
          })}
          <line x1="20" x2="1120" y1="128" y2="128" stroke="#cad6ce" />
          {regions.map((d) => (
            <g
              key={d.id}
              role="button"
              tabIndex="0"
              aria-pressed={filters.domain === d.id}
              aria-label={`Filter ${d.label}, amino acids ${d.start} to ${d.end}`}
              onClick={() =>
                onFilter("domain", filters.domain === d.id ? "" : d.id)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onFilter("domain", filters.domain === d.id ? "" : d.id);
                }
              }}
              className="domain-block"
            >
              <title>{`${d.label} · ${d.start}–${d.end} · ${d.description}`}</title>
              <rect
                x={x(d.start)}
                y="144"
                width={((d.end - d.start + 1) / protein.length) * 1100}
                height="32"
                rx="3"
                className={`domain-${d.label.toLowerCase().replaceAll(" ", "-")} ${filters.domain === d.id ? "active-domain" : ""}`}
              />
              {d.level !== "signal" && (
                <text
                  x={(x(d.start) + x(d.end)) / 2}
                  y="165"
                  textAnchor="middle"
                  className="domain-label"
                >
                  {d.label}
                </text>
              )}
            </g>
          ))}
          {subdomains.map((d) => (
            <g
              key={d.id}
              role="button"
              tabIndex="0"
              aria-pressed={filters.domain === d.id}
              aria-label={`Filter ${d.label}, amino acids ${d.start} to ${d.end}`}
              className="subdomain-block"
              onClick={() =>
                onFilter("domain", filters.domain === d.id ? "" : d.id)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onFilter("domain", filters.domain === d.id ? "" : d.id);
                }
              }}
            >
              <title>{`${d.label} · ${d.start}–${d.end}`}</title>
              <rect
                x={x(d.start)}
                y="185"
                width={((d.end - d.start + 1) / protein.length) * 1100}
                height="12"
                rx="2"
                className={filters.domain === d.id ? "active-subdomain" : ""}
              />
            </g>
          ))}
          {[1, 500, 1000, 1500, 2000, 2500, 2944].map((n) => (
            <text
              key={n}
              x={x(n)}
              y="223"
              textAnchor={n === 1 ? "start" : n === 2944 ? "end" : "middle"}
              className="axis-label"
            >
              {num(n)}
            </text>
          ))}
          <text x="20" y="247" className="svg-caption">
            SUBDOMAINS: VWFA · FIBRONECTIN TYPE III · BPTI/KUNITZ
          </text>
          {selected?.proteinMapping.status === "mapped" && (
            <line
              x1={x(selected.proteinMapping.start)}
              x2={x(selected.proteinMapping.start)}
              y1="25"
              y2="202"
              stroke="#143f36"
              strokeWidth="2"
              strokeDasharray="3 3"
            />
          )}
        </svg>
      </div>
      <div className="map-footer">
        <div className="legend">
          {Object.entries(GROUPS).map(([key, g]) => (
            <span key={key}>
              <i style={{ background: g.color }} />
              {g.label}
            </span>
          ))}
        </div>
        <span className="map-hover">
          {hoveredBin
            ? `aa ${hoveredBin.start}–${hoveredBin.end} · ${hoveredBin.total} variants`
            : "Select a bar or domain to explore"}
        </span>
      </div>
      <p className="map-note" id="map-instructions">
        Coordinates include the signal peptide. Bars count each variant once at
        its first reported residue; filters use interval overlap. Frameshifts
        show their anchor only. Use left/right arrow keys to move between bars,
        Home/End for the first/last bar, and Enter or Space to select.
      </p>
    </section>
  );
}
function VariantDetails({ variant: v, protein, onClose }) {
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
  return (
    <dialog
      ref={ref}
      className="detail-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
      }}
      aria-labelledby="detail-title"
    >
      <div className="detail-header">
        <p className="eyebrow">CLINVAR VARIATION {v.variationId}</p>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close variant details"
          autoFocus
        >
          ×
        </button>
      </div>
      <h2 id="detail-title" className="mono">
        {v.codingHgvs.join(" / ") || `Variation ${v.variationId}`}
      </h2>
      <p className="protein-hgvs mono">
        {v.proteinHgvs.join(" / ") || "No protein HGVS reported"}
      </p>
      <Badge variant={v} />
      <dl className="detail-grid">
        <div>
          <dt>Review status</dt>
          <dd>{v.reviewStatus.join("; ") || "Not reported"}</dd>
        </div>
        <div>
          <dt>Variant type</dt>
          <dd>{v.types.join("; ")}</dd>
        </div>
        <div>
          <dt>Protein mapping</dt>
          <dd>
            {positionLabel(m)}
            {m.status === "unmapped"
              ? ` · ${humanReason(m.reason)}`
              : " · reference residues match Q02388"}
          </dd>
        </div>
        <div>
          <dt>Domain overlap</dt>
          <dd>
            {m.domainIds
              .map((id) => protein.domains.find((d) => d.id === id)?.label)
              .join("; ") || "No mapped overlap"}
          </dd>
        </div>
        <div>
          <dt>Last evaluated (ClinVar)</dt>
          <dd>{v.lastEvaluated.join("; ") || "Not reported"}</dd>
        </div>
        <div>
          <dt>Gene symbols</dt>
          <dd>{v.geneSymbols.join("; ")}</dd>
        </div>
      </dl>
      {m.extent === "frameshift_anchor" && (
        <p className="info-note">
          This maps the frameshift anchor only. It does not describe the
          downstream extent of the altered protein.
        </p>
      )}
      <h3>Conditions, as reported</h3>
      <ul className="conditions">
        {v.conditions.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <h3>Genomic coordinates</h3>
      <div className="coordinate-list">
        {v.genomicPositions.map((p, i) => (
          <div key={i}>
            <strong>{p.assembly || "Unspecified assembly"}</strong>
            <span className="mono">
              {p.chromosomeAccession || p.chromosome}: {p.start ?? "?"}–
              {p.end ?? "?"}
            </span>
            <small>
              VCF: {p.vcfPosition ?? "not available"} · {p.vcfReference ?? "?"}{" "}
              → {p.vcfAlternate ?? "?"}
            </small>
          </div>
        ))}
      </div>
      <h3>Source evidence</h3>
      <p className="source-name mono">{v.names.join("\n")}</p>
      <p>
        Allele ID: {v.alleleIds.join(", ")}. Original ClinVar lines (header =
        line 1):
      </p>
      <ul className="source-lines">
        {v.sourceRecords.map((s) => (
          <li key={s.line}>
            <strong>Line {num(s.line)}</strong>
            <code>{s.sha256}</code>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Hashes cover the original tab-separated row without its line ending. The
        filtered TSV contains these line numbers and unchanged source fields.
      </p>
      <div className="detail-actions">
        <ExternalLink href={v.url} className="button primary">
          Open in ClinVar
        </ExternalLink>
        <a className="button" href="./data/clinvar-col7a1.tsv" download>
          Download all source rows ↓
        </a>
      </div>
    </dialog>
  );
}
function Sources({ data }) {
  const ref = useRef(null);
  useEffect(() => {
    const openFromHash = () => {
      if (location.hash === "#data-sources") {
        ref.current.open = true;
        document.getElementById("data-sources")?.scrollIntoView();
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);
  return (
    <details className="sources" id="source-methods" ref={ref}>
      <summary>
        <span>Source files & mapping methods</span>
        <span className="mono">LOCAL SNAPSHOT</span>
      </summary>
      <div className="sources-content">
        <p>
          All records come from the supplied local files. No live queries or
          external assets are used. ClinVar’s release date is not present in the
          source; the UniProt annotation update is{" "}
          {data.protein.entryAudit.lastAnnotationUpdateDate}.
        </p>
        <div className="source-cards">
          {Object.entries(data.sources).map(([key, source]) => (
            <div key={key}>
              <h3>{key === "clinvar" ? "ClinVar" : "UniProt"}</h3>
              <p className="mono">{source.file}</p>
              <code>{source.sha256}</code>
              <small>SHA-256 of the original file</small>
            </div>
          ))}
        </div>
        <p>{data.processing.mapping}</p>
        <ul>
          {data.processing.limitations.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <div className="download-links">
          <a href="./data/variants.json" download>
            Processed JSON ↓
          </a>
          <a href="./data/clinvar-col7a1.tsv" download>
            Original matching rows (TSV) ↓
          </a>
          <a href="./data/Q02388.json" download>
            UniProt source JSON ↓
          </a>
        </div>
      </div>
    </details>
  );
}
function Explorer({ data }) {
  const [initial] = useState(() => readExplorerState(location.search, data));
  const [filters, setFilters] = useState(initial.filters);
  const [sort, setSort] = useState(initial.sort);
  const [page, setPage] = useState(initial.page);
  const [selected, setSelected] = useState(() => data.variants.find(v => v.variationId === initial.selectedId) || null);
  const variants = useMemo(
    () => data.variants.map((v) => ({ ...v, searchText: searchableText(v) })),
    [data],
  );
  const results = useMemo(
    () => sortVariants(filterVariants(variants, filters), sort),
    [variants, filters, sort],
  );
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const shownPage = Math.min(page, pageCount - 1);
  useEffect(() => {
    const url = new URL(location.href);
    url.search = writeExplorerState({ filters, sort, page: shownPage, selectedId: selected?.variationId }).toString();
    if (url.href !== location.href) history.replaceState(null, "", url);
  }, [filters, sort, shownPage, selected]);
  useEffect(() => {
    const restore = () => {
      const state = readExplorerState(location.search, data);
      setFilters(state.filters);
      setSort(state.sort);
      setPage(state.page);
      setSelected(data.variants.find(v => v.variationId === state.selectedId) || null);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [data]);
  const rows = results.slice(
    shownPage * PAGE_SIZE,
    (shownPage + 1) * PAGE_SIZE,
  );
  const options = useMemo(
    () =>
      Object.fromEntries(
        ["clinicalSignificance", "reviewStatus", "types"].map((key) => [
          key,
          [...new Set(variants.flatMap((v) => v[key]))].sort(),
        ]),
      ),
    [variants],
  );
  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  }
  function clear() {
    setFilters({ ...EMPTY_FILTERS });
    setPage(0);
  }
  function changePage(next) {
    setPage(next);
    document.getElementById("variants-title")?.focus({ preventScroll: true });
    document.getElementById("variants-title")?.scrollIntoView({ block: "start" });
  }
  function renderPagination(position) {
    return (
      <nav className="pagination" aria-label={`${position} results pagination`}>
        <span>{results.length ? `${num(shownPage * PAGE_SIZE + 1)}–${num(Math.min((shownPage + 1) * PAGE_SIZE, results.length))}` : "0"} of {num(results.length)} results</span>
        <div>
          <button className="button page-button" disabled={shownPage === 0} onClick={() => changePage(shownPage - 1)} aria-label="Previous page">←</button>
          <span aria-live="polite">Page {shownPage + 1} of {pageCount}</span>
          <button className="button page-button" disabled={shownPage >= pageCount - 1} onClick={() => changePage(shownPage + 1)} aria-label="Next page">→</button>
        </div>
      </nav>
    );
  }
  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([variantsCsv(results, data.protein.domains)], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "col7a1-filtered-variants.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const active = Object.values(filters).some(Boolean);
  return (
    <>
      <a className="skip-link" href="#variants-title">Skip to variants</a>
      <header className="site-header">
        <a href="#" className="brand" aria-label="COL7A1 Explorer home">
          <span className="brand-symbol" aria-hidden="true">
            Ⅶ
          </span>
          <strong>
            COL7A1<span> / EXPLORER</span>
          </strong>
        </a>
        <div className="header-right">
          <span className="status-dot" />
          LOCAL DATASET
          <span className="header-divider" />
          <a href="#data-sources" onClick={() => { document.getElementById("source-methods").open = true; }}>Data & methods</a>
        </div>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">HUMAN GENETICS / CHROMOSOME 3</p>
          <div className="intro-row">
            <div>
              <h1>
                COL7A1 variant explorer<span>.</span>
              </h1>
              <p className="intro-description">
                Explore clinical variation across collagen VII.
                <br />
                From ClinVar records to protein domains, with a traceable source
                for every result.
              </p>
            </div>
            <div className="gene-label">
              <span className="mono">Q02388</span>
              <span>Collagen alpha-1(VII) chain</span>
              <span className="muted">Homo sapiens</span>
            </div>
          </div>
        </section>
        <p className="snapshot-note">Fixed research snapshot · Prepared October 27, 2026 · Does not update automatically.
          <span> ClinVar release date is unknown. Classifications and domain positions are source records, not a clinical interpretation.</span>
        </p>
        <section className="stats" aria-label="Dataset overview">
          <div>
            <span>Unique variants</span>
            <strong>{num(data.summary.variants)}</strong>
            <small>{num(data.summary.sourceRows)} ClinVar source rows</small>
          </div>
          <div>
            <span>Mapped to protein</span>
            <strong>{num(data.summary.mapped)}</strong>
            <small>Explicit HGVS + residue match</small>
          </div>
          <div>
            <span>Without protein mapping</span>
            <strong>{num(data.summary.unmapped)}</strong>
            <small>Retained in the table</small>
          </div>
          <div>
            <span>Annotated subdomains</span>
            <strong>
              {data.protein.domains
                .filter((d) => d.level === "subdomain")
                .length.toString()
                .padStart(2, "0")}
            </strong>
            <small>Plus NC1, collagenous & NC2 regions</small>
          </div>
        </section>
        <ProteinMap
          protein={data.protein}
          variants={results}
          filters={filters}
          onFilter={setFilter}
          selected={selected}
        />
        <section className="panel table-panel" aria-labelledby="variants-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CLINVAR RECORDS</p>
              <h2 id="variants-title" tabIndex={-1}>
                Explore the variants{" "}
                <span className="count-pill">{num(results.length)}</span>
              </h2>
            </div>
            <button
              className="button"
              onClick={exportCsv}
              disabled={!results.length}
            >
              Export CSV <span aria-hidden="true">↓</span>
            </button>
          </div>
          <div className="filter-area">
            <label className="search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Search variants"
                aria-describedby="search-help"
                placeholder="Search HGVS, variation ID, condition, or genomic position…"
                value={filters.query}
                maxLength={MAX_SEARCH_LENGTH}
                onChange={(e) => setFilter("query", e.target.value)}
              />
              <kbd>/</kbd>
            </label>
            <p className="search-help" id="search-help">Search HGVS, rsIDs, conditions, or coordinates. Use <code>id:17423</code> for an exact variant ID, or <code>GRCh38 chr3:48566281</code> for a genomic position. Share this page’s URL to preserve your filters and selected evidence.</p>
            <div className="filter-grid">
              <Select
                label="Clinical significance"
                value={filters.significance}
                onChange={(v) => setFilter("significance", v)}
                options={options.clinicalSignificance}
                all="All classifications"
              />
              <Select
                label="Protein domain"
                value={filters.domain}
                onChange={(v) => setFilter("domain", v)}
                options={data.protein.domains.map((d) => ({
                  value: d.id,
                  label: `${d.level === "subdomain" ? "↳ " : ""}${d.label} (${d.start}–${d.end})`,
                }))}
                all="All domains"
              />
              <Select
                label="Review status"
                value={filters.review}
                onChange={(v) => setFilter("review", v)}
                options={options.reviewStatus}
                all="All review statuses"
              />
              <Select
                label="Protein mapping"
                value={filters.mapping}
                onChange={(v) => setFilter("mapping", v)}
                options={[
                  { value: "mapped", label: "Mapped" },
                  { value: "unmapped", label: "Unmapped" },
                ]}
                all="Mapped & unmapped"
              />
              <Select
                label="Variant type"
                value={filters.type}
                onChange={(v) => setFilter("type", v)}
                options={options.types}
                all="All types"
              />
            </div>
          </div>
          <div className="results-toolbar">
            <div aria-live="polite">
              <strong>{num(results.length)}</strong> of {num(variants.length)}{" "}
              variants
              {filters.range && (
                <button
                  className="range-chip"
                  onClick={() => setFilter("range", null)}
                >
                  aa {filters.range[0]}–{filters.range[1]} ×
                </button>
              )}
              {active && (
                <button className="text-button" onClick={clear}>
                  Clear filters
                </button>
              )}
            </div>
            <label>
              Sort by{" "}
              <select
                aria-label="Sort variants"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(0);
                }}
              >
                <option value="id">Variation ID ↑</option>
                <option value="id-desc">Variation ID ↓</option>
                <option value="position">Protein position ↑</option>
              </select>
            </label>
          </div>
          {renderPagination("Top")}
          <div className="table-scroll" role="region" aria-label="Variant results table; scroll horizontally for all columns" tabIndex={0}>
            <table>
              <caption className="sr-only">Filtered COL7A1 variants with clinical classifications, protein positions, conditions and source evidence.</caption>
              <thead>
                <tr>
                  <th scope="col">Variant / HGVS</th>
                  <th scope="col">Clinical significance</th>
                  <th scope="col">Domain / position</th>
                  <th scope="col">Conditions</th>
                  <th scope="col">ClinVar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <button
                        className="variant-button mono"
                        onClick={() => setSelected(v)}
                      >
                        {v.codingHgvs.join(" / ") ||
                          `Variation ${v.variationId}`}
                      </button>
                      <span className="cell-secondary mono">
                        {v.proteinHgvs.join(" / ") ||
                          "Protein HGVS not reported"}
                      </span>
                      <span className="cell-tertiary">
                        {v.types.join(" / ")}
                      </span>
                    </td>
                    <td>
                      <Badge variant={v} />
                      <span className="cell-secondary review-status">
                        {v.reviewStatus.join("; ") || "No review status"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          v.proteinMapping.status === "mapped"
                            ? "domain-text"
                            : "muted"
                        }
                      >
                        {v.proteinMapping.regionLabels.join(" / ") ||
                          "Unmapped"}
                      </span>
                      <span className="cell-secondary mono">
                        {v.proteinMapping.status === "mapped"
                          ? positionLabel(v.proteinMapping)
                          : "No resolved protein position"}
                      </span>
                    </td>
                    <td>
                      <span
                        className="condition-text"
                        title={v.conditions.join("; ")}
                      >
                        {v.conditions[0] || "Not reported"}
                      </span>
                      {v.conditions.length > 1 && (
                        <button
                          className="text-button more-conditions"
                          onClick={() => setSelected(v)}
                        >
                          +{v.conditions.length - 1} more entries
                        </button>
                      )}
                    </td>
                    <td>
                      <ExternalLink href={v.url} className="clinvar-link mono">
                        {v.variationId}
                      </ExternalLink>
                      <button
                        className="text-button details-link"
                        onClick={() => setSelected(v)}
                      >
                        View evidence
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <div className="empty-state">
              <h3>No matching variants</h3>
              <p>Try a shorter search or broaden your filters.</p>
              <button className="button" onClick={clear}>
                Clear all filters
              </button>
            </div>
          )}
          {renderPagination("Bottom")}
        </section>
        <section id="data-sources">
          <Sources data={data} />
        </section>
        <footer>
          <span>COL7A1 / VARIANT EXPLORER</span>
          <p>
            Research reference · Clinical classifications are reproduced from
            the source.
          </p>
          <ExternalLink href={data.protein.url}>UniProt Q02388</ExternalLink>
        </footer>
      </main>
      {selected && (
        <VariantDetails
          variant={selected}
          protein={data.protein}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
function App() {
  const [data, setData] = useState(null),
    [error, setError] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setError("The dataset took too long to load.");
      controller.abort();
    }, 30000);
    fetch("./data/variants.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Dataset request failed (${r.status})`);
        return r.json();
      })
      .then((d) => {
        validateDataset(d);
        setData(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !document.activeElement.isContentEditable &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          document.activeElement.tagName,
        ) &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        document.querySelector('input[type="search"]')?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  if (error)
    return (
      <main className="loading-state" role="alert">
        <h1>The dataset could not be loaded.</h1>
        <p>{error}</p>
        <p>
          Check your connection and try again. If the problem continues,
          the dataset may be temporarily unavailable.
        </p>
        <button className="button" onClick={() => location.reload()}>
          Try again
        </button>
      </main>
    );
  if (!data)
    return (
      <main className="loading-state" role="status">
        <div className="loading-mark">Ⅶ</div>
        <h1>COL7A1 variant explorer</h1>
        <p>Loading the local research dataset…</p>
      </main>
    );
  return <Explorer data={data} />;
}
createRoot(document.getElementById("root")).render(<App />);
