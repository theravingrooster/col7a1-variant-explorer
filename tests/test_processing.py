import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from process_data import ROOT, extract_hgvs, gene_symbols, integer, make_variant, parse_uniprot, preparation_date, protein_position, submitter_count


class ProteinMappingTests(unittest.TestCase):
    def assess(self, expression, sequence='MAGP', accession='NM_000094.4'):
        return protein_position({'protein': expression, 'referenceAccession': accession}, sequence, {'NM_000094.4'})

    def test_substitution_and_synonymous(self):
        self.assertEqual(self.assess('p.Gly3Arg')['start'], 3)
        self.assertEqual(self.assess('p.Ala2=')['start'], 2)

    def test_predicted_range(self):
        m = self.assess('p.(Ala2_Gly3del)')
        self.assertEqual((m['start'], m['end']), (2, 3))
        self.assertTrue(m['predicted'])

    def test_frameshift_does_not_use_stop_distance(self):
        m = self.assess('p.Gly3ArgfsTer30')
        self.assertEqual((m['start'], m['end'], m['extent']), (3, 3, 'frameshift_anchor'))

    def test_invalid_reference_not_mapped(self):
        self.assertEqual(self.assess('p.Cys3Arg')['reason'], 'reference_residue_mismatch')
        self.assertEqual(self.assess('p.Gly3Arg', accession='NM_000094.3')['reason'], 'reference_not_linked_by_local_uniprot')

    def test_uncertainty_stop_and_out_of_bounds(self):
        for expr in ['p.?', 'p.Gly(2_3)Arg', 'p.2084PGP[2]', 'p.Gly3GARBAGE']:
            self.assertEqual(self.assess(expr)['status'], 'unmapped')
        self.assertEqual(self.assess('p.Ter5=')['reason'], 'protein_position_out_of_bounds')
        self.assertEqual(self.assess('p.Gly3_Ala2del')['status'], 'unmapped')

    def test_no_coding_inference(self):
        h = extract_hgvs('NM_000094.4(COL7A1):c.3+1G>A')
        self.assertEqual(h['coding'], 'c.3+1G>A')
        self.assertIsNone(h['protein'])
        self.assertEqual(protein_position(h, 'MAGP', {'NM_000094.4'})['reason'], 'no_protein_hgvs')

    def test_extraction_keeps_predicted_parentheses(self):
        self.assertEqual(extract_hgvs('NM_000094.4(COL7A1):c.7G>A (p.(Gly3Arg))')['protein'], 'p.(Gly3Arg)')
        self.assertEqual(extract_hgvs('NM_000094.4(COL7A1):c.7G>A (p.Gly3Arg)')['protein'], 'p.Gly3Arg')

    def test_gene_tokens_and_missing_coordinates(self):
        self.assertIn('COL7A1', gene_symbols('GENE;COL7A1;MIR711'))
        self.assertNotIn('COL7A1', gene_symbols('COL7A1-AS1'))
        for missing in ['-1', '0', 'na', '2147483647', None]:
            self.assertIsNone(integer(missing))

    def test_assembly_dedup_and_boundary_overlap(self):
        protein = {'sequence': 'MAGP', 'refSeqLinks': [{'transcript': 'NM_000094.4', 'protein': 'NP_000085.1'}], 'domains': [
            {'id': 'a', 'label': 'NC1', 'level': 'region', 'start': 1, 'end': 2},
            {'id': 'b', 'label': 'Collagenous', 'level': 'region', 'start': 3, 'end': 4}]}
        fields = {'AlleleID': '8', 'GeneSymbol': 'COL7A1', 'Name': 'NM_000094.4(COL7A1):c.4_9del (p.Ala2_Gly3del)', 'ClinicalSignificance': 'Uncertain significance'}
        rows = [{'line': i, 'sha256': str(i), 'fields': {**fields, 'Assembly': assembly, 'Start': str(pos), 'Stop': str(pos)}} for i, assembly, pos in [(2, 'GRCh37', 100), (3, 'GRCh38', 200)]]
        v = make_variant(7, rows, protein)
        self.assertEqual(v['proteinMapping']['domainIds'], ['a', 'b'])
        self.assertEqual(len(v['genomicPositions']), 2)
        self.assertEqual(v['alleleIds'], [8])
        self.assertEqual(len(v['hgvs']), 1)
        self.assertEqual([p['start'] for p in v['genomicPositions']], [100, 200])

    def test_local_uniprot_boundaries(self):
        p = parse_uniprot(ROOT / 'Q02388.json')
        regions = {d['label']: (d['start'], d['end']) for d in p['domains'] if d['level'] == 'region'}
        self.assertEqual(regions, {'NC1': (17, 1253), 'Collagenous': (1254, 2784), 'NC2': (2785, 2944)})
        self.assertEqual(len(p['sequence']), 2944)

    def test_submitter_counts_keep_zero_distinct_from_missing(self):
        self.assertEqual(submitter_count('0'), 0)
        self.assertEqual(submitter_count('17'), 17)
        for missing in [None, '', '-', 'na', 'N/A', 'not available']:
            self.assertIsNone(submitter_count(missing))
        for invalid in ['-1', '1.5', 'many', '2147483647']:
            with self.assertRaisesRegex(ValueError, 'NumberSubmitters'):
                submitter_count(invalid)

    def test_submitter_counts_deduplicate_assemblies_and_preserve_disagreement(self):
        protein = {'sequence': 'MAGP', 'refSeqLinks': [{'transcript': 'NM_000094.4', 'protein': 'NP_000085.1'}], 'domains': []}
        fields = {'AlleleID': '8', 'GeneSymbol': 'COL7A1', 'Name': 'NM_000094.4(COL7A1):c.7G>A (p.Gly3Arg)',
                  'ReviewStatus': 'criteria provided, single submitter'}
        rows = [{'line': i + 2, 'sha256': str(i), 'fields': {**fields, 'NumberSubmitters': count}}
                for i, count in enumerate(['3', '3', '2', '0', '-'])]
        v = make_variant(7, rows, protein)
        self.assertEqual(v['numberSubmitters'], [0, 2, 3])
        self.assertEqual(v['reviewStatus'], ['criteria provided, single submitter'])
        self.assertEqual(make_variant(7, [{**rows[0], 'fields': fields}], protein)['numberSubmitters'], [])

    def test_preparation_date_is_explicit_and_validated(self):
        self.assertIsNone(preparation_date(None))
        self.assertEqual(preparation_date('2026-10-27'), '2026-10-27')
        for invalid in ['2026-02-30', '2026-2-3', '', 'today']:
            with self.assertRaises(ValueError):
                preparation_date(invalid)


if __name__ == '__main__':
    unittest.main()
