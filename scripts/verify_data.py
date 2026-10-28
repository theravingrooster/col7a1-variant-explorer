#!/usr/bin/env python3
"""Verify the committed snapshot, optionally against the complete original ClinVar file."""
import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
from process_data import ROOT, gene_symbols, make_variant, parse_uniprot, sha256


def require(condition, message):
    # Unlike assert, verification must remain active under python -O.
    if not condition:
        raise ValueError(message)


def read_extracted(path, columns):
    extracted = {}
    groups = collections.defaultdict(list)
    with path.open(encoding='utf-8', newline='') as f:
        header = f.readline().rstrip('\r\n').split('\t')
        require(header[:2] == ['SourceLine', 'SourceRowSHA256'], 'Missing extracted provenance columns')
        source_columns = header[2:]
        require(bool(source_columns), 'Missing source columns')
        source_columns[0] = source_columns[0].lstrip('#')
        require(source_columns == columns, 'Extracted source columns differ from metadata')
        previous_line = 1
        for row in f:
            parts = row.rstrip('\r\n').split('\t', 2)
            require(len(parts) == 3, 'Malformed extracted row')
            number, digest, raw = parts
            line = int(number)
            require(line > previous_line, f'Source lines must be unique and ordered: {line}')
            previous_line = line
            require(hashlib.sha256(raw.encode('utf-8')).hexdigest() == digest, f'Row hash mismatch at line {line}')
            cells = raw.split('\t')
            require(len(cells) == len(columns), f'Column count mismatch at line {line}')
            fields = dict(zip(columns, cells))
            require('COL7A1' in gene_symbols(fields['GeneSymbol']), f'Non-COL7A1 row at line {line}')
            variation_id = int(fields['VariationID'])
            require(variation_id > 0, f'Invalid VariationID at line {line}')
            extracted[line] = (raw, digest)
            groups[variation_id].append({'line': line, 'sha256': digest, 'fields': fields})
    return extracted, groups


def verify_original(raw_path, data, extracted):
    require(sha256(raw_path) == data['sources']['clinvar']['sha256'], 'ClinVar file hash mismatch')
    require(raw_path.stat().st_size == data['sources']['clinvar']['bytes'], 'ClinVar file size mismatch')
    opener = gzip.open if raw_path.suffix == '.gz' else open
    source_total, source_matches = 0, 0
    with opener(raw_path, 'rt', encoding='utf-8', newline='') as f:
        header = f.readline().rstrip('\r\n').lstrip('#').split('\t')
        require(header == data['sources']['clinvar']['columns'], 'Original ClinVar columns differ from metadata')
        gene_index = header.index('GeneSymbol')
        for line_number, line in enumerate(f, 2):
            if not line.strip():
                continue
            source_total += 1
            # Independent field-index filter; do not use the processor's text prefilter.
            raw = line.rstrip('\r\n')
            cells = raw.split('\t')
            require(len(cells) == len(header), f'Column count mismatch at original line {line_number}')
            if 'COL7A1' not in gene_symbols(cells[gene_index]):
                require(line_number not in extracted, f'Unexpected extracted line {line_number}')
                continue
            source_matches += 1
            require(line_number in extracted, f'Missing source row {line_number}')
            require(raw == extracted[line_number][0], f'Altered source row {line_number}')
    require(source_total == data['sources']['clinvar']['rowsScanned'], 'Source row count mismatch')
    require(source_matches == len(extracted), 'Matching source row count mismatch')
    print(f'PASS: {source_total:,} original source rows scanned; all {source_matches:,} COL7A1 rows match exactly.')


