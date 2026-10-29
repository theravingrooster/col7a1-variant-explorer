#!/usr/bin/env python3
"""Prepare two traceable AF3 fragment models; never assemble or modify coordinates.

Usage: python3 scripts/prepare_structures.py --input-dir /path/to/original/zips
The original ZIPs are retained by the project owner, not copied into the website.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shlex
import statistics
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPECS = (
    {"id": "vwfa2-wt", "label": "NC1 · vWFA2-containing fragment", "archive": "fold_col7a1_vwfa2_wt_seed11.zip", "start": 1047, "end": 1237, "copies": 1,
     "caution": "An isolated wild-type fragment prediction. Its placement relative to the rest of NC1 and the full protein is not modeled."},
    {"id": "collagen-wt-2539-2619", "label": "Collagenous fragment · three chains", "archive": "fold_col7a1_collagen_wt_2539_2619_seed11.zip", "start": 2539, "end": 2619, "copies": 3,
     "caution": "Inter-chain confidence is limited (ipTM 0.52). The predicted chain arrangement is uncertain; this is not a validated triple helix or a full collagen VII molecule. No hydroxyproline modifications were supplied."},
)
AA = dict(zip("ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL".split(), "ARNDCQEGHILKMFPSTWYV"))
DOCS_URL = "https://www.ebi.ac.uk/training/online/courses/alphafold/alphafold-3-and-alphafold-server/alphafold-server-your-gateway-to-alphafold-3/interpreting-results-from-alphafold-server/"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_cif_atoms(text):
    """Read the fixed-width atom_site loop in these original AF3 ModelCIF files.

    Refuse malformed rows or alternative sequence/chain numbering instead of
    guessing a mapping. This intentionally is not a general-purpose CIF parser.
    """
    lines = text.splitlines()
    first = next(i for i, line in enumerate(lines) if line.startswith("_atom_site."))
    columns, i = [], first
    while i < len(lines) and lines[i].startswith("_atom_site."):
        columns.append(lines[i].split()[0].split(".", 1)[1])
        i += 1
    atoms = []
    for line in lines[i:]:
        if line.startswith("#") or line.startswith("_") or line.startswith("loop_"):
            break
        if not line.strip():
            continue
        tokens = shlex.split(line)
        if len(tokens) != len(columns):
            raise ValueError("Unexpected atom_site row width")
        row = dict(zip(columns, tokens))
        if row["group_PDB"] != "ATOM" or row["pdbx_PDB_model_num"] != "1":
            raise ValueError("Expected one standard protein coordinate model")
        if row["label_asym_id"] != row["auth_asym_id"] or row["label_seq_id"] != row["auth_seq_id"]:
            raise ValueError("Author numbering differs from model sequence numbering")
        xyz = [float(row[f"Cartn_{axis}"]) for axis in "xyz"]
        confidence = float(row["B_iso_or_equiv"])
        if not all(math.isfinite(value) for value in xyz) or not 0 <= confidence <= 100:
            raise ValueError("Invalid atom coordinates or confidence")
        atoms.append({"id": int(row["id"]), "chain": row["label_asym_id"], "resi": int(row["label_seq_id"]),
                      "atom": row["label_atom_id"], "aminoAcid": AA[row["label_comp_id"]], "plddt": confidence, "xyz": xyz})
    if not atoms or len({atom["id"] for atom in atoms}) != len(atoms):
        raise ValueError("Missing or duplicate atoms")
    return atoms


def single_member(archive, suffix):
    matches = [name for name in archive.namelist() if name.endswith(suffix)]
    if len(matches) != 1:
        raise ValueError(f"Expected one {suffix} file")
    name = matches[0]
    return name, archive.read(name)


def prepare_fragment(spec, archive_path, reference, output):
    archive_bytes = archive_path.read_bytes()
    with zipfile.ZipFile(archive_path) as archive:
        cif_name, cif_bytes = single_member(archive, "model_0.cif")
        request_name, request_bytes = single_member(archive, "job_request.json")
        summary_name, summary_bytes = single_member(archive, "summary_confidences_0.json")
        full_name, full_bytes = single_member(archive, "full_data_0.json")
    request = json.loads(request_bytes)
    if not isinstance(request, list) or len(request) != 1:
        raise ValueError("Expected one original model request")
    job = request[0]
    if len(job["sequences"]) != 1 or "proteinChain" not in job["sequences"][0]:
        raise ValueError("Expected identical protein chains only")
    chain_input = job["sequences"][0]["proteinChain"]
    sequence = chain_input["sequence"]
    canonical = reference["sequence"]["value"]
    if canonical[spec["start"] - 1:spec["end"]] != sequence or canonical.count(sequence) != 1:
        raise ValueError("Input sequence does not map uniquely to the stated canonical interval")
    if chain_input["count"] != spec["copies"] or len(sequence) != spec["end"] - spec["start"] + 1:
        raise ValueError("Unexpected chain count or fragment length")
    atoms = parse_cif_atoms(cif_bytes.decode("utf-8"))
    chains = sorted({atom["chain"] for atom in atoms})
    if len(chains) != spec["copies"]:
        raise ValueError("Coordinate chain count differs from the input")
    ca = {}
    for atom in atoms:
        if not 1 <= atom["resi"] <= len(sequence) or atom["aminoAcid"] != sequence[atom["resi"] - 1]:
            raise ValueError("Coordinate residue differs from the input sequence")
        if atom["atom"] == "CA":
            key = (atom["chain"], atom["resi"])
            if key in ca:
                raise ValueError("Duplicate alpha-carbon residue")
            ca[key] = atom["plddt"]
    if len(ca) != len(sequence) * len(chains):
        raise ValueError("Incomplete alpha-carbon coverage")
    summary, full = json.loads(summary_bytes), json.loads(full_bytes)
    tokens = list(zip(full["token_chain_ids"], full["token_res_ids"]))
    if len(tokens) != len(sequence) * len(chains) or set(tokens) != set(ca):
        raise ValueError("Confidence token coverage differs from coordinates")
    if len(full["pae"]) != len(tokens) or any(len(row) != len(tokens) for row in full["pae"]):
        raise ValueError("Invalid PAE matrix dimensions")
    if len(full["atom_plddts"]) != len(atoms) or full["atom_chain_ids"] != [atom["chain"] for atom in atoms]:
        raise ValueError("Atom confidence coverage differs from coordinates")
    inter_pae = [value for i, row in enumerate(full["pae"]) for j, value in enumerate(row) if tokens[i][0] != tokens[j][0]]
    intra_pae = [value for i, row in enumerate(full["pae"]) for j, value in enumerate(row) if i != j and tokens[i][0] == tokens[j][0]]
    if any(not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0 for row in full["pae"] for value in row):
        raise ValueError("Invalid PAE value")
    stem = spec["id"]
    files = {f"{stem}.cif": cif_bytes, f"{stem}.job.json": request_bytes, f"{stem}.summary.json": summary_bytes}
    for filename, content in files.items():
        (output / filename).write_bytes(content)
    overlap = [{"label": feature.get("description", feature["type"]), "start": feature["location"]["start"]["value"], "end": feature["location"]["end"]["value"]}
               for feature in reference["features"] if feature["type"] in ("Domain", "Region")
               and feature["location"]["start"]["value"] <= spec["end"] and feature["location"]["end"]["value"] >= spec["start"]]
    return {
        "id": stem, "label": spec["label"], "start": spec["start"], "end": spec["end"], "length": len(sequence),
        "sequence": sequence, "chains": chains, "modelRank": 0, "seed": int(job["modelSeeds"][0]),
        "coordinateUrl": f"/data/structures/{stem}.cif", "coordinateSha256": sha256(cif_bytes), "atomCount": len(atoms),
        "confidence": {"ptm": summary["ptm"], "iptm": summary["iptm"],
                       "meanAtomPlddt": round(statistics.mean(atom["plddt"] for atom in atoms), 2),
                       "meanCaPlddt": round(statistics.mean(ca.values()), 2),
                       "meanIntraChainPae": round(statistics.mean(intra_pae), 2),
                       "meanInterChainPae": round(statistics.mean(inter_pae), 2) if inter_pae else None},
        "residues": [{"modelPosition": i, "position": spec["start"] + i - 1, "aminoAcid": amino,
                      "plddt": {chain: ca[(chain, i)] for chain in chains}} for i, amino in enumerate(sequence, 1)],
        "domainOverlaps": overlap,
        "provenance": {"archiveName": archive_path.name, "archiveSha256": sha256(archive_bytes), "coordinateMember": cif_name,
                       "jobRequestUrl": f"/data/structures/{stem}.job.json", "jobRequestSha256": sha256(request_bytes), "jobRequestMember": request_name,
                       "summaryUrl": f"/data/structures/{stem}.summary.json", "summarySha256": sha256(summary_bytes), "summaryMember": summary_name,
                       "fullDataSha256": sha256(full_bytes), "fullDataMember": full_name,
                       "templateUse": chain_input.get("useStructureTemplate"), "templateCutoff": chain_input.get("maxTemplateDate"), "modifications": chain_input.get("modifications", []),
                       "inputDialect": job["dialect"], "inputVersion": job["version"],
                       "confidenceMethod": "pTM/ipTM from the original summary JSON; atomic and C-alpha pLDDT from the original mmCIF B_iso_or_equiv values; PAE means from full_data JSON, excluding diagonal for within-chain means."},
        "caution": spec["caution"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/data/structures")
    args = parser.parse_args()
    reference_bytes = (ROOT / "Q02388.json").read_bytes()
    reference = json.loads(reference_bytes)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": 1,
        "reference": {"accession": "Q02388-1", "length": len(reference["sequence"]["value"]),
                      "sequenceSha256": sha256(reference["sequence"]["value"].encode()), "sourceSha256": sha256(reference_bytes)},
        "method": "AlphaFold 3 / AlphaFold Server", "representation": "Original predicted atomic coordinates; independently modeled fragments, never joined.",
        "attribution": "Predictions generated with AlphaFold Server by Google DeepMind and Isomorphic Labs.",
        "outputTermsUrl": "https://alphafoldserver.com/output-terms", "outputUse": "Non-commercial use only; original output notices retained.",
        "documentationUrl": DOCS_URL,
        "fragments": [prepare_fragment(spec, args.input_dir / spec["archive"], reference, args.output_dir) for spec in SPECS],
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"Prepared {len(manifest['fragments'])} independent fragment models with original coordinates and verified canonical mapping.")


if __name__ == "__main__":
    main()
