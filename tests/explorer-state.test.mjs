import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EMPTY_FILTERS } from "../src/data-utils.mjs";
import { UNCLASSIFIED } from "../src/chart-data.mjs";
import {
  EXPLORER_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  readExplorerState,
  writeExplorerState,
} from "../src/explorer-state.mjs";

const data = JSON.parse(
  await readFile(new URL("../public/data/variants.json", import.meta.url)),
);
const defaults = () => ({ filters: { ...EMPTY_FILTERS }, sort: "id", page: 0, selectedId: null, shortlistIds: [], comparisonOpen: false });
const read = (search) => readExplorerState(search, data);

test("missing-classification chart selection survives a shared URL", () => {
  const state = { ...defaults(), filters: { ...EMPTY_FILTERS, significance: UNCLASSIFIED } };
  assert.deepEqual(read(`?${writeExplorerState(state)}`), state);
});

test("empty state restores defaults and serializes to a clean URL", () => {
  assert.deepEqual(read(""), defaults());
  assert.deepEqual(read(undefined), defaults());
  assert.deepEqual(read(["q=wrong-shape"]), defaults());
  assert.equal(writeExplorerState(defaults()).toString(), "");
  assert.equal(writeExplorerState().toString(), "");
});

test("a complete filtered variant permalink survives an exact round trip", () => {
  const variant = data.variants.find((v) => v.variationId === 17423);
  const state = {
    filters: {
      ...EMPTY_FILTERS,
      query: "c.8393T>A",
      significance: variant.clinicalSignificance[0],
      review: variant.reviewStatus[0],
      domain: variant.proteinMapping.domainIds[0],
      mapping: "mapped",
      type: variant.types[0],
      range: [2785, 2944],
    },
    sort: "position",
    page: 0,
    selectedId: 17423,
    shortlistIds: [],
    comparisonOpen: false,
  };
  const params = writeExplorerState(state);
  assert.ok(params instanceof URLSearchParams);
  assert.equal(params.get("q"), "c.8393T>A");
  assert.equal(params.get("variant"), "17423");
  assert.deepEqual(read(`?${params}`), state);
  assert.equal(writeExplorerState(read(`?${params}`)).toString(), params.toString());
});

test("URL pages are one-based and clamp to the current result count", () => {
  assert.equal(read("?page=1").page, 0);
  assert.equal(read("?page=2").page, 1);
  assert.equal(writeExplorerState({ ...defaults(), page: 2 }).get("page"), "3");
  assert.equal(read("?page=9999999999").page, Math.ceil(data.variants.length / EXPLORER_PAGE_SIZE) - 1);
  assert.equal(read("?q=id%3A17423&page=100").page, 0);
  assert.equal(read("?q=does-not-exist-xyz&page=2").page, 0);
  for (const page of ["0", "-1", "1.5", "1e3", "Infinity", "NaN", "9007199254740992"])
    assert.equal(read(`?page=${page}`).page, 0, page);
  const state = { ...defaults(), page: 3, sort: "id-desc" };
  assert.deepEqual(read(`?${writeExplorerState(state)}`), state);
});

test("unknown options, duplicate parameters, and array-shaped parameters fall back safely", () => {
  assert.deepEqual(read("?significance=not-real&review=not-real&domain=not-real&mapping=all&type=not-real&sort=other&variant=999999999"), defaults());
  assert.deepEqual(read("?q=first&q=second&page=1&page=2&range=1-25&range=26-50&variant=17423&variant=17425"), defaults());
  assert.deepEqual(read("?q[]=text&range[]=1&range[]=25&selectedId=17423&admin=true"), defaults());
  assert.equal(writeExplorerState(read("?unknown=ignored&mapping=unmapped")).toString(), "mapping=unmapped");
  assert.equal(read("?mapping=MAPPED").filters.mapping, "");
});

test("protein ranges enforce one-based inclusive sequence boundaries", () => {
  const length = data.protein.length;
  for (const range of [[1, 1], [1, length], [length, length]])
    assert.deepEqual(read(`?range=${range.join("-")}`).filters.range, range);
  for (const range of ["0-25", "25-1", `1-${length + 1}`, "1.5-25", "-1-25", "1-2-3", "1-Infinity", "1-9007199254740992"])
    assert.equal(read(`?range=${range}`).filters.range, null, range);
});

test("a valid selected variant restores independently of active filters", () => {
  const state = read("?mapping=unmapped&variant=17423");
  assert.equal(state.filters.mapping, "unmapped");
  assert.equal(state.selectedId, 17423);
  for (const variant of ["0", "-1", "17423.0", "clinvar-17423", "9007199254740992"])
    assert.equal(read(`?variant=${variant}`).selectedId, null, variant);
});

test("query encoding preserves meaningful characters and bounds oversized input", () => {
  const state = { ...defaults(), filters: { ...EMPTY_FILTERS, query: "p.Arg+Gly > & ? #" } };
  assert.deepEqual(read(`?${writeExplorerState(state)}`), state);
  const oversized = "x".repeat(MAX_SEARCH_LENGTH + 100);
  assert.equal(read(`?q=${oversized}`).filters.query.length, MAX_SEARCH_LENGTH);
  assert.equal(writeExplorerState({ filters: { query: oversized } }).get("q").length, MAX_SEARCH_LENGTH);
});

test("serialization ignores unknown properties and malformed internal shapes", () => {
  const params = writeExplorerState({
    filters: { query: ["bad"], significance: {}, mapping: "all", range: [1, 2, 3], injected: "true" },
    sort: "invalid", page: Infinity, selectedId: [17423], injected: "true",
  });
  assert.equal(params.toString(), "");
  assert.equal(writeExplorerState({ filters: [], page: -1 }).toString(), "");
  assert.equal(writeExplorerState(null).toString(), "");
});
