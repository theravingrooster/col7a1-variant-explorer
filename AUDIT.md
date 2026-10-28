# Website review — October 27, 2026

Scope: deployed COL7A1 explorer, React UI, search/filter/export logic, protein/source provenance, build output, dependencies and hosting headers. Baseline: `18f36f23b936aa0acf987c1a1c81472d91c1b4ca`.

## Findings and implemented changes

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | Valid dbSNP, ClinGen, accession-qualified HGVS and standard genomic coordinate searches returned no records. | Index retained source identifiers; add exact ID/allele and assembly-consistent genomic interval queries. |
| High | A structurally malformed dataset could pass the superficial version check and crash the UI. | Shared build/browser schema and consistency checks, recoverable error display and a 30-second request timeout. |
| Medium | Verification crashed when the excluded original ClinVar archive was absent. | Explicit committed-snapshot verification, complete row/hash/normalization checks, and actionable full-source errors. Validation also remains active under optimized Python. |
| Medium | Small text and clinical badges had insufficient contrast. | Darken text within the original palette; enlarge table metadata and increase primary control target sizes. |
| Medium | 118 histogram bars preceded search in the keyboard tab order; selected controls lacked accessible state. | One histogram tab stop with arrow/Home/End navigation, pressed states, interactive SVG group semantics, and a skip-to-variants link. |
| Medium | Next page left the new first result thousands of pixels above the viewport. | Upper and lower pagination, with focus and scroll returned to the results heading. |
| Medium | Clicking dialog padding dismissed the evidence; focus/scroll restoration was implicit. | Close only on actual backdrop clicks, explicitly restore opener focus, and lock background scrolling. |
| Medium | Header methods link left the methods disclosure closed. | Open on link activation or direct fragment navigation; show correct disclosure symbol. |
| Medium | Shared/reloaded links lost filters, sorting, pagination and selected evidence. | Validated URL state and variant permalinks. |
| Low | Snapshot age and fixed nature were hidden from the main workflow. | Prominent fixed-snapshot preparation date and source/interpretation limits. |
| Low | Evidence download label implied only the selected record, but downloaded every source row. | Rename to “Download all source rows.” |
| Low | Rebuilding preserved obsolete output files. | Clean output after successful input validation. |
| Hardening | Static site had only minimal response security headers. | Same-origin script/connect CSP, framing prevention and restrictive device permissions. |

## Evidence

- All 18 Python and 24 JavaScript unit/regression tests pass (42 total).
- All 13,036 committed ClinVar rows and hashes verify; all 6,522 normalized variants reproduce exactly, including 4,268 mapped protein records.
- Production build passes; committed processed JSON, TSV and UniProt source are unchanged and copied byte-for-byte to the build.
- Runtime dependency audit reports zero known vulnerabilities at review time (`npm audit --omit=dev`).
- Baseline live browser review exercised search, combined filters, histogram filtering, reset/empty state, sorting/pagination, evidence dialogs, CSV and source downloads. No application console errors were observed.
- Hosted review build manually verified: genomic interval search (two overlapping records at GRCh38 chr3:48566281), exact variant search, evidence dialog and focus restoration, variant/filter/sort/page persistence through reload, one chart tab stop with arrow-key selection, 25 Pathogenic+NC2 records, empty-state recovery and disabled export, and methods disclosure navigation. No application console errors observed (browser-extension errors excluded).
- Hosted interaction exposed ambiguous native select-label matching; each filter now has an explicit accessible name matching its visible label.
- Eleven repeatable browser regression cases were added, including mobile widths and failure recovery. They were **not executed successfully in this workspace**: the local browser process was blocked by the execution environment’s socket restriction. A syntax check is not an end-to-end test result.

## Limits and future work

- The excluded original ClinVar archive is required to prove extraction completeness independently. Snapshot verification confirms internal consistency and reproduction, not that no source record was omitted.
- ClinVar release date is absent from the supplied file. Preparation/deployment dates must not be represented as source release dates. The site does not automatically refresh.
- Positional mapping and domain overlap are not clinical interpretation. Original mapping rules and classifications were preserved.
- Actual mobile rendering, full automated browser execution and assistive-technology behavior require confirmation in an environment that allows browser automation. Responsive styles were reviewed; do not treat that as device testing.
- The full 13 MB research JSON is still loaded once per session. A versioned, lightweight index with lazy evidence loading is a possible future performance improvement; it should preserve exports and source integrity.


