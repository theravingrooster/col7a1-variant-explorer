import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  EMPTY_FILTERS,
  GROUPS,
  filterVariants,
  formatNumber as num,
  positionLabel,
  searchableText,
  sortVariants,
  variantsCsv,
} from "./data-utils.mjs";
import "./styles.css";
import "./charts.css";
import "./theme.css";
import ThemeToggle from "./ThemeToggle.jsx";
import ShareViewButton from "./ShareViewButton.jsx";
import { updateFilter, toggleDomainClassification } from "./filter-actions.mjs";
import VisualSummary from "./VisualSummary.jsx";
import ProteinMap from "./ProteinMap.jsx";
import VariantDetails from "./VariantDetails.jsx";
import VariantShortlist from "./VariantShortlist.jsx";
import { CONDITION_OPTIONS, HGVS_PATTERN_OPTIONS, researchAnnotations } from "./research-data.mjs";
import { readSavedShortlist, writeSavedShortlist, toggleShortlistId, MAX_SHORTLIST } from "./shortlist-state.mjs";
import ReviewSummary from "./ReviewSummary.jsx";
import { MULTIPLE_SUBMITTERS_REVIEW } from "./evidence.mjs";
import "./workspace.css";
import { UNCLASSIFIED } from "./chart-data.mjs";
import { SORT_OPTIONS, TABLE_SORT_FIELDS } from "./variant-sort.mjs";
import { validateDataset } from "./dataset-validation.mjs";
import { conditionDisplayLabel } from "./condition-labels.mjs";
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
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
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
function sortDirection(sort, fields) {
  const field = sort.replace(/-desc$/, "");
  return fields.includes(field) ? (sort.endsWith("-desc") ? "descending" : "ascending") : "none";
}
function SortColumnButton({ field, sort, onSort, children }) {
  const metadata = TABLE_SORT_FIELDS.find(item => item.key === field);
  const active = sort.replace(/-desc$/, "") === field;
  const next = active && !sort.endsWith("-desc") ? `${field}-desc` : field;
  const direction = next.endsWith("-desc") ? "descending" : "ascending";
  return <button className={`column-sort${active ? " is-active" : ""}`} data-sort-field={field}
    aria-label={`Sort by ${metadata.label}, ${direction}`} title={`${metadata.description} Click for ${direction} order.`}
    onClick={() => onSort(next)}>
    <span>{children || metadata.label}</span><span className="sort-arrow" aria-hidden="true">{active ? (sort.endsWith("-desc") ? "↓" : "↑") : "↕"}</span>
  </button>;
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
        <div className="research-methods" id="research-filter-methods">
          <h3>RDEB research filters</h3>
          <p>Condition context matches explicit recessive or dominant EB terms in the existing ClinVar condition summaries. Both labels may occur for one record. Generic DEB and summaries such as “7 conditions” do not establish inheritance, so an explicit-label cohort is incomplete. Classifications remain variant-level aggregates, not condition-specific assertions.</p>
          <p>Molecular-change filters recognize conservative patterns in the reported coding and protein HGVS. A glycine substitution is also a missense change; a protein insertion can also introduce a stop. The splice-site filter covers single-nucleotide substitutions at intronic +1/+2/−1/−2 only, not complex splice-adjacent changes. Unrecognized expressions remain in the unresolved group. No functional effect or loss of function is inferred.</p>
          <p>These filters are motivated by the variant classes discussed in <ExternalLink href="https://www.ncbi.nlm.nih.gov/books/NBK1304/">GeneReviews: Dystrophic Epidermolysis Bullosa</ExternalLink>. The shortlist compares existing records; it does not establish phase, a biallelic genotype, severity, or treatment eligibility.</p>
          <p>Only up to {MAX_SHORTLIST} numeric ClinVar IDs are saved in this browser and included in share links. Filter reset keeps the shortlist. CSV exports retain the original source fields and include derived labels with their supporting HGVS expressions.</p>
        </div>
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
  const tableScrollRef = useRef(null);
  const [initial] = useState(() => readExplorerState(location.search, data));
  const [filters, setFilters] = useState(initial.filters);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState(initial.sort);
  const [page, setPage] = useState(initial.page);
  const [selected, setSelected] = useState(() => data.variants.find(v => v.variationId === initial.selectedId) || null);
  const [showShortlist, setShowShortlist] = useState(initial.comparisonOpen);
  const [sharedShortlistIds, setSharedShortlistIds] = useState(() => new URLSearchParams(location.search).has("shortlist") ? initial.shortlistIds : null);
  const [savedState, setSavedState] = useState(() => {
    try { return readSavedShortlist(window.localStorage, data.variants); }
    catch { return { ids: [], notice: "Browser storage is unavailable. Your shortlist works for this visit; copy a share link to keep it." }; }
  });
  const savedIds = savedState.ids;
  const variants = useMemo(
    () => data.variants.map((v) => ({ ...v, searchText: searchableText(v), research: researchAnnotations(v) })),
    [data],
  );
  const variantsById = useMemo(() => new Map(variants.map(v => [v.variationId, v])), [variants]);
  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);
  const savedVariants = useMemo(() => savedIds.map(id => variantsById.get(id)).filter(Boolean), [savedIds, variantsById]);
  const sharedVariants = useMemo(() => sharedShortlistIds?.map(id => variantsById.get(id)).filter(Boolean), [sharedShortlistIds, variantsById]);
  useEffect(() => {
    let notice;
    try { notice = writeSavedShortlist(window.localStorage, savedIds); }
    catch { notice = "Browser storage is unavailable. Your shortlist works for this visit; copy a share link to keep it."; }
    if (notice) setSavedState(state => state.notice === notice ? state : { ...state, notice });
  }, [savedIds]);
  const results = useMemo(
    () => sortVariants(filterVariants(variants, filters), sort),
    [variants, filters, sort],
  );
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const shownPage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }, [results, shownPage]);
  useEffect(() => {
    const url = new URL(location.href);
    url.search = writeExplorerState({ filters, sort, page: shownPage, selectedId: selected?.variationId, shortlistIds: sharedShortlistIds, comparisonOpen: showShortlist }).toString();
    if (url.href !== location.href) history.replaceState(null, "", url);
  }, [filters, sort, shownPage, selected, sharedShortlistIds, showShortlist]);
  useEffect(() => {
    const restore = () => {
      const state = readExplorerState(location.search, data);
      setFilters(state.filters);
      setSort(state.sort);
      setPage(state.page);
      setSelected(data.variants.find(v => v.variationId === state.selectedId) || null);
      setSharedShortlistIds(new URLSearchParams(location.search).has("shortlist") ? state.shortlistIds : null);
      setShowShortlist(state.comparisonOpen);
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
    setFilters((f) => updateFilter(f, key, value));
    setPage(0);
  }
  function setDomainClassification(domain, significance) {
    setFilters(f => toggleDomainClassification(f, domain, significance));
    setPage(0);
  }
  function clear() {
    setFilters({ ...EMPTY_FILTERS });
    setPage(0);
  }
  function toggleSaved(id) {
    setSharedShortlistIds(null);
    setSavedState(state => toggleShortlistId(state.ids, id, data.variants));
  }
  function openShortlist() {
    setSelected(null);
    setShowShortlist(true);
  }
  function shortlistUrl(ids) {
    const url = new URL(location.href);
    url.search = writeExplorerState({ shortlistIds: ids, comparisonOpen: true }).toString();
    url.hash = "";
    return url.href;
  }
  function changePage(next) {
    setPage(next);
    document.getElementById("variants-title")?.focus({ preventScroll: true });
    document.getElementById("variants-title")?.scrollIntoView({ block: "start" });
  }
  function changeSort(next) {
    setSort(next);
    setPage(0);
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
  function exportCsv(exportedVariants = results, filename = "col7a1-filtered-variants.csv") {
    const url = URL.createObjectURL(
      new Blob([variantsCsv(exportedVariants, data.protein.domains, data)], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const viewUrl = new URL(location.href);
  viewUrl.search = writeExplorerState({ filters, sort, page: shownPage, selectedId: selected?.variationId, shortlistIds: sharedShortlistIds }).toString();
  viewUrl.hash = "";
  function openRow(event, variant) {
    if (event.target.closest("a, button, input, select, textarea, summary")) return;
    if (window.getSelection()?.toString()) return;
    event.currentTarget.focus({ preventScroll: true });
    setSelected(variant);
  }
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
          <ThemeToggle />
        </div>
      </header>
      <main className="research-workspace">
        <section className="intro">
          <p className="eyebrow">HUMAN GENETICS / CHROMOSOME 3</p>
          <div className="intro-row">
            <div>
              <h1>
                COL7A1 variant explorer<span>.</span>
              </h1>
              <p className="intro-description">Explore collagen VII by region, inspect ClinVar evidence, and export the variants that matter to your research.</p>
            </div>
            <div className="gene-label">
              <span className="mono">Q02388</span>
              <span>Collagen alpha-1(VII) chain</span>
              <span className="muted">Homo sapiens</span>
            </div>
          </div>
        </section>
        <section className="research-toolbar" aria-label="Research controls">
          <div className="research-toolbar-main">
            <div className="toolbar-provenance">
              <p className="snapshot-note"><strong>Snapshot prepared {data.snapshot?.preparedDate || "date not recorded"}</strong> · ClinVar release {data.sources.clinvar.releaseDate || "unknown"}</p>
              <p className="toolbar-mapping">Mapping: explicit protein HGVS → Q02388-1, residue checked · 1-based inclusive. <a href="#data-sources" onClick={() => { document.getElementById("source-methods").open = true; }}>Methods</a></p>
            </div>
            <div className="toolbar-actions">
              <button className="button" onClick={openShortlist} title={`Keep up to ${MAX_SHORTLIST} variants across filters; compare up to four`} aria-label={`Open research shortlist, ${(sharedShortlistIds ?? savedIds).length} variants`}>{sharedShortlistIds ? "Shared shortlist" : "Shortlist"} <span className="mono">{(sharedShortlistIds ?? savedIds).length}</span></button>
              <ShareViewButton url={viewUrl.href} />
              <button className="button reset-all" onClick={clear}>Reset all filters</button>
            </div>
          </div>
          <div className="research-toolbar-context">
            <span className="toolbar-count" aria-live="polite"><strong>{num(results.length)}</strong> matching variants</span>
            <div className="research-legend" aria-label="Clinical significance color legend">
              {Object.entries(GROUPS).map(([key, group]) => <span key={key} title={group.label}><i style={{ background: `var(--significance-${key})` }} />{key === "pathogenic" ? "Pathogenic / likely" : key === "uncertain" ? "VUS" : key === "benign" ? "Benign / likely" : group.short}</span>)}
            </div>
          </div>
          {savedState.notice && <p className="shortlist-status" role="status">{savedState.notice}</p>}
        </section>
          <section className="panel workspace-controls" aria-labelledby="filters-title">
            <h2 id="filters-title" className="sr-only">Filter the research workspace</h2>
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
            <p className="search-help sr-only" id="search-help">Search HGVS, rsIDs, conditions, or coordinates. Use <code>id:17423</code> for an exact variant ID, or <code>GRCh38 chr3:48566281</code> for a genomic position. Share this page’s URL to preserve your filters and selected evidence.</p>
            <div className="quick-filters">
              <button className="evidence-preset" aria-pressed={filters.review === MULTIPLE_SUBMITTERS_REVIEW}
                onClick={() => setFilter("review", filters.review === MULTIPLE_SUBMITTERS_REVIEW ? "" : MULTIPLE_SUBMITTERS_REVIEW)}>
                Multiple submitters, no conflicts
              </button>
            </div>
            <button className="filter-disclosure" aria-expanded={showFilters} aria-controls="advanced-filter-fields" onClick={() => setShowFilters(value => !value)}>
              More filters <span>{[filters.significance, filters.domain, filters.review, filters.mapping, filters.type].filter(Boolean).length || ""}</span><span aria-hidden="true">{showFilters ? "−" : "+"}</span>
            </button>
            <div className="advanced-filters" id="advanced-filter-fields" hidden={!showFilters}>
              <div className="filter-grid">
              <Select
                label="Clinical significance"
                value={filters.significance}
                onChange={(v) => setFilter("significance", v)}
                options={[...options.clinicalSignificance, { value: UNCLASSIFIED, label: "Not reported" }]}
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
            <div className="research-focus" aria-label="RDEB research filters">
              <Select label="Condition context" value={filters.condition} onChange={v => setFilter("condition", v)} options={CONDITION_OPTIONS} all="All source conditions" />
              <Select label="Molecular change (HGVS pattern)" value={filters.pattern} onChange={v => setFilter("pattern", v)} options={HGVS_PATTERN_OPTIONS} all="All HGVS patterns" />
              <p className="research-focus-note">Source labels and reported HGVS. Supports mapped and unmapped variants; protein-position filters still apply. <a href="#research-filter-methods" onClick={() => { document.getElementById("source-methods").open = true; }}>How these filters work</a></p>
              {filters.condition && <p className="research-focus-note">Matches explicit condition labels. Generic DEB and incomplete summaries may be missed; clinical significance remains the variant-level ClinVar aggregate.</p>}
              {filters.pattern === "splice-site" && <p className="research-focus-note">Splice-site ±1/2 SNVs often have no protein position. Clear mapped-only, domain, or residue-range filters to include unmapped records. This pattern does not establish a functional splice effect. {(filters.mapping === "mapped" || filters.domain || filters.range) && <button className="text-button" onClick={() => { setFilters(f => ({ ...f, mapping: "", domain: "", range: null })); setPage(0); }}>Clear protein-position filters</button>}</p>}
            </div>
            <div className="active-workspace-filters" aria-label="Active filters">
              {filters.query && <button onClick={() => setFilter("query", "")}>Search: {filters.query} ×</button>}
              {filters.significance && <button onClick={() => setFilter("significance", "")}>{filters.significance === UNCLASSIFIED ? "Not reported" : filters.significance} ×</button>}
              {filters.domain && <button onClick={() => setFilter("domain", "")}>{data.protein.domains.find(d => d.id === filters.domain)?.label} ×</button>}
              {filters.review && <button onClick={() => setFilter("review", "")}>Review: {filters.review} ×</button>}
              {filters.mapping && <button onClick={() => setFilter("mapping", "")}>{filters.mapping === "mapped" ? "Mapped" : "Unmapped"} ×</button>}
              {filters.type && <button onClick={() => setFilter("type", "")}>{filters.type} ×</button>}
              {filters.condition && <button onClick={() => setFilter("condition", "")}>{CONDITION_OPTIONS.find(option => option.value === filters.condition)?.label} ×</button>}
              {filters.pattern && <button onClick={() => setFilter("pattern", "")}>{HGVS_PATTERN_OPTIONS.find(option => option.value === filters.pattern)?.label} ×</button>}
              {filters.range && <button onClick={() => setFilter("range", null)}>aa {filters.range.join("–")} ×</button>}
            </div>
          </section>
        <ProteinMap
          protein={data.protein}
          variants={results}
          filters={filters}
          onFilter={setFilter}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="panel visual-summary-panel">
          <VisualSummary variants={results} allVariants={variants} protein={data.protein}
            filters={filters} onFilter={setFilter} onDomainClassification={setDomainClassification} />
        </div>
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
              title={`Export all ${num(results.length)} matching variants across every page`}
              onClick={() => exportCsv()}
              disabled={!results.length}
            >
              Export CSV <span aria-hidden="true">↓</span>
            </button>
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

            </div>
            <label>
              Sort by{" "}
              <select
                aria-label="Sort variants"
                value={sort}
                onChange={(e) => changeSort(e.target.value)}
              >
                {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          {renderPagination("Top")}
          <p className="table-scroll-hint" id="table-scroll-help">Scroll inside the table to browse this page of variants.</p>
          <div ref={tableScrollRef} className="table-scroll" role="region" aria-label="Variant results table; scroll vertically for rows and horizontally for all columns" aria-describedby="table-scroll-help" tabIndex={0}>
            <table>
              <caption className="sr-only">Filtered COL7A1 variants with clinical classifications, protein positions, conditions and source evidence.</caption>
              <thead>
                <tr>
                  <th scope="col" aria-sort={sortDirection(sort, ["hgvs"])}><SortColumnButton field="hgvs" sort={sort} onSort={changeSort}>Variant / HGVS</SortColumnButton></th>
                  <th scope="col" aria-sort={sortDirection(sort, ["significance"])}><SortColumnButton field="significance" sort={sort} onSort={changeSort}>Clinical significance</SortColumnButton></th>
                  <th scope="col" aria-sort={sortDirection(sort, ["review", "submitters"])}><div className="column-sort-pair"><SortColumnButton field="review" sort={sort} onSort={changeSort}>Review</SortColumnButton><span aria-hidden="true">/</span><SortColumnButton field="submitters" sort={sort} onSort={changeSort}>Submitters</SortColumnButton></div></th>
                  <th scope="col" aria-sort={sortDirection(sort, ["domain", "position"])}><div className="column-sort-pair"><SortColumnButton field="domain" sort={sort} onSort={changeSort}>Domain</SortColumnButton><span aria-hidden="true">/</span><SortColumnButton field="position" sort={sort} onSort={changeSort}>Position</SortColumnButton></div></th>
                  <th scope="col" aria-sort={sortDirection(sort, ["conditions"])}><SortColumnButton field="conditions" sort={sort} onSort={changeSort}>Conditions</SortColumnButton></th>
                  <th scope="col" aria-sort={sortDirection(sort, ["id"])}><SortColumnButton field="id" sort={sort} onSort={changeSort}>ClinVar</SortColumnButton></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="variant-row" data-variant-id={v.variationId} tabIndex={0}
                    aria-label={`View evidence for variation ${v.variationId}`} aria-haspopup="dialog"
                    onClick={event => openRow(event, v)}
                    onKeyDown={event => {
                      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault(); setSelected(v);
                      }
                    }}>
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
                      {v.research.patterns.some(pattern => pattern !== "unresolved") && <span className="research-pattern-label">{v.research.summary}</span>}
                    </td>
                    <td>
                      <Badge variant={v} />
                    </td>
                    <td><ReviewSummary variant={v} /></td>
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
                        title={v.conditions.map(conditionDisplayLabel).join("; ")}
                      >
                        {v.conditions[0] ? conditionDisplayLabel(v.conditions[0]) : "Not reported"}
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
                      <button className="text-button save-variant" aria-pressed={savedSet.has(v.variationId)}
                        aria-label={`${savedSet.has(v.variationId) ? "Remove" : "Save"} variant ${v.variationId} ${savedSet.has(v.variationId) ? "from" : "to"} shortlist`}
                        onClick={() => toggleSaved(v.variationId)}>{savedSet.has(v.variationId) ? "✓ Saved" : "+ Save"}</button>
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
          data={data}
          viewUrl={viewUrl.href}
          saved={savedSet.has(selected.variationId)}
          onToggleSaved={() => toggleSaved(selected.variationId)}
          saveNotice={savedState.notice}
          onClose={() => setSelected(null)}
        />
      )}
      {showShortlist && <VariantShortlist key={sharedShortlistIds ? "shared" : "saved"} variants={sharedVariants ?? savedVariants} protein={data.protein} data={data}
        shared={sharedShortlistIds !== null} onOpenSaved={() => setSharedShortlistIds(null)}
        storageNotice={savedState.notice} onClose={() => setShowShortlist(false)} onRemove={id => sharedShortlistIds !== null ? setSharedShortlistIds(ids => ids.filter(value => value !== id)) : toggleSaved(id)}
        onOpenVariant={variant => { setShowShortlist(false); setSelected(variant); }}
        onExport={(items, kind) => exportCsv(items, kind === "comparison" ? "col7a1-comparison-variants.csv" : "col7a1-shortlist-variants.csv")} shareUrlFor={shortlistUrl} />}
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
