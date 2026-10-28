import React, { useMemo, useState } from "react";
import { classificationSummary, domainSummary, chartCoverage } from "./chart-data.mjs";
import { formatNumber as num } from "./data-utils.mjs";

const color = (category) => `var(--classification-${category.tone}, ${category.color})`;
const TABS = ["clinical", "domain"];

export default function VisualSummary({ variants, allVariants, protein, filters, onFilter, onDomainClassification }) {
  const [tab, setTab] = useState("clinical");
  const categories = useMemo(() => classificationSummary(variants, allVariants), [variants, allVariants]);
  const domains = useMemo(() => domainSummary(variants, protein.domains, categories), [variants, protein.domains, categories]);
  const coverage = useMemo(() => chartCoverage(variants, protein.domains), [variants, protein.domains]);
  const maxClassification = Math.max(1, ...categories.map(c => c.count));
  const maxAssignments = Math.max(1, ...domains.map(d => d.series.reduce((total, c) => total + c.count, 0)));
  function navigateTabs(event, current) {
    const index = TABS.indexOf(current);
    const next = event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length]
      : event.key === "ArrowLeft" ? TABS[(index + TABS.length - 1) % TABS.length]
      : event.key === "Home" ? TABS[0] : event.key === "End" ? TABS[TABS.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`summary-tab-${next}`)?.focus();
  }
  return (
    <section className="summary-panel" aria-labelledby="summary-title">
      <div className="summary-heading">
        <div>
          <h2 id="summary-title">Cohort summary</h2>
          <p><strong>{num(variants.length)}</strong> matching variants · Select a bar to filter; select it again to clear.</p>
        </div>
        <div className="summary-tabs" role="tablist" aria-label="Summary charts">
          {TABS.map(key => <button key={key} id={`summary-tab-${key}`} role="tab" type="button"
            aria-selected={tab === key} aria-controls={`summary-${key}-panel`} tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)} onKeyDown={event => navigateTabs(event, key)}>
            {key === "clinical" ? "Clinical significance" : "Domain comparison"}
          </button>)}
        </div>
      </div>
      {!variants.length && <p className="summary-empty" role="status">No variants match these filters. Reset or broaden the selection to repopulate the charts.</p>}
      <div id="summary-clinical-panel" role="tabpanel" aria-labelledby="summary-tab-clinical" hidden={tab !== "clinical"}>
        <div className="classification-bars" role="group" aria-label="Variant counts by clinical significance">
          {categories.map(c => (
            <button key={c.key} className={`chart-row${c.count ? "" : " is-zero"}`} aria-pressed={filters.significance === c.key}
              aria-label={`Filter ${c.label}: ${num(c.count)} variants in current results`}
              title={`${c.label}: ${num(c.count)} variants`}
              onClick={() => onFilter("significance", filters.significance === c.key ? "" : c.key)}>
              <span className="chart-label"><i style={{ background: color(c) }} />{c.label}</span>
              <span className="chart-track" aria-hidden="true"><span className="chart-fill" style={{ width: `${100 * c.count / maxClassification}%`, background: color(c) }} /></span>
              <strong className="chart-count">{num(c.count)}</strong>
            </button>
          ))}
        </div>
        <p className="chart-note">Counts across all pages. Source labels, including combined classifications, remain separate.</p>
      </div>
      <div id="summary-domain-panel" role="tabpanel" aria-labelledby="summary-tab-domain" hidden={tab !== "domain"}>
        <div className="domain-chart-intro"><span>Classification counts by domain</span><span>Shared scale · 0–{num(Math.max(0, maxAssignments))}</span></div>
        <div className="domain-groups" role="group" aria-label="Variant counts by protein domain and clinical significance">
          {domains.map(d => (
            <div className="domain-group" key={d.id}>
              <div className="domain-group-heading">
                <button className="domain-chart-filter" aria-pressed={filters.domain === d.id}
                  aria-label={`Filter ${d.label} domain: ${num(d.total)} variants in current results`}
                  onClick={() => onFilter("domain", filters.domain === d.id ? "" : d.id)}>{d.label}<span>aa {num(d.start)}–{num(d.end)}</span></button>
                <strong>{num(d.total)} <span>unique variants</span></strong>
              </div>
              <div className="domain-stack-track" aria-label={`${d.label} classification counts`}>
                {d.series.filter(c => c.count > 0).map(c => (
                  <button key={c.key} className="domain-chart-bar" style={{ width: `${100 * c.count / maxAssignments}%`, background: color(c) }}
                    aria-label={`Filter ${d.label} and ${c.label}: ${num(c.count)} variants in current results`}
                    aria-pressed={filters.domain === d.id && filters.significance === c.key}
                    title={`${d.label} · ${c.label}: ${num(c.count)} variants`}
                    onClick={() => onDomainClassification(d.id, c.key)}>
                    <span className="sr-only">{c.label}: {num(c.count)}</span>
                  </button>
                ))}
                {!d.total && <span className="domain-no-results">No variants in this selection</span>}
              </div>
              {d.total > 0 && <details className="domain-exact-counts">
                <summary>Exact counts & filters</summary>
                <div className="domain-count-list">
                  {d.series.filter(c => c.count > 0).map(c => <button key={c.key}
                    aria-label={`Select ${d.label} and ${c.label}: ${num(c.count)} variants`}
                    aria-pressed={filters.domain === d.id && filters.significance === c.key}
                    onClick={() => onDomainClassification(d.id, c.key)}>
                    <i style={{ background: color(c) }} /><span>{c.label}</span><strong>{num(c.count)}</strong>
                  </button>)}
                </div>
              </details>}
            </div>
          ))}
        </div>
        <details className="classification-key">
          <summary>Classification color key</summary>
          <div className="chart-legend" aria-label="Exact classification colors">
            {categories.map(c => <span key={c.key}><i style={{ background: color(c) }} />{c.label}</span>)}
          </div>
        </details>
        <p className="chart-note">Selecting a domain replaces the current region or residue range. <strong>{num(coverage.unmapped)}</strong> unmapped and <strong>{num(coverage.outsideMajorDomains)}</strong> variants outside these domains remain in the table.</p>
      </div>
      {(coverage.spanningDomains > 0 || coverage.multipleClassifications > 0) && <p className="chart-note">A variant can appear in more than one domain or source classification. Bar counts may overlap; domain totals count unique variants.</p>}
    </section>
  );
}
