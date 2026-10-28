# COL7A1 variant explorer

A static React research explorer built entirely from the supplied local ClinVar and UniProt files. No API, database, remote fonts, analytics, or runtime data requests to external services. ClinVar and UniProt links open only when clicked.

This is a **fixed data snapshot**, prepared from local files on **2026-10-27**. That is the preparation date, not a verified ClinVar release cutoff. The ClinVar file does not state its release date; the UniProt entry reports an annotation update of **2026-09-02**. The website does not refresh automatically when either source changes.

## Run and build

Node.js 22+ and Python 3.9+ are sufficient. Dependencies are already installed in this workspace from the local npm cache, without downloads.

```sh
npm run dev          # build and serve at http://127.0.0.1:3000
npm run build        # static site in dist/
npm test             # 10 processor + 5 frontend logic tests
npm run verify:data  # full comparison against original local source files
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

To publish a newer data snapshot, first replace the local source files, run `npm run data`, `npm run verify:data`, `npm test`, and `npm run build`, and update the preparation date and source/version notes here. Commit the regenerated `public/data/` files and `Q02388.json`, then push. Never substitute the deployment date for a source release date. The complete ClinVar archive is needed for regeneration and full verification but is not needed by the hosted site.

## Sources and reproducibility

- `variant_summary.txt.gz`: local ClinVar variant summary, 9,312,744 data rows scanned. Exact `COL7A1` tokens in `GeneSymbol` yield **13,036 rows / 6,522 distinct variation IDs**, including records that also mention other genes. The source does not identify its release date. `LastEvaluated` is a per-record field.
- `Q02388.json`: local UniProt COL7A1 entry, version 260, annotation update 2026-09-02, sequence version 2. The precursor sequence has **2,944 residues**.
- `public/data/variants.json`: frontend dataset, with `sources`, `processing`, `summary`, `protein`, and `variants` objects. File SHA-256 hashes and the processor hash are embedded. `protein` includes the full sequence, 12 subdomains, major regions, and additional region/motif annotations with JSON pointers into UniProt.
- `public/data/clinvar-col7a1.tsv`: unchanged matching ClinVar fields, prefixed by `SourceLine` and `SourceRowSHA256`. Line numbers refer to the decompressed original file, with the header on line 1. Row hashes exclude line endings. The source hash refers to the original compressed file.

Regenerate deterministically with `npm run data`. For an uncompressed or filtered summary with the same column headers:

```sh
python3 scripts/process_data.py --clinvar variant_summary.txt
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

## Interface

Search HGVS, IDs, conditions, or genomic coordinates; combine classification, domain, review, mapping, and type filters. The map groups variants into 25-residue bins at their first reported residue; bar/domain selections filter the table by interval overlap. Open a variant to inspect source lines and hashes. CSV export includes **all filtered results**, across all pages, with quoted fields and spreadsheet formula protection. Source JSON and TSV downloads are available under “Source files & mapping methods.”

Implementation: `scripts/process_data.py` (data), `scripts/verify_data.py` (source audit), `src/app.jsx` (React UI), `src/data-utils.mjs` (filter/map/export logic), `src/styles.css` (responsive layout). Dependency versions and cached archive checksums used for this offline build are recorded in `scripts/local-dependencies.json`.
