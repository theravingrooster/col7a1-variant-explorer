import React from "react";
import { formatNumber as num } from "./data-utils.mjs";
import "./protein-reference.css";

const paperUrl = "https://pubmed.ncbi.nlm.nih.gov/8051117/";
const reportedLengths = { "Signal peptide": "16 (predicted)", NC1: "1,253", Collagenous: "1,530", NC2: "161" };
const span = domain => domain.end - domain.start + 1;
const interval = domain => `${num(domain.start)}–${num(domain.end)}`;
function SourceLink({ href, children }) {
  return <a href={href} target="_blank" rel="noreferrer">{children} <span aria-hidden="true">↗</span></a>;
}

export default function ProteinReference({ protein }) {
  const regions = protein.domains.filter(domain => domain.level !== "subdomain").sort((a, b) => a.start - b.start);
  const subdomains = protein.domains.filter(domain => domain.level === "subdomain");
  return <section className="protein-reference" id="protein-reference" aria-labelledby="protein-reference-title">
    <h3 id="protein-reference-title">Protein length & region references</h3>
    <div className="protein-primary-paper">
      <p className="eyebrow">FOUNDATIONAL COMPLETE-SEQUENCE PAPER</p>
      <h4><SourceLink href={paperUrl}>Cloning of human type VII collagen. Complete primary sequence of the α1(VII) chain and identification of intragenic polymorphisms.</SourceLink></h4>
      <p>Christiano AM, Greenspan DS, Lee S, Uitto J. <em>Journal of Biological Chemistry</em> 269:20256–20262 (1994).</p>
      <p className="protein-reference-links"><SourceLink href={paperUrl}>PubMed · 8051117</SourceLink><SourceLink href="https://doi.org/10.1016/S0021-9258(17)31984-1">DOI / full text</SourceLink></p>
    </div>
    <p>The paper establishes the 2,944-residue precursor and NC1–collagenous–NC2 organization. Exact map endpoints follow <SourceLink href={protein.url}>UniProt {protein.accession}-1</SourceLink>, sequence version {protein.entryAudit.sequenceVersion}, entry version {protein.entryAudit.entryVersion}. All coordinates below are 1-based and inclusive; length = end − start + 1.</p>
    <div className="protein-reference-table-wrap" role="region" aria-label="Protein region coordinate comparison" tabIndex={0}>
      <table className="protein-reference-table">
        <caption>Current map versus the 1994 paper · checked October 28, 2026</caption>
        <thead><tr><th scope="col">Region</th><th scope="col">Map coordinates</th><th scope="col">Map length (aa)</th><th scope="col">Paper length (aa)</th></tr></thead>
        <tbody>
          <tr><th scope="row">Full precursor</th><td className="mono">1–{num(protein.length)}</td><td>{num(protein.length)}</td><td>2,944</td></tr>
          {regions.map(domain => <tr key={domain.id}><th scope="row">{domain.label}</th><td className="mono">{interval(domain)}</td><td>{num(span(domain))}</td><td>{reportedLengths[domain.label] || "Not compared"}</td></tr>)}
        </tbody>
      </table>
    </div>
    <div className="protein-boundary-note">
      <strong>Full protein length agrees; region boundaries differ.</strong>
      <p>The paper reports NC1 as 1,253 aa (p. 20257). Here, residues 1–16 are shown separately as the signal peptide, leaving 1,237 aa in NC1; signal + NC1 totals 1,253.</p>
      <p>The paper reports 1,530 aa for the collagenous region (p. 20259) and 161 aa for NC2 (p. 20260). A terminal 161-aa region implies 2784–2944, whereas UniProt starts NC2 at 2785. The map retains UniProt’s boundary; residue 2784 stays collagenous. These exact boundaries are not presented as identical to the paper.</p>
    </div>
    <p>Earlier primary work: <SourceLink href="https://pubmed.ncbi.nlm.nih.gov/1307247/">Christiano et al., 1992 · NC1 architecture</SourceLink>; <SourceLink href="https://pubmed.ncbi.nlm.nih.gov/8499916/">Greenspan, 1993 · NC2, reported as 161 aa</SourceLink>.</p>
    <details className="protein-subdomain-references">
      <summary>Exact subdomain coordinates & evidence ({subdomains.length})</summary>
      <p>These boundaries are UniProt PROSITE-ProRule sequence annotations (ECO:0000255), not experimentally established endpoints from the 1994 paper. The source’s three major-region features carry no per-feature publication citation.</p>
      <div className="protein-reference-table-wrap" role="region" aria-label="UniProt subdomain coordinates" tabIndex={0}>
        <table className="protein-reference-table">
          <thead><tr><th scope="col">Subdomain</th><th scope="col">Precursor coordinates</th><th scope="col">Length (aa)</th></tr></thead>
          <tbody>{subdomains.map(domain => <tr key={domain.id}><th scope="row">{domain.label}</th><td className="mono">{interval(domain)}</td><td>{num(span(domain))}</td></tr>)}</tbody>
        </table>
      </div>
      <p>All displayed intervals were checked against the bundled <a href="./data/Q02388.json" download>UniProt source JSON</a>. The protein drawing remains an illustrative schematic, not a resolved structure or physical scale model.</p>
    </details>
  </section>;
}
