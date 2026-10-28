import { GROUPS } from "./data-utils.mjs";

// Validate the boundary shared by the static build and the browser. This checks
// structure and consistency, not clinical interpretation or source completeness.
export function validateDataset(data) {
  const fail = (path, expectation) => {
    throw new Error(`Invalid dataset: ${path} ${expectation}`);
  };
  const object = (value, path) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(path, "must be an object");
  };
  const string = (value, path) => {
    if (typeof value !== "string") fail(path, "must be text");
  };
  const integer = (value, path, minimum = 0) => {
    if (!Number.isSafeInteger(value) || value < minimum)
      fail(path, `must be an integer of at least ${minimum}`);
  };
  const array = (value, path) => {
    if (!Array.isArray(value)) fail(path, "must be an array");
  };
  const strings = (value, path) => {
    array(value, path);
    value.forEach((item, i) => string(item, `${path}[${i}]`));
  };
  const hash = (value, path) => {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
      fail(path, "must be a SHA-256 hash");
  };
  const https = (value, path) => {
    string(value, path);
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password)
        fail(path, "must be an HTTPS URL without credentials");
    } catch {
      fail(path, "must be an HTTPS URL without credentials");
    }
  };
  const nullableString = (value, path) => {
    if (value !== null) string(value, path);
  };
  const nullablePosition = (value, path) => {
    if (value !== null) integer(value, path, 1);
  };

  object(data, "root");
  if (data.schemaVersion !== "1.0.0") fail("schemaVersion", "is unsupported");
  object(data.summary, "summary");
  for (const key of ["variants", "sourceRows", "mapped", "unmapped"])
    integer(data.summary[key], `summary.${key}`);
  object(data.sources, "sources");
  for (const key of ["clinvar", "uniprot"]) {
    const source = data.sources[key];
    object(source, `sources.${key}`);
    string(source.file, `sources.${key}.file`);
    hash(source.sha256, `sources.${key}.sha256`);
  }
  hash(data.sources.clinvar.extractedSha256, "sources.clinvar.extractedSha256");
  object(data.processing, "processing");
  string(data.processing.mapping, "processing.mapping");
  strings(data.processing.limitations, "processing.limitations");

  const protein = data.protein;
  object(protein, "protein");
  integer(protein.length, "protein.length", 1);
  string(protein.sequence, "protein.sequence");
  if (protein.sequence.length !== protein.length)
    fail("protein.sequence", "must match protein.length");
  https(protein.url, "protein.url");
  object(protein.entryAudit, "protein.entryAudit");
  string(protein.entryAudit.lastAnnotationUpdateDate, "protein.entryAudit.lastAnnotationUpdateDate");
  array(protein.domains, "protein.domains");
  const domainIds = new Set();
  protein.domains.forEach((domain, i) => {
    const path = `protein.domains[${i}]`;
    object(domain, path);
    for (const key of ["id", "label", "level", "description"])
      string(domain[key], `${path}.${key}`);
    if (!domain.id || domainIds.has(domain.id)) fail(`${path}.id`, "must be unique and nonempty");
    domainIds.add(domain.id);
    integer(domain.start, `${path}.start`, 1);
    integer(domain.end, `${path}.end`, domain.start);
    if (domain.end > protein.length) fail(`${path}.end`, "exceeds protein.length");
  });

  array(data.variants, "variants");
  if (data.variants.length !== data.summary.variants)
    fail("summary.variants", "does not match the variant count");
  const variantIds = new Set(), variationIds = new Set(), sourceLines = new Set();
  let mappedCount = 0, sourceRowCount = 0;
  for (const [index, variant] of data.variants.entries()) {
    const path = `variants[${index}]`;
    object(variant, path);
    string(variant.id, `${path}.id`);
    if (!variant.id || variantIds.has(variant.id)) fail(`${path}.id`, "must be unique and nonempty");
    variantIds.add(variant.id);
    integer(variant.variationId, `${path}.variationId`, 1);
    if (variationIds.has(variant.variationId)) fail(`${path}.variationId`, "must be unique");
    variationIds.add(variant.variationId);
    for (const key of [
      "names", "geneSymbols", "conditions", "conditionIdentifiers", "rcvAccessions",
      "clinicalSignificance", "reviewStatus", "types", "codingHgvs", "proteinHgvs",
      "lastEvaluated", "dbSnpIds", "otherIds",
    ]) strings(variant[key], `${path}.${key}`);
    array(variant.alleleIds, `${path}.alleleIds`);
    variant.alleleIds.forEach((id, i) => integer(id, `${path}.alleleIds[${i}]`, 1));
    if (!Object.hasOwn(GROUPS, variant.significanceGroup))
      fail(`${path}.significanceGroup`, "is unsupported");
    https(variant.url, `${path}.url`);
    const mapping = variant.proteinMapping;
    object(mapping, `${path}.proteinMapping`);
    if (!["mapped", "unmapped"].includes(mapping.status))
      fail(`${path}.proteinMapping.status`, "is unsupported");
    strings(mapping.domainIds, `${path}.proteinMapping.domainIds`);
    strings(mapping.regionLabels, `${path}.proteinMapping.regionLabels`);
    nullableString(mapping.reason, `${path}.proteinMapping.reason`);
    if (mapping.extent !== undefined)
      nullableString(mapping.extent, `${path}.proteinMapping.extent`);
    for (const id of mapping.domainIds)
      if (!domainIds.has(id)) fail(`${path}.proteinMapping.domainIds`, "contains an unknown domain");
    if (mapping.status === "mapped") {
      mappedCount++;
      integer(mapping.start, `${path}.proteinMapping.start`, 1);
      integer(mapping.end, `${path}.proteinMapping.end`, mapping.start);
      if (mapping.end > protein.length) fail(`${path}.proteinMapping.end`, "exceeds protein.length");
    } else if (mapping.start !== null || mapping.end !== null || mapping.domainIds.length) {
      fail(`${path}.proteinMapping`, "cannot assign coordinates or domains when unmapped");
    }
    array(variant.genomicPositions, `${path}.genomicPositions`);
    variant.genomicPositions.forEach((position, i) => {
      const p = `${path}.genomicPositions[${i}]`;
      object(position, p);
      for (const key of ["assembly", "chromosome", "chromosomeAccession", "vcfReference", "vcfAlternate"])
        nullableString(position[key], `${p}.${key}`);
      for (const key of ["start", "end", "vcfPosition"])
        nullablePosition(position[key], `${p}.${key}`);
    });
    array(variant.sourceRecords, `${path}.sourceRecords`);
    variant.sourceRecords.forEach((source, i) => {
      const p = `${path}.sourceRecords[${i}]`;
      object(source, p);
      integer(source.line, `${p}.line`, 2);
      hash(source.sha256, `${p}.sha256`);
      if (sourceLines.has(source.line)) fail(`${p}.line`, "must occur only once in the dataset");
      sourceLines.add(source.line);
      sourceRowCount++;
    });
  }
  if (mappedCount !== data.summary.mapped || data.variants.length - mappedCount !== data.summary.unmapped)
    fail("summary", "mapping counts do not match the records");
  if (sourceRowCount !== data.summary.sourceRows)
    fail("summary.sourceRows", "does not match the source record count");
  return data;
}
