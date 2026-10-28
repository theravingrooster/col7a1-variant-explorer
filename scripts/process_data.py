#!/usr/bin/env python3
"""Deterministically process local ClinVar/UniProt files. Python standard library only."""
import argparse
import collections
import csv
import gzip
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MISSING = {'', '-', 'na', 'NA', 'N/A', 'not available'}
AA = dict(zip('Ala Arg Asn Asp Cys Gln Glu Gly His Ile Leu Lys Met Phe Pro Ser Thr Trp Tyr Val Ter'.split(), 'ARNDCQEGHILKMFPSTWYV*'))
AA.update({x: x for x in 'ARNDCQEGHILKMFPSTWYV*'})
RESIDUE = '(?:' + '|'.join(re.escape(x) for x in sorted(AA, key=len, reverse=True)) + ')'
PROTEIN = re.compile(rf'^({RESIDUE})(\d+)(?:_({RESIDUE})(\d+))?(.*)$')
EFFECT = re.compile(rf'^(?:{RESIDUE}|=|\?|(?:{RESIDUE})?fs(?:(?:Ter|\*)\d+|\?)?|del|dup|delins(?:{RESIDUE})+|ins(?:{RESIDUE})+|(?:{RESIDUE})?ext(?:Ter|\*)?(?:-?\d+|\?))$')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def clean(value):
    return None if value in MISSING else value


def integer(value):
    try:
        n = int(value)
        return n if 0 < n < 2**31 - 1 else None
    except (TypeError, ValueError):
        return None


def unique(values):
    return sorted({v for v in values if v is not None})


def gene_symbols(value):
    return [s.strip() for s in re.split(r'[;,|]', value) if s.strip()]


def extract_hgvs(name):
    transcript = re.match(r'((?:NM|NR|NP|NC|NG|ENST|ENSP)_[\w.]+)', name)
    coding = re.search(r'(?<!\w)c\.[^\s)]+', name)
    # Preserve predicted parentheses in p.(...), but remove the display wrapper (p....).
    protein = re.search(r'p\.\([^)]+\)|p\.[^\s)]+', name)
    genomic = re.search(r'(?<!\w)g\.[^\s)]+', name)
    return {'name': name, 'referenceAccession': transcript.group(1) if transcript else None,
            'coding': coding.group(0) if coding else None, 'protein': protein.group(0) if protein else None,
            'genomic': genomic.group(0) if genomic else None}


def protein_position(hgvs, sequence, linked_accessions):
    """Use only explicit p. coordinates on a locally linked accession; never infer from c./g."""
    protein = hgvs['protein']
    result = {'status': 'unmapped', 'reason': 'no_protein_hgvs', 'start': None, 'end': None,
              'method': None, 'referenceResiduesMatch': None, 'predicted': bool(protein and protein.startswith('p.('))}
    if not protein:
        return result
    if hgvs['referenceAccession'] not in linked_accessions:
        return {**result, 'reason': 'reference_not_linked_by_local_uniprot'}
    expr = protein[2:]
    if expr.startswith('(') and expr.endswith(')'):
        expr = expr[1:-1]
    match = PROTEIN.fullmatch(expr)
    if not match or not EFFECT.fullmatch(match[5]):
        return {**result, 'reason': 'unsupported_or_uncertain_protein_expression'}
    first, start, last, end, effect = match.groups()
    start, end = int(start), int(end or start)
    if not 1 <= start <= end <= len(sequence):
        return {**result, 'reason': 'protein_position_out_of_bounds'}
    matches = sequence[start - 1] == AA[first] and (not last or sequence[end - 1] == AA[last])
    if not matches:
        return {**result, 'reason': 'reference_residue_mismatch', 'referenceResiduesMatch': False}
    return {**result, 'status': 'mapped', 'reason': None, 'start': start, 'end': end,
            'method': 'explicit_protein_hgvs', 'referenceResiduesMatch': True,
            'extent': 'frameshift_anchor' if 'fs' in effect else 'reported_residue_span'}


