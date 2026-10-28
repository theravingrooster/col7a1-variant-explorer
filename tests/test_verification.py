"""Exercise both verification modes and failures that would hide data corruption."""
import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from process_data import ROOT, process, sha256
from verify_data import verify


class SnapshotVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        shutil.copy(ROOT / 'scripts/process_data.py', self.root / 'scripts/process_data.py')
        shutil.copy(ROOT / 'Q02388.json', self.root / 'Q02388.json')
        self.raw = self.root / 'variant_summary.txt'
        header = ['#AlleleID', 'GeneSymbol', 'VariationID', 'Name', 'ClinicalSignificance', 'ReviewStatus', 'Assembly', 'Start', 'Stop']
        name = 'NM_000094.4(COL7A1):c.8393T>A (p.Met2798Lys)'
        rows = [
            ['1', 'COL7A1', '17423', name, 'Pathogenic', 'criteria provided, single submitter', 'GRCh37', '100', '100'],
            ['2', 'OTHER', '999', 'Unrelated', 'Benign', '-', 'GRCh38', '300', '300'],
            ['1', 'COL7A1', '17423', name, 'Pathogenic', 'criteria provided, single submitter', 'GRCh38', '200', '200'],
        ]
        self.raw.write_text('\n'.join('\t'.join(row) for row in [header, *rows]) + '\n', encoding='utf-8')
        with contextlib.redirect_stdout(io.StringIO()):
            process(self.raw, self.root / 'Q02388.json', self.root / 'public/data')
        self.json_path = self.root / 'public/data/variants.json'

    def check(self, snapshot=True):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            summary = verify(snapshot_only=snapshot, root=self.root)
        return summary, output.getvalue()

    def modify_json(self, change):
        data = json.loads(self.json_path.read_text())
        change(data)
        self.json_path.write_text(json.dumps(data), encoding='utf-8')

    def test_snapshot_without_original_reports_its_limit(self):
        self.raw.unlink()
        summary, output = self.check()
        self.assertEqual(summary['variants'], 1)
        self.assertIn('does not prove completeness', output)

    def test_full_verification_checks_original_source(self):
        summary, output = self.check(snapshot=False)
        self.assertEqual(summary['sourceRows'], 2)
        self.assertIn('3 original source rows scanned', output)
        self.assertNotIn('LIMIT:', output)

    def test_full_verification_requires_original(self):
        self.raw.unlink()
        with self.assertRaisesRegex(FileNotFoundError, 'Use --snapshot'):
            self.check(snapshot=False)

    def test_altered_normalized_record_is_rejected(self):
        self.modify_json(lambda data: data['variants'][0]['conditions'].append('Invented condition'))
        with self.assertRaisesRegex(ValueError, 'Normalization mismatch'):
            self.check()

    def test_invented_submitter_counts_are_rejected(self):
        self.modify_json(lambda data: data['variants'][0].update(numberSubmitters=[4]))
        with self.assertRaisesRegex(ValueError, 'Normalization mismatch'):
            self.check()

    def test_preparation_date_never_defaults_to_current_date(self):
        data = json.loads(self.json_path.read_text())
        self.assertIsNone(data['snapshot']['preparedDate'])
        self.assertIsNone(data['sources']['clinvar']['releaseDate'])
        with contextlib.redirect_stdout(io.StringIO()):
            data = process(self.raw, self.root / 'Q02388.json', self.root / 'public/data', prepared_date='2026-10-27')
        self.assertEqual(data['snapshot']['preparedDate'], '2026-10-27')
        self.assertIsNone(data['sources']['clinvar']['releaseDate'])
        self.check()

    def test_inaccurate_summary_is_rejected(self):
        self.modify_json(lambda data: data['summary']['significanceGroups'].update(pathogenic=999))
        with self.assertRaisesRegex(ValueError, 'Significance summary mismatch'):
            self.check()

    def test_row_hash_is_checked_independently_of_file_hash(self):
        subset = self.root / 'public/data/clinvar-col7a1.tsv'
        subset.write_text(subset.read_text().replace('Pathogenic', 'Benign'), encoding='utf-8')
        self.modify_json(lambda data: data['sources']['clinvar'].update(extractedSha256=sha256(subset)))
        with self.assertRaisesRegex(ValueError, 'Row hash mismatch'):
            self.check()

    def test_duplicate_extracted_source_lines_are_rejected(self):
        subset = self.root / 'public/data/clinvar-col7a1.tsv'
        lines = subset.read_text().splitlines()
        subset.write_text('\n'.join([*lines, lines[-1]]) + '\n', encoding='utf-8')
        self.modify_json(lambda data: data['sources']['clinvar'].update(extractedSha256=sha256(subset)))
        with self.assertRaisesRegex(ValueError, 'Source lines must be unique'):
            self.check()

    def test_original_source_cannot_omit_matching_rows(self):
        # Even if the supplied archive's file metadata is updated, it must still
        # contain every extracted COL7A1 row at the recorded physical line.
        self.raw.write_text(self.raw.read_text().replace('COL7A1', 'OTHER'), encoding='utf-8')
        self.modify_json(lambda data: data['sources']['clinvar'].update(sha256=sha256(self.raw), bytes=self.raw.stat().st_size))
        with self.assertRaisesRegex(ValueError, 'Unexpected extracted line'):
            self.check(snapshot=False)


if __name__ == '__main__':
    unittest.main()