def verify(snapshot_only=False, root=ROOT):
    root = Path(root)
    data = json.loads((root / 'public/data/variants.json').read_text(encoding='utf-8'))
    require(data['schemaVersion'] == '1.0.0' and data['gene'] == 'COL7A1', 'Unexpected dataset schema or gene')
    raw_path = root / data['sources']['clinvar']['file']
    uni_path = root / data['sources']['uniprot']['file']
    if not snapshot_only and not raw_path.is_file():
        raise FileNotFoundError(
            f'Original ClinVar source is missing: {raw_path.name}. '
            'Use --snapshot to verify the committed files; full source completeness requires the original file.'
        )
    require(sha256(uni_path) == data['sources']['uniprot']['sha256'], 'UniProt file hash mismatch')
    require(uni_path.stat().st_size == data['sources']['uniprot']['bytes'], 'UniProt file size mismatch')
    require(sha256(root / 'scripts/process_data.py') == data['processing']['scriptSha256'], 'Processor changed; regenerate data')
    subset_path = root / 'public/data/clinvar-col7a1.tsv'
    require(sha256(subset_path) == data['sources']['clinvar']['extractedSha256'], 'Extracted TSV hash mismatch')
    extracted, groups = read_extracted(subset_path, data['sources']['clinvar']['columns'])
    require(len(extracted) == data['summary']['sourceRows'] == data['sources']['clinvar']['rowsMatched'], 'Extracted row count mismatch')
    require(len(groups) == len(data['variants']) == data['summary']['variants'], 'Variant count mismatch')
    require(len({v['variationId'] for v in data['variants']}) == len(data['variants']), 'Duplicate variation IDs')
    require(set(groups) == {v['variationId'] for v in data['variants']}, 'Variation IDs differ from extracted rows')
    protein = parse_uniprot(uni_path)
    require(protein == data['protein'], 'Normalized UniProt data differs from original')
    raw_uni = json.loads(uni_path.read_text(encoding='utf-8'))
    for d in protein['domains']:
        i = int(d['source']['jsonPointer'].split('/')[-1])
        feature = raw_uni['features'][i]
        require((d['start'], d['end'], d['description']) == (feature['location']['start']['value'], feature['location']['end']['value'], feature['description']), f'UniProt domain mismatch: {d["id"]}')
        require(1 <= d['start'] <= d['end'] <= protein['length'], f'Invalid domain coordinates: {d["id"]}')
    mapped = 0
    for v in data['variants']:
        require(v == make_variant(v['variationId'], groups[v['variationId']], protein), f'Normalization mismatch {v["variationId"]}')
        m = v['proteinMapping']
        if m['status'] == 'mapped':
            mapped += 1
            require(1 <= m['start'] <= m['end'] <= protein['length'], f'Invalid mapped coordinates: {v["variationId"]}')
            require(m['referenceResiduesMatch'] is True, f'Reference residues not checked: {v["variationId"]}')
            require(set(m['domainIds']) == {d['id'] for d in protein['domains'] if max(m['start'], d['start']) <= min(m['end'], d['end'])}, f'Domain overlap mismatch: {v["variationId"]}')
        else:
            require(m['status'] == 'unmapped' and m['start'] is None and m['end'] is None and m['domainIds'] == [] and m['reason'], f'Invalid unmapped record: {v["variationId"]}')
    require(mapped == data['summary']['mapped'], 'Mapped count mismatch')
    require(len(data['variants']) - mapped == data['summary']['unmapped'], 'Unmapped count mismatch')
    require(dict(collections.Counter(v['significanceGroup'] for v in data['variants'])) == data['summary']['significanceGroups'], 'Significance summary mismatch')
    require(dict(collections.Counter(v['proteinMapping']['reason'] for v in data['variants'] if v['proteinMapping']['status'] == 'unmapped')) == data['summary']['unmappedReasons'], 'Unmapped reason summary mismatch')
    if not snapshot_only:
        verify_original(raw_path, data, extracted)
    print(f'PASS: {len(extracted):,} extracted rows and their hashes verified; {len(data["variants"]):,} variants reproduced; {mapped:,} protein mappings verified.')
    if snapshot_only:
        print('LIMIT: Snapshot verification does not prove completeness against the original ClinVar archive or freshness of either source.')
    return data['summary']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', action='store_true', help='Verify committed TSV, UniProt and normalized JSON without the excluded original ClinVar archive')
    args = parser.parse_args()
    try:
        verify(snapshot_only=args.snapshot)
    except (ValueError, FileNotFoundError, KeyError, IndexError, TypeError) as error:
        parser.exit(1, f'FAIL: {error}\n')
