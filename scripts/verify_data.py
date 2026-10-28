#!/usr/bin/env python3
"""Verify every extracted source row and reproduce every normalized variant offline."""
import collections
import gzip
import hashlib
import json
from pathlib import Path
from process_data import ROOT, gene_symbols, make_variant, parse_uniprot, sha256


def verify():
    data = json.loads((ROOT / 'public/data/variants.json').read_text())
    raw_path = ROOT / data['sources']['clinvar']['file']
    uni_path = ROOT / data['sources']['uniprot']['file']
    assert sha256(raw_path) == data['sources']['clinvar']['sha256'], 'ClinVar file hash mismatch'
    assert sha256(uni_path) == data['sources']['uniprot']['sha256'], 'UniProt file hash mismatch'
    assert sha256(ROOT / 'scripts/process_data.py') == data['processing']['scriptSha256'], 'Processor changed; regenerate data'
    subset_path = ROOT / 'public/data/clinvar-col7a1.tsv'
    assert sha256(subset_path) == data['sources']['clinvar']['extractedSha256'], 'Extracted TSV hash mismatch'
    extracted = {}
    with subset_path.open() as f:
        columns = f.readline().rstrip('\n').split('\t')[2:]
        columns[0] = columns[0].lstrip('#')
        assert columns == data['sources']['clinvar']['columns']
        for row in f:
            number, digest, raw = row.rstrip('\n').split('\t', 2)
            assert hashlib.sha256(raw.encode()).hexdigest() == digest
            assert int(number) not in extracted
            extracted[int(number)] = (raw, digest)
    opener = gzip.open if raw_path.suffix == '.gz' else open
    groups = collections.defaultdict(list)
    source_total, source_matches = 0, 0
    with opener(raw_path, 'rt', encoding='utf-8') as f:
        header = f.readline().rstrip('\r\n').lstrip('#').split('\t')
        gene_index = header.index('GeneSymbol')
        for line_number, line in enumerate(f, 2):
            if not line.strip():
                continue
            source_total += 1
            # Independent field-index filter; do not use the processor's text prefilter.
            raw = line.rstrip('\r\n')
            cells = raw.split('\t')
            if 'COL7A1' not in gene_symbols(cells[gene_index]):
                assert line_number not in extracted
                continue
            source_matches += 1
            assert line_number in extracted, f'Missing source row {line_number}'
            assert raw == extracted[line_number][0], f'Altered source row {line_number}'
            fields = dict(zip(header, cells))
            groups[int(fields['VariationID'])].append({'line': line_number, 'sha256': extracted[line_number][1], 'fields': fields})
    assert source_total == data['sources']['clinvar']['rowsScanned']
    assert source_matches == len(extracted) == data['summary']['sourceRows']
    assert len(groups) == len(data['variants']) == data['summary']['variants']
    assert len({v['variationId'] for v in data['variants']}) == len(data['variants'])
    assert set(groups) == {v['variationId'] for v in data['variants']}
    protein = parse_uniprot(uni_path)
    assert protein == data['protein']
    raw_uni = json.loads(uni_path.read_text())
    assert protein['sequence'] == raw_uni['sequence']['value']
    for d in protein['domains']:
        i = int(d['source']['jsonPointer'].split('/')[-1])
        feature = raw_uni['features'][i]
        assert (d['start'], d['end'], d['description']) == (feature['location']['start']['value'], feature['location']['end']['value'], feature['description'])
    mapped = 0
    for v in data['variants']:
        assert v == make_variant(v['variationId'], groups[v['variationId']], protein), f'Normalization mismatch {v["variationId"]}'
        m = v['proteinMapping']
        if m['status'] == 'mapped':
            mapped += 1
            assert 1 <= m['start'] <= m['end'] <= protein['length']
            assert m['referenceResiduesMatch'] is True
            assert set(m['domainIds']) == {d['id'] for d in protein['domains'] if max(m['start'], d['start']) <= min(m['end'], d['end'])}
        else:
            assert m['start'] is None and m['end'] is None and m['domainIds'] == [] and m['reason']
    assert mapped == data['summary']['mapped']
    assert len(data['variants']) - mapped == data['summary']['unmapped']
    print(f'PASS: {source_total:,} source rows scanned; all {source_matches:,} COL7A1 rows match exactly.')
    print(f'PASS: {len(data["variants"]):,} variants reproduced; {mapped:,} mappings, all sequence/domain coordinates and source hashes verified.')


if __name__ == '__main__':
    verify()
