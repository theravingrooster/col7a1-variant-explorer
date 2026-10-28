import React, { useMemo } from "react";
import { classificationSummary, domainSummary, chartCoverage } from "./chart-data.mjs";
import { formatNumber as num } from "./data-utils.mjs";

const SHORT_LABELS = {
  pathogenic: "P", "likely-pathogenic": "LP", "pathogenic-combined": "P/LP",
  uncertain: "VUS", conflicting: "Conf.", benign: "B", "likely-benign": "LB",
  "benign-combined": "B/LB", other: "NC", "not-reported": "NR",
};
const color = (category) => `var(--classification-${category.tone}, ${category.color})`;

export default function VisualSummary({ variants, allVariants, protein, filters, onFilter, onDomainClassification, onClear }) {
  const categories = useMemo(() => classificationSummary(variants, allVariants), [variants, allVariants]);
  const domains = useMemo(() => domainSummary(variants, protein.domains, categories), [variants, protein.domains, categories]);
  const coverage = useMemo(() => chartCoverage(variants, protein.domains), [variants, protein.domains]);
  const maxClassification = Math.max(1, ...categories.map(c => c.count));
  const maxDomain = Math.max(1, ...domains.flatMap(d => d.series.map(c => c.count)));
  const hasFilters = Object.values(filters).some(Boolean);
  const selectedCategory = categories.find(c => c.key === filters.significance);
  const selectedDomain = protein.domains.find(d => d.id === filters.domain);
  return (
    <section className="summary-panel" aria-labelledby="summary-title">
      <div className="summary-heading">
        <div>
          <p className="eyebrow">VISUAL SUMMARY</p>
          <h3 id="summary-title">Current results at a glance</h3>
          <p><strong>{num(variants.length)}</strong> variants across all pages. Counts reflect every current filter. Selecting a bar replaces its classification or domain filter; select it again to clear it.</p>
        </div>
        {hasFilters && <button className="button" onClick={onClear}>Reset all filters</button>}
      </div>
      <div className="summary-filter-chips">
        {selectedCategory && <button onClick={() => onFilter("significance", "")} aria-label="Clear clinical significance filter">{selectedCategory.label} ×</button>}
        {selectedDomain && <button onClick={() => onFilter("domain", "")} aria-label="Clear protein domain filter">{selectedDomain.label} ×</button>}
        {filters.range && <button onClick={() => onFilter("range", null)} aria-label="Clear residue range filter">aa {filters.range.join("–")} ×</button>}
      </div>
      {!variants.length && <p className="summary-empty" role="status">No variants match the current filters. Broaden the filters to repopulate these charts.</p>}
      <div className="summary-chart-grid">
        <article className="summary-card" aria-labelledby="classification-chart-title">
          <div className="chart-card-heading">
            <h4 id="classification-chart-title">Clinical significance</h4>
            <span className="chart-axis">Number of variants</span>
          </div>
          <div className="classification-bars" role="group" aria-label="Variant counts by clinical significance">
            {categories.map(c => (
              <button key={c.key} className="chart-row" aria-pressed={filters.significance === c.key}
                aria-label={`Filter ${c.label}: ${num(c.count)} variants in current results`}
                title={`${c.label}: ${num(c.count)} variants`}
                onClick={() => onFilter("significance", filters.significance === c.key ? "" : c.key)}>
                <span className="chart-label"><i style={{ background: color(c) }} />{c.label}</span>
                <span className="chart-track" aria-hidden="true"><span className="chart-fill" style={{ width: `${100 * c.count / maxClassification}%`, background: color(c) }} /></span>
                <strong className="chart-count">{num(c.count)}</strong>
              </button>
            ))}
          </div>
          <div className="chart-scale" aria-hidden="true"><span /><span><span>0</span><span>{num(Math.max(0, ...categories.map(c => c.count)))}</span></span><span /></div>
          <p className="chart-note">Source classifications are kept separate, including combined labels. “Not reported” means the source has no classification.</p>
        </article>
        <article className="summary-card" aria-labelledby="domain-chart-title">
          <div className="chart-card-heading">
            <h4 id="domain-chart-title">Protein domain × significance</h4>
            <span className="chart-axis">Shared scale: 0–{num(Math.max(0, ...domains.flatMap(d => d.series.map(c => c.count))))} variants per bar</span>
          </div>
          <div className="domain-groups" role="group" aria-label="Variant counts by protein domain and clinical significance">
            {domains.map(d => (
              <div className="domain-group" key={d.id}>
                <div className="domain-group-heading">
                  <button className="domain-chart-filter" aria-pressed={filters.domain === d.id}
                    aria-label={`Filter ${d.label} domain: ${num(d.total)} variants in current results`}
                    onClick={() => onFilter("domain", filters.domain === d.id ? "" : d.id)}>{d.label}<span>aa {num(d.start)}–{num(d.end)}</span></button>
                  <strong>{num(d.total)} <span>variants</span></strong>
                </div>
                <div className="domain-plot-scroll" role="region" tabIndex={0} aria-label={`${d.label} classification bars; scroll horizontally for all categories`}>
                <div className="domain-bar-plot" style={{ "--category-count": categories.length }}>
                  {d.series.map(c => (
                    <button key={c.key} className="domain-chart-bar"
                      aria-label={`Filter ${d.label} and ${c.label}: ${num(c.count)} variants in current results`}
                      aria-pressed={filters.domain === d.id && filters.significance === c.key}
                      title={`${d.label} · ${c.label}: ${num(c.count)} variants`}
                      onClick={() => onDomainClassification(d.id, c.key)}>
                      <span className="domain-bar-value">{num(c.count)}</span>
                      <span className="domain-bar-track" aria-hidden="true"><span style={{ height: `${100 * c.count / maxDomain}%`, background: color(c) }} /></span>
                      <span className="domain-bar-label">{SHORT_LABELS[c.tone] || c.label}</span>
                    </button>
                  ))}
                </div>
                </div>
              </div>
            ))}
          </div>
          <p className="chart-scroll-hint">Scroll each group sideways to see all classifications →</p>
          <p className="chart-note">Domain totals count unique variants. <strong>{num(coverage.unmapped)}</strong> unmapped and <strong>{num(coverage.outsideMajorDomains)}</strong> mapped outside these three regions are retained in the table.</p>
        </article>
      </div>
      <div className="chart-legend" aria-label="Classification abbreviations">
        {categories.map(c => <span key={c.key}><i style={{ background: color(c) }} /><strong>{SHORT_LABELS[c.tone] || c.label}</strong> {c.label}</span>)}
      </div>
      {(coverage.spanningDomains > 0 || coverage.multipleClassifications > 0) && <p className="chart-note">A variant can appear in more than one domain or source classification. Category counts may overlap and should not be summed to estimate unique variants.</p>}
    </section>
  );
}
