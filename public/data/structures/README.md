# Independent COL7A1 AlphaFold 3 fragment predictions

These models are **predicted fragments, not experimental structures or a joined full-length model**. The original mmCIF coordinate bytes, job requests, and top-model summary confidence JSON files are preserved. The original output notices apply: https://alphafoldserver.com/output-terms (non-commercial use only).

- `vwfa2-wt`: one chain, Q02388-1 residues **1047–1237**. This input contains the UniProt VWFA 2 annotation (1054–1229) with flanking residues; the input interval is not a new domain-boundary annotation.
- `collagen-wt-2539-2619`: three identical chains, each Q02388-1 residues **2539–2619**. Model residue 37 corresponds to canonical Gly2575 in every chain. This wild-type prediction does not model a mutation. Its ipTM of 0.52 indicates limited confidence in chain arrangement; atomic detail is not validation of a triple helix. No hydroxyproline modifications were supplied in the input.

Both use seed 11 and the server's top-ranked output (`model_0.cif`, one of five predictions). All input sequences match the canonical sequence uniquely and exactly. Original model residue numbers start at 1; the website maps these to canonical precursor positions with `canonical = fragment start + model residue − 1`. No residues or coordinates are invented outside a fragment's coverage. Coordinate files remain in their original numbering.

`manifest.json` records sequence identity, source SHA-256 hashes, original archive/member names, template-use settings as reported in the input, chain counts, atom counts, and mapping metadata. The original request does not specify an explicit template cutoff; `null` means unreported. Original archive and detailed confidence JSON hashes permit auditing without loading large PAE arrays in the browser.

Per-residue displayed pLDDT is the C-alpha value from that chain's original mmCIF `B_iso_or_equiv` field. Mean C-alpha pLDDT and mean all-atom pLDDT are separate metrics. pTM/ipTM come from the original summary JSON. Mean within-chain PAE excludes the diagonal; mean inter-chain PAE averages all ordered cross-chain pairs from the original full-data JSON. Local confidence does not establish inter-chain arrangement, stability, pathogenicity, or therapeutic response.

Prediction output documentation: https://www.ebi.ac.uk/training/online/courses/alphafold/alphafold-3-and-alphafold-server/alphafold-server-your-gateway-to-alphafold-3/interpreting-results-from-alphafold-server/

Reproduce from the two original ZIP archives with:

```bash
python3 scripts/prepare_structures.py --input-dir /path/to/original/zips
```

The preparation script verifies the sequence, chain/atom/residue coverage, confidence dimensions, canonical placement and input identity before writing. Tests independently check committed coordinate residues and displayed confidence against the manifest. No runtime data services or new predictions are used.