def parse_uniprot(path):
    entry = json.loads(path.read_text())
    if entry['primaryAccession'] != 'Q02388' or not any(g.get('geneName', {}).get('value') == 'COL7A1' for g in entry['genes']):
        raise ValueError('Expected UniProt Q02388 / COL7A1')
    sequence = entry['sequence']['value']
    if len(sequence) != entry['sequence']['length']:
        raise ValueError('UniProt sequence length does not match sequence')
    if hashlib.md5(sequence.encode()).hexdigest().upper() != entry['sequence']['md5'].upper():
        raise ValueError('UniProt sequence MD5 does not match sequence')
    links = []
    for ref in entry['uniProtKBCrossReferences']:
        if ref['database'] == 'RefSeq' and ref.get('isoformId', 'Q02388-1') == 'Q02388-1':
            links.append({'protein': ref['id'], 'transcript': next((p['value'] for p in ref.get('properties', []) if p['key'] == 'NucleotideSequenceId'), None), 'isoform': ref.get('isoformId')})
    domains, annotations = [], []
    region_labels = {'Nonhelical region (NC1)': 'NC1', 'Triple-helical region': 'Collagenous', 'Nonhelical region (NC2)': 'NC2'}
    for i, feature in enumerate(entry.get('features', [])):
        if feature['type'] not in {'Domain', 'Region', 'Repeat', 'Motif', 'Signal', 'Chain', 'Compositional bias'}:
            continue
        start, end = feature['location']['start'], feature['location']['end']
        if start.get('modifier') != 'EXACT' or end.get('modifier') != 'EXACT':
            continue
        annotation = {'id': f'uniprot-feature-{i}', 'type': feature['type'], 'description': feature.get('description', ''),
                      'start': start['value'], 'end': end['value'], 'source': {'sourceId': 'uniprot', 'jsonPointer': f'/features/{i}'},
                      'evidence': feature.get('evidences', [])}
        annotations.append(annotation)
        if feature['type'] == 'Domain' or feature['description'] in region_labels or feature['type'] == 'Signal':
            domains.append({**annotation, 'label': region_labels.get(feature['description'], feature['description'] or 'Signal peptide'),
                            'level': 'region' if feature['description'] in region_labels else ('signal' if feature['type'] == 'Signal' else 'subdomain')})
    for domain in domains:
        domain['parentId'] = next((p['id'] for p in domains if p['level'] == 'region' and domain['level'] == 'subdomain' and p['start'] <= domain['start'] <= domain['end'] <= p['end']), None)
    return {'accession': entry['primaryAccession'], 'name': 'Collagen alpha-1(VII) chain', 'gene': 'COL7A1',
            'organism': entry['organism']['scientificName'], 'length': len(sequence), 'sequence': sequence,
            'sequenceMd5': entry['sequence']['md5'], 'entryAudit': entry['entryAudit'], 'refSeqLinks': links,
            'url': 'https://www.uniprot.org/uniprotkb/Q02388/entry', 'domains': domains, 'annotations': annotations}


def significance_group(values):
    text = ' | '.join(values).lower()
    if 'conflict' in text or ('pathogenic' in text and 'benign' in text):
        return 'conflicting'
    if 'uncertain' in text:
        return 'uncertain'
    if 'pathogenic' in text:
        return 'pathogenic'
    if 'benign' in text:
        return 'benign'
    return 'other'


