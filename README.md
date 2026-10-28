# COL7A1 variant explorer

A static React research explorer built entirely from the supplied local ClinVar and UniProt files. No API, database, remote fonts, analytics, or runtime data requests to external services. ClinVar and UniProt links open only when clicked.

- Live site: [col7a1-variant-explorer.vercel.app](https://col7a1-variant-explorer.vercel.app)
- Repository: [theravingrooster/col7a1-variant-explorer](https://github.com/theravingrooster/col7a1-variant-explorer)
- Vercel project: [Elenchus / col7a1-variant-explorer](https://vercel.com/elenchus/col7a1-variant-explorer)

This is a **fixed data snapshot**, prepared from local files on **2026-10-27**. That is the preparation date, not a verified ClinVar release cutoff. The ClinVar file does not state its release date; the UniProt entry reports an annotation update of **2026-09-02**. The website does not refresh automatically when either source changes.

## Run and build

Node.js 22+ and Python 3.9+ are sufficient. Install the pinned dependencies with `npm ci`.

```sh
npm run dev          # build and serve at http://127.0.0.1:3000
npm run build        # static site in dist/
npm test             # processor, schema, search/filter/export, and URL-state tests
npm run verify:snapshot # validate all committed rows, variants, and mappings
npm run verify:data  # full comparison, requires the original ClinVar archive
```

The local server rebuilds at startup, not on file changes; restart after editing. On a new machine, install the pinned packages with `npm ci` first (requires cached packages or network access). `dist/` is self-contained and can also be served by `python3 -m http.server 3000 --directory dist` without Node dependencies.

For Vercel, use framework **Other**, build command `npm run build`, and output directory `dist` (also set in `vercel.json`). The preprocessed `public/data/` files and `Q02388.json` are committed. The 435 MB ClinVar archive is excluded from Git and Vercel uploads; keep it locally for full source verification. Production builds consume the already processed JSON; they do not regenerate it.

## Redeploying and updating the snapshot

The GitHub production branch is `main`. With the repository connected to Vercel, pushing to `main` triggers a new production deployment:

```sh
npm test
npm run build
git add README.md src scripts tests public Q02388.json index.html package.json package-lock.json vercel.json .gitignore .vercelignore
git commit -m "Update COL7A1 explorer"
git push origin main
```

Check the project's **Deployments** tab in Vercel and wait for **Ready**. To rebuild the same commit without changing files, open its deployment menu and choose **Redeploy**. Vercel retains previous deployments for rollback.

You can also ask ChatGPT to commit and publish changes through the connected GitHub integration; Vercel deploys those `main` updates in the same way. The initial publication used that integration. A ChatGPT connection does not automatically sign the local Git command-line client into GitHub, so the terminal `git push` route requires Git authentication on that machine.

To publish a newer data snapshot, first replace the local source files, run `npm run data`, `npm run verify:data`, `npm test`, and `npm run build`, and update the preparation date and source/version notes here. Commit the regenerated `public/data/` files and `Q02388.json`, then push. Never substitute the deployment date for a source release date. The complete ClinVar archive is needed for regeneration and full verification but is not needed by the hosted site.

## Sources and reproducibility

- `variant_summary.txt.gz`: local ClinVar variant summary, 9,312,744 data rows scanned. Exact `COL7A1` tokens in `GeneSymbol` yield **13,036 rows / 6,522 distinct variation IDs**, including records that also mention other genes. The source does not identify its release date. `LastEvaluated` is a per-record field.
- `Q02388.json`: local UniProt COL7A1 entry, version 260, annotation update 2026-09-02, sequence version 2. The precursor sequence has **2,944 residues**.
- `public/data/variants.json`: frontend dataset, with `sources`, `processing`, `summary`, `protein`, and `variants` objects. File SHA-256 hashes and the processor hash are embedded. `protein` includes the full sequence, 12 subdomains, major regions, and additional region/motif annotations with JSON pointers into UniProt.
- `public/data/clinvar-col7a1.tsv`: unchanged matching ClinVar fields, prefixed by `SourceLine` and `SourceRowSHA256`. Line numbers refer to the decompressed original file, with the header on line 1. Row hashes exclude line endings. The source hash refers to the original compressed file.

Regenerate deterministically with `npm run data`. For an uncompressed or filtered summary with the same column headers:

```sh
python3 scripts/process_data.py --clinvar variant_summary.txt --prepared-date YYYY-MM-DD
npm run verify:data
```

Use a source file in the project root. Every variation preserves its allele IDs, source rows, clinical classifications, review status, conditions, HGVS names, and assembly-specific genomic positions. Duplicate GRCh37/GRCh38 rows are grouped by VariationID. Missing positions use `null`; no missing values are silently converted to zero. Condition summaries such as “7 conditions” remain verbatim.

`verify:data` checks file and row hashes, independently scans the source gene column, compares **every** matching source row, reproduces every normalized variant, and checks sequence/domain coordinates. `npm test` covers uncertain HGVS, reference mismatches, frameshift anchors, boundary overlaps, assembly deduplication, search, filters, and CSV output.

## Protein mapping

All coordinates are **1-based, inclusive**, on the UniProt precursor sequence, including its signal peptide:

| Region | Residues |
| --- | --- |
| Signal peptide | 1–16 |
| NC1 | 17–1253 |
| Collagenous / triple-helical | 1254–2784 |
| NC2 | 2785–2944 |

These boundaries are copied from local UniProt features. A variant maps only when its explicit protein HGVS has a RefSeq accession linked to the canonical Q02388-1 entry locally, coordinates within the sequence, and matching reference residues at its endpoints. Intervals map to every overlapping domain. No coding-to-protein or genomic-to-protein conversion is attempted without transcript/CDS data.

**4,268 variants map; 2,254 remain unmapped.** Of these, 2,252 lack protein HGVS; one refers to stop codon 2945 outside the protein sequence; one uses unsupported repeat notation. Each has a machine-readable reason. Frameshifts map only their reported anchor, and stop-gain variants their reported residue—not all downstream affected domains. Residue checks are not a full transcript alignment or clinical interpretation.

Example: variation **17423**, `c.8393T>A (p.Met2798Lys)`, maps to **NC2** at residue **2798**. Its source evidence is on original lines **31733–31734**.

### Protein length and primary references

[Christiano et al. (1994), *Cloning of human type VII collagen. Complete primary sequence of the alpha 1(VII) chain and identification of intragenic polymorphisms*](https://pubmed.ncbi.nlm.nih.gov/8051117/) establishes the **2,944-amino-acid precursor** and its NC1–collagenous–NC2 organization. The earlier [Greenspan (1993) carboxyl-terminal sequence paper](https://pubmed.ncbi.nlm.nih.gov/8499916/) describes NC2.

The historical lengths and today's exact feature intervals are not identical: the 1994 paper reports **1,530 residues** for the collagenous region and **161** for NC2; the retained UniProt Q02388-1 intervals give **1,531** and **160**, respectively. This one-residue junction difference is documented, not assumed to be a proven sequence correction. The site preserves its canonical source mapping: residue **Ala2784** remains collagenous. NC1 spans **1,237 residues** (17–1253); adding the separately displayed 16-residue signal peptide gives the 1,253-residue N-terminal portion.

The 12 precise subdomain intervals are UniProt **PROSITE-ProRule computational annotations** (`ECO:0000255`), not experimentally measured boundaries asserted by the 1994 paper. All displayed coordinates and evidence arrays are verified against the archived UniProt JSON; primary papers explain the scientific architecture, while that snapshot defines the site's exact mapping convention.

## Interface

Search HGVS, IDs, conditions, or genomic coordinates; combine classification, domain, review, mapping, and type filters. The primary workspace places a large interactive 3D domain schematic above a full-width residue map. The map starts with 50-residue density bins stacked by clinical-significance group. A nearby legend shows the mapped counts for each group under the current filters; each bin tooltip provides a numeric breakdown. Selecting a domain or bin filters the workspace and zooms to that region; a custom inclusive residue range is also available. Smaller filtered sets (at most 180 variants, with collision-safe marker lanes) display individual colored markers. Hover or keyboard focus shows HGVS, clinical significance, review status and submitter count; clicking or pressing Enter opens evidence. Dense sets remain binned. Intervals crossing the visible boundary count once at its left edge; hollow markers indicate a clipped start. Open a variant to inspect source lines and hashes. Exact searches support `id:17423`, `allele:32462`, `rs121912828`, accession-qualified HGVS, and assembly-specific coordinates such as `GRCh38 chr3:48566281`. Coordinate searches use inclusive interval overlap and keep assembly/reference matching on the same source record. Plain text searches retain their original partial-match behavior.

Filters, sorting, page, and selected evidence are stored in the URL, so views can be bookmarked or shared. Unknown or malformed URL values are ignored. A skip link and arrow-key chart navigation make the explorer usable without tabbing through every bar. The table scrolls inside a bounded viewport with sticky column headers; changing filters, sort or page returns its rows to the top, while evidence dialogs preserve the scroll position. Pagination is available above and below the table and returns focus to the results heading.

Click any table column heading to sort ascending; click again to reverse. Review/submitters and domain/position have separate heading controls. Text uses natural alphabetical order, not clinical severity or evidence quality. Submitter sorting uses the highest reported source count without adding source counts together. Missing values stay last in either direction, with Variation ID as a stable tie-break. The entire filtered cohort is sorted before pagination, and the selected order persists in shared URLs.

Condition names use a small, explicit display synonym: the complete source term “Epidermolysis bullosa dystrophica” appears as “Dystrophic epidermolysis bullosa (DEB),” including that term within semicolon-delimited entries. This synonym is documented by [NCBI MedGen C0079294](https://www.ncbi.nlm.nih.gov/medgen/37179). Qualified subtypes remain unchanged. Details show the original ClinVar label; source arrays, identifiers, entry counts, and CSV wording are preserved. Search accepts both names, and “DEB” or “dystrophic EB” expands to the full common name so explicitly named subtypes are included too. Conditions sort by the displayed names.

CSV export includes **all filtered results**, across all pages, with quoted fields and spreadsheet formula protection. Source JSON and TSV downloads are available under “Source files & mapping methods.”

Implementation: `scripts/process_data.py` (data), `scripts/verify_data.py` (source audit), `src/app.jsx` (React UI), `src/data-utils.mjs` (filter/map/export logic), `src/styles.css` (responsive layout). Dependency versions and cached archive checksums used for this offline build are recorded in `scripts/local-dependencies.json`.


## Verification after changes

`npm test` runs 139 unit and regression tests, including sorting, pointer gestures, 3D projection, schematic linkage, protein-reference provenance and geometry checks. `npm run verify:snapshot` reproduces all 6,522 variants from the 13,036 committed TSV rows, checks row and file hashes, verifies UniProt/domain data and summary counts, and works without the original archive. It **cannot prove completeness against the original ClinVar archive or freshness**. `npm run verify:data` retains that independent full-source check and now reports clearly when the archive is missing.

The build and browser share dataset validation, so malformed nested records produce a recoverable loading error instead of a blank screen. The build removes obsolete output assets after validating its inputs. Original source downloads remain byte-identical.

For the browser regression suite, install Chromium on a machine that permits browser processes, build, and start the preview in another terminal:

```sh
npx playwright install chromium
npm run build
npm run preview
# In another terminal:
npm run test:browser
```

Set `BASE_URL` to test an accessible deployment. `CHROME_BIN` can select a compatible existing browser. The browser suite covers search, combined filters, chart navigation, every sortable heading, pagination, evidence focus/dismissal, CSV/download integrity, 320/390/768/1440-pixel layouts, URL restoration, and network/malformed-data recovery. Protein-view scenarios cover horizontal/vertical/diagonal and touch rotation, projected-stroke selection, wheel and keyboard zoom, modifier/right-button pan, view reset with filters preserved, optional animation, and reduced-motion changes. Browser tests are separate from `npm test`; a successful unit run does not imply the browser suite ran.

See [AUDIT.md](AUDIT.md) for the review findings, fixes, and verification limits.


## Visual summaries and display theme

The summary between the map and results table contains tabs for an exact clinical-significance count chart and stacked bars for NC1, collagenous and NC2, colored by the same source categories. Both use the complete filtered result set, including records beyond the visible page. They respond to every search, review, mapping, type, domain and residue-range filter; changing sort/page does not change counts.

Click a classification bar to toggle that filter, a domain heading to toggle the domain, or a domain/category bar to apply both together. Existing search and other filters remain active. Click the selected bar again or use the filter chips to clear it. Zero categories stay visible in the clinical chart; the domain view shows nonzero segments with expandable exact-count controls for small segments. The 38 records with no classification have a distinct “Not reported” filter, separate from the source’s explicit no-classification label. Chart selections persist in shareable URLs.

Each domain uses the same numeric scale for classification assignments. Domain totals count unique variants; classifications may overlap and stack totals are not presented as mutually exclusive variant totals. Unmapped and mapped-outside-region counts are shown explicitly. The residue map puts domain architecture first, with a compact count axis below and exact ranges available through “Set residue range”; its last partial bin uses its actual residue width.

The header’s light/dark toggle defaults to the system preference, persists a manual choice on this device and preserves all explorer state. An external initializer applies the choice before styles load without weakening the Content Security Policy. Charts, table, source panels and evidence dialogs share the selected palette. Rendering uses native HTML/CSS and SVG; no charting dependency was added.


## Evidence-focused research workflow

Compact filters precede the primary protein map. The exact “criteria provided, multiple submitters, no conflicts” quick filter matches **928** records in this snapshot; it composes with all existing filters and persists in shared URLs. Review status is not inferred from the submitter count: 217 records labeled “single submitter” report more than one aggregate submitter.

Each normalized variant includes `numberSubmitters`: sorted distinct, nonnegative `NumberSubmitters` source values. Duplicate genome-assembly rows are never added together. Zero, missing values, and future differing source counts remain distinct. The table has a dedicated review/submitter column, while the detail view groups evidence and mapping facts and keeps genomic rows and source hashes in expandable sections.

`data.snapshot.preparedDate` records preparation of the supplied files (**2026-10-27**), not the current deployment date or an inferred ClinVar release. New processing runs use an explicit `--prepared-date YYYY-MM-DD`; omit it when that date is not known. UniProt's annotation date remains 2026-09-02. Raw TSV and UniProt source files are unchanged.

Filtered CSV export includes all matching pages and retains c./p. HGVS, clinical significance, exact review status, submitter counts, domain overlaps, inclusive protein positions, ClinVar ID/URL, conditions, genomic coordinates, evaluation dates, source lines/hashes, snapshot dates and mapping provenance. No new remote data source or runtime request was added.


## Coordinated exploration and shareable evidence

Every domain selection—map, subdomain, chart or dropdown—starts a consistent region focus. Selecting a new domain clears an earlier residue range and an unmapped-only scope, while preserving text, review and variant-type filters. Selecting unmapped clears spatial constraints. A grouped chart bar changes domain and classification together; selecting it again clears that pair and its residue focus. Filter state, sorting, page and selected evidence remain in the URL.

The whole-protein view is an illustrative 3D homotrimer projected into lightweight SVG paths, not a resolved structure. Shape and length are not to scale. Existing UniProt boundaries link map regions, subdomains, density bins and individual residues to schematic segments; the precursor signal peptide is not drawn as part of the mature homotrimer. Diagram selection filters the same results as the map.

Drag in any direction to rotate the molecule freely in 3D. A drag does not select a region; clicking a visible projected strand or its labeled domain button filters that region. Wheel scrolling and the zoom buttons change the camera zoom. Ctrl/Command-drag or right-button drag pans the model. With the canvas focused, arrow keys rotate, Shift plus arrows pan, plus/minus zoom, and Home resets the view. **Reset protein view** restores orientation, zoom and pan while preserving research filters. Touch uses one-finger rotation in any direction inside the canvas; scroll the page outside the canvas.

NC1 is blue, the collagenous region is teal, and NC2 is purple in both the 3D schematic and residue map. Matching label swatches make the domain color key visible; depth shading and linked highlights retain each domain’s hue. Both themes use coordinated colors with contrasting map text. Fine strands and increased curve sampling keep the coils separated and smooth as the view rotates or zooms. Clinical-significance colors remain independent.

The model starts stationary. Optional automatic rotation pauses during interaction, off-screen or in a hidden tab, and a reduced-motion preference change stops it. Manual controls remain available with reduced motion. Regions and subdomains expose compact accessible tooltips with exact boundaries, filtered counts and one explicitly labeled example. Individual colored markers appear for smaller sets; dense views use stacked significance counts by default, with a persistent count legend and per-bin breakdowns.

A sticky research bar keeps the snapshot/mapping context, color legend, result count, **Reset all filters**, and **Copy view link** available while scrolling. The exact classification color key is expandable in the domain-comparison tab. Duplicate statistics and competing full-size summary panels have been removed. Copying a view includes any open variant evidence; a selectable link appears if clipboard access is unavailable.

Click a noninteractive area of a table row, or press Enter/Space on its focusable row, to open evidence. Nested ClinVar links and text selection retain their normal behavior. Details surface the verbatim accession-qualified source names, all supplied conditions, exact overlapping feature boundaries and direct ClinVar/UniProt links. No source files or datasets were changed for this round.


## RDEB research workflow

The research controls add **Condition context** and **Molecular change (HGVS pattern)**. These compose with every existing search, evidence, domain, range and mapping filter; the same complete cohort feeds the table, map, summary graphs and CSV. Active research facets are included in shared URLs and reset with other filters.

Condition context uses exact semicolon-delimited source terms listed in `src/research-data.mjs`: explicit recessive EB labels (786 records), dominant labels (89), or both (31). Generic DEB is not promoted to RDEB. ClinVar condition summaries and classifications are independent aggregates; this is an incomplete source-label cohort, not a condition-specific interpretation or inheritance prediction.

HGVS patterns cover reported frameshifts, introduced stops, missense changes, glycine substitutions, unchanged protein descriptions, protein indels/duplications, and intronic ±1/2 single-nucleotide substitutions. Patterns can overlap: glycine substitution is a missense pattern, and a protein insertion can introduce a stop. Other notation remains unresolved. A reported pattern does not establish RNA/protein effect, loss of function, phase, severity or treatment eligibility. All 261 splice-site SNVs in this snapshot are unmapped; the interface offers a way to clear conflicting protein-position filters. Source expressions remain visible in evidence and exports.

Use **Save** in a row or evidence panel to retain up to 24 numeric ClinVar IDs in this browser (`col7a1-shortlist-v1`). The sticky **Shortlist** control opens a bounded dialog, where 2–4 variants can be compared across full HGVS, classifications, reviews, source submitter counts, domains, conditions and evaluation dates. Saved records are independent of filters; **Reset all filters** preserves them. Storage failures fall back to an in-session list with a visible notice.

**Copy shortlist link** and **Copy comparison link** encode validated IDs in the URL. Shared lists are transient and never overwrite the recipient's browser list; **Open my saved shortlist** returns to it. Shortlist/comparison CSV exports use their selected IDs independently of table filters. All CSV exports retain original source columns and add explicit condition matches, derived HGVS-pattern keys and their supporting source expressions. No additional data files, runtime data services, dependencies or patient data were added.

Research interpretation context: [GeneReviews — Dystrophic Epidermolysis Bullosa](https://www.ncbi.nlm.nih.gov/books/NBK1304/). This is a documentation reference, not a new variant data source.
