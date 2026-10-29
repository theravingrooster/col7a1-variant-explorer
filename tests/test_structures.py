"""Scientific checks against the committed, unmodified AF3 atom coordinates."""
import importlib.util
import json
from pathlib import Path
import statistics
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_structures", ROOT / "scripts/prepare_structures.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class FragmentCoordinateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / "public/data/structures/manifest.json").read_text())
        cls.sequence = json.loads((ROOT / "Q02388.json").read_text())["sequence"]["value"]

    def test_every_rendered_chain_matches_the_canonical_sequence(self):
        for fragment in self.manifest["fragments"]:
            atoms = prepare.parse_cif_atoms((ROOT / ("public" + fragment["coordinateUrl"])).read_text())
            self.assertEqual(len(atoms), fragment["atomCount"])
            for chain in fragment["chains"]:
                residues = [atom for atom in atoms if atom["chain"] == chain and atom["atom"] == "CA"]
                self.assertEqual([atom["resi"] for atom in residues], list(range(1, fragment["length"] + 1)))
                self.assertEqual("".join(atom["aminoAcid"] for atom in residues), self.sequence[fragment["start"] - 1:fragment["end"]])
            self.assertEqual({atom["chain"] for atom in atoms}, set(fragment["chains"]))

    def test_displayed_confidence_comes_from_the_rendered_atoms(self):
        for fragment in self.manifest["fragments"]:
            atoms = prepare.parse_cif_atoms((ROOT / ("public" + fragment["coordinateUrl"])).read_text())
            alpha_carbons = [atom for atom in atoms if atom["atom"] == "CA"]
            for atom in alpha_carbons:
                residue = fragment["residues"][atom["resi"] - 1]
                self.assertEqual(residue["plddt"][atom["chain"]], atom["plddt"])
                self.assertEqual(residue["position"], fragment["start"] + atom["resi"] - 1)
            self.assertEqual(round(statistics.mean(atom["plddt"] for atom in atoms), 2), fragment["confidence"]["meanAtomPlddt"])
            self.assertEqual(round(statistics.mean(atom["plddt"] for atom in alpha_carbons), 2), fragment["confidence"]["meanCaPlddt"])

    def test_original_requests_and_summary_metrics_match_fragment_metadata(self):
        for fragment in self.manifest["fragments"]:
            provenance = fragment["provenance"]
            job = json.loads((ROOT / ("public" + provenance["jobRequestUrl"])).read_text())[0]
            summary = json.loads((ROOT / ("public" + provenance["summaryUrl"])).read_text())
            chain = job["sequences"][0]["proteinChain"]
            self.assertEqual(chain["sequence"], fragment["sequence"])
            self.assertEqual(chain["count"], len(fragment["chains"]))
            self.assertEqual(int(job["modelSeeds"][0]), fragment["seed"])
            for metric in ["ptm", "iptm"]:
                self.assertEqual(summary[metric], fragment["confidence"][metric])
            cif = (ROOT / ("public" + fragment["coordinateUrl"])).read_text()
            self.assertIn("NON-COMMERCIAL USE ONLY", cif)
            self.assertIn("alphafoldserver.com/output-terms", cif)
            self.assertIn("Google DeepMind", cif)


if __name__ == "__main__":
    unittest.main()