def make_variant(variation_id, records, protein):
    rows = [r['fields'] for r in records]
    values = lambda key: unique(clean(r.get(key, '')) for r in rows)
    hgvs = [extract_hgvs(name) for name in values('Name')]
    linked = {v for link in protein['refSeqLinks'] for v in (link['protein'], link['transcript']) if v}
    candidates = [protein_position(h, protein['sequence'], linked) for h in hgvs]
    positions = {(m['start'], m['end']) for m in candidates if m['status'] == 'mapped'}
    mapping = next((m.copy() for m in candidates if m['status'] == 'mapped'), candidates[0].copy())
    # Different reference names with unresolved protein annotations are not silently collapsed.
    unresolved_protein = any(h['protein'] and m['status'] != 'mapped' for h, m in zip(hgvs, candidates))
    if len(positions) > 1 or (positions and unresolved_protein):
        mapping.update(status='unmapped', reason='inconsistent_protein_annotations', start=None, end=None, method=None, referenceResiduesMatch=None)
    for h, m in zip(hgvs, candidates):
        h['positionAssessment'] = m
    mapping['domainIds'] = [d['id'] for d in protein['domains'] if mapping['status'] == 'mapped' and d['start'] <= mapping['end'] and d['end'] >= mapping['start']]
    mapping['regionLabels'] = [d['label'] for d in protein['domains'] if d['id'] in mapping['domainIds'] and d['level'] in {'region', 'signal'}]
    positions_out = []
    for record in records:
        row = record['fields']
        positions_out.append({'assembly': clean(row.get('Assembly', '')), 'chromosome': clean(row.get('Chromosome', '')),
            'chromosomeAccession': clean(row.get('ChromosomeAccession', '')), 'start': integer(row.get('Start')), 'end': integer(row.get('Stop')),
            'referenceAllele': clean(row.get('ReferenceAllele', '')), 'alternateAllele': clean(row.get('AlternateAllele', '')),
            'vcfPosition': integer(row.get('PositionVCF')), 'vcfReference': clean(row.get('ReferenceAlleleVCF', '')),
            'vcfAlternate': clean(row.get('AlternateAlleleVCF', '')), 'sourceLine': record['line']})
    classification = values('ClinicalSignificance')
    return {'id': f'clinvar-{variation_id}', 'variationId': variation_id, 'alleleIds': sorted({int(r['AlleleID']) for r in rows}),
            'geneSymbols': unique(g for r in rows for g in gene_symbols(r['GeneSymbol'])), 'types': values('Type'),
            'names': values('Name'), 'hgvs': hgvs, 'codingHgvs': unique(h['coding'] for h in hgvs), 'proteinHgvs': unique(h['protein'] for h in hgvs),
            'clinicalSignificance': classification, 'significanceGroup': significance_group(classification), 'reviewStatus': values('ReviewStatus'),
            'conditions': unique(p for r in rows for p in r.get('PhenotypeList', '').split('|') if clean(p)),
            'conditionIdentifiers': unique(p for r in rows for p in r.get('PhenotypeIDS', '').split('|') if clean(p)),
            'lastEvaluated': values('LastEvaluated'), 'origins': values('Origin'), 'rcvAccessions': unique(p for r in rows for p in r.get('RCVaccession', '').split('|') if clean(p)),
            'dbSnpIds': values('RS# (dbSNP)'), 'otherIds': values('OtherIDs'), 'genomicPositions': positions_out,
            'proteinMapping': mapping, 'url': f'https://www.ncbi.nlm.nih.gov/clinvar/variation/{variation_id}/',
            'sourceRecords': [{'sourceId': 'clinvar', 'line': r['line'], 'sha256': r['sha256']} for r in records]}