## Research workflow update — October 28, 2026

- Promoted the protein map into a larger primary workspace with domain/range zoom, adaptive density, individual variant markers, hover/focus evidence, keyboard navigation, and explicit unmapped access.
- Retained both synchronized summary charts between the map and table.
- Added source submitter counts without summing assembly duplicates; exact review-status preset and dedicated evidence column. Detail view groups key facts and preserves expanded provenance.
- Added structured preparation-date metadata, preserving the original preparation date and unknown ClinVar release date.
- Enriched filtered CSV with submitter counts and snapshot/mapping provenance.
- 72 unit/regression tests pass; production build and complete committed-snapshot verification pass (13,036 rows; 6,522 variants; 4,268 mappings).
- Browser regression suite expanded to 20 cases. The local browser process remains unavailable in this execution environment; hosted browser interaction is checked separately.

Hosted preview verified: exact 928-record no-conflicts preset; NC2 (225) and NC2+Pathogenic (25) filtering; residues 2790–2810 (26 markers) and invalid-range recovery; keyboard marker tooltip and evidence dialog; explicit 2,254-record unmapped access; URL/theme reload; light/dark map and detail rendering. Downloaded CSVs were parsed and checked against all expected IDs for the 26-record range and the 928-record multi-page review cohort, including source submitter counts and dates.


## Coordinated interaction update — October 28, 2026

- Fixed inconsistent chart/dropdown domain transitions that retained a stale range or unmapped-only filter. Shared pure transitions now coordinate every entry point.
- Added source-position SVG tracks alongside density and rich region/subdomain tooltips with bounded example evidence.
- Added persistent reset/share/legend/snapshot controls, row activation, full source HGVS and exact feature boundaries in evidence.
- 81 unit/regression tests pass; build and complete snapshot verification pass. Source data is unchanged. Browser suite expanded to 25 scenarios; local automated execution remains unavailable under the existing environment restriction.

Hosted preview verified: subdomain selection (VWFA 1, 249 records); narrow residue range replaced by an NC2 chart selection (225 records); grouped NC2+Pathogenic selection (25 records); density and position-track zoom to residues 1–25 (41 individual markers), then clinical-significance filtering (5 pathogenic records). Region and marker evidence tooltips, marker/row keyboard activation, dialog focus restoration, full source HGVS, exact NC2 boundaries, direct evidence links, copied cohort/variant URLs, filter reload, pinned controls, and dark-mode rendering were checked. The downloaded 25-record CSV matched every expected source ID and retained the evidence/provenance columns. No application console warnings or errors were observed. Final review fixed mobile clipboard-fallback anchoring and dismisses keyboard tooltips on intentional scrolling; mobile rendering remains unverified in this environment.

## Visual simplification and linked protein schematic

- Replaced the tall, multicolored density/position-track stack with a compact map that puts protein regions above a neutral density plot. Significance coloring remains available on demand; zoomed sets retain individual colored markers and evidence.
- Added an illustrative rotating homotrimer beside the map. The existing UniProt region boundaries link major regions, subdomains, bins and individual residues in both directions. The schematic is explicitly not a resolved structure or to scale; the signal peptide is outside the depicted mature homotrimer.
- Kept animation to 18 SVG paths with direct updates, slow rotation, pause/manual-angle controls, reduced-motion defaults, and offscreen/background pausing. No dependencies, external assets or data sources were added.
- Removed duplicate statistics, compacted the search/filter strip, and switched summaries to accessible tabs. Domain comparison now uses three horizontal stacked rows with exact-count controls for tiny segments.
- Fixed a stale focused-schematic region overriding a subsequent map hover; the shared parent interval is authoritative.
- 86 unit/regression tests and the production build pass. The browser suite now contains 28 scenarios, including linked hover/focus and reduced motion; automated browser execution and mobile device rendering remain unverified under the existing environment restriction.
- Hosted desktop previews verified the compact layout in light/dark themes, actual geometry rotation, pause/resume/manual angle, offscreen animation pausing, map-to-schematic focus, schematic-to-map focus and click filtering (NC2: 225), grouped NC2+Pathogenic filtering (25), summary keyboard tabs, optional significance colors without count changes, exact range 2790–2810 (26 markers), residue-2791 marker highlighting and evidence activation, and classification plus consensus filtering (203). No application console warnings/errors or page-wide horizontal overflow were observed. Source files remain unchanged.
