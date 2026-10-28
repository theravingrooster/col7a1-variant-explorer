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