def process(clinvar, uniprot, output):
    output.mkdir(parents=True, exist_ok=True)
    protein = parse_uniprot(uniprot)
    grouped = collections.defaultdict(list)
    total, matched = 0, 0
    opener = gzip.open if clinvar.suffix == '.gz' else open
    subset = output / 'clinvar-col7a1.tsv'
    with opener(clinvar, 'rt', encoding='utf-8', newline='') as source, subset.open('w', encoding='utf-8', newline='') as extracted:
        header_line = source.readline().rstrip('\r\n')
        header = header_line.lstrip('#').split('\t')
        required = {'GeneSymbol', 'VariationID', 'AlleleID', 'Name', 'ClinicalSignificance', 'ReviewStatus'}
        if not required <= set(header):
            raise ValueError(f'Missing ClinVar columns: {required - set(header)}')
        extracted.write('SourceLine\tSourceRowSHA256\t' + header_line + '\n')
        for line_number, line in enumerate(source, 2):
            if not line.strip():
                continue
            total += 1
            if 'COL7A1' not in line:
                continue
            raw = line.rstrip('\r\n')
            cells = raw.split('\t')
            if len(cells) != len(header):
                raise ValueError(f'Column count mismatch on ClinVar line {line_number}')
            row = dict(zip(header, cells))
            if 'COL7A1' not in gene_symbols(row['GeneSymbol']):
                continue
            variation_id = integer(row['VariationID'])
            if variation_id is None:
                raise ValueError(f'Invalid VariationID on line {line_number}')
            row_hash = hashlib.sha256(raw.encode('utf-8')).hexdigest()
            grouped[variation_id].append({'line': line_number, 'sha256': row_hash, 'fields': row})
            extracted.write(f'{line_number}\t{row_hash}\t{raw}\n')
            matched += 1
    if not grouped:
        raise ValueError('No COL7A1 records found')
    variants = [make_variant(vid, records, protein) for vid, records in sorted(grouped.items())]
    counts = collections.Counter(v['proteinMapping']['status'] for v in variants)
    data = {'schemaVersion': '1.0.0', 'gene': 'COL7A1',
        'coordinateSystem': {'protein': '1-based inclusive, UniProt precursor sequence (including signal peptide)', 'genomic': '1-based inclusive, assembly preserved as reported by ClinVar'},
        'sources': {
            'clinvar': {'file': clinvar.name, 'sha256': sha256(clinvar), 'bytes': clinvar.stat().st_size, 'releaseDate': None,
                'url': 'https://www.ncbi.nlm.nih.gov/clinvar/', 'rowsScanned': total, 'rowsMatched': matched,
                'extractedFile': 'clinvar-col7a1.tsv', 'extractedSha256': sha256(subset), 'columns': header,
                'lineNumberConvention': '1-based physical lines of decompressed source; header is line 1; row hashes exclude CR/LF'},
            'uniprot': {'file': uniprot.name, 'sha256': sha256(uniprot), 'bytes': uniprot.stat().st_size, 'url': protein['url'], 'entryAudit': protein['entryAudit']},
        },
        'processing': {'script': 'scripts/process_data.py', 'scriptSha256': sha256(Path(__file__)),
            'grouping': 'One record per VariationID; all matching alleles, names, assemblies and source lines preserved.',
            'geneFilter': 'Exact COL7A1 token in GeneSymbol, including multigene variants.',
            'mapping': 'Explicit protein HGVS only, exact RefSeq accession linked to Q02388-1 in local UniProt, with endpoint reference residues checked against its sequence. Inclusive interval overlap with domains.',
            'limitations': ['No transcript/CDS/exon sequence or alignment is supplied. Coding/genomic coordinates are not converted to protein coordinates.',
                'Frameshifts map only their reported anchor; truncations map their reported residue. No downstream affected-domain inference.',
                'Residue checks support positional mapping but do not constitute full transcript alignment or clinical interpretation.',
                'Overlapping subdomains and regions are retained. Domain membership does not imply clinical effect.',
                'Phenotype summaries such as "7 conditions" and "not provided" are retained verbatim; the source is not a complete condition-level assertion file.',
                'Clinical significance and review status are source aggregates. No new pathogenicity classifications are assigned.',
                'ClinVar release date is not recorded in this file; LastEvaluated is per-record, not a snapshot date.']},
        'summary': {'sourceRows': matched, 'variants': len(variants), 'mapped': counts['mapped'], 'unmapped': counts['unmapped'],
            'significanceGroups': dict(sorted(collections.Counter(v['significanceGroup'] for v in variants).items())),
            'unmappedReasons': dict(sorted(collections.Counter(v['proteinMapping']['reason'] for v in variants if v['proteinMapping']['status'] != 'mapped').items()))},
        'protein': protein, 'variants': variants}
    (output / 'variants.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(data['summary'], indent=2))
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clinvar', type=Path, default=ROOT / 'variant_summary.txt.gz')
    parser.add_argument('--uniprot', type=Path, default=ROOT / 'Q02388.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/data')
    args = parser.parse_args()
    process(args.clinvar.resolve(), args.uniprot.resolve(), args.output.resolve())
