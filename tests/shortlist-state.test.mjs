import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SHORTLIST, STORAGE_KEY, normalizeShortlistIds, parseShortlistParam,
  serializeShortlistIds, readSavedShortlist, writeSavedShortlist, toggleShortlistId,
} from "../src/shortlist-state.mjs";

const variants = Array.from({ length: 30 }, (_, index) => Object.freeze({ variationId: index + 1 }));
function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) { assert.equal(key, STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, STORAGE_KEY); value = next; },
    value: () => value,
  };
}

test("shortlists validate snapshot membership and deduplicate numeric identifiers without mutating input", () => {
  const original = Object.freeze([3, 1, 3, "2", null, -1, 0, 1.5, NaN, Infinity, 9007199254740992, 999, 2]);
  assert.deepEqual(normalizeShortlistIds(original, variants), [3, 1, 2]);
  assert.equal(original.length, 13);
  for (const value of [null, undefined, "1,2", { ids: [1, 2] }])
    assert.deepEqual(normalizeShortlistIds(value, variants), []);
  assert.deepEqual(normalizeShortlistIds([1, 2], []), []);
});

test("shortlists cap valid unique entries after filtering invalid entries and preserve selection order", () => {
  const input = [999, 999, ...Array.from({ length: 30 }, (_, i) => 30 - i)];
  assert.deepEqual(normalizeShortlistIds(input, variants), Array.from({ length: MAX_SHORTLIST }, (_, i) => 30 - i));
  assert.equal(input.length, 32);
});

test("shared lists round-trip canonical IDs and ignore malformed tokens without coercing their contents", () => {
  const ids = [5, 2, 1];
  assert.deepEqual(parseShortlistParam(serializeShortlistIds(ids), variants), ids);
  assert.deepEqual(parseShortlistParam("5,2,,x,3foo,1e1,-1,0,4.5, 6,999,9007199254740992,1,2", variants), ids);
  assert.deepEqual(parseShortlistParam("0003,1", variants), [3, 1]);
  assert.deepEqual(parseShortlistParam("1,".repeat(501), variants), []);
  assert.deepEqual(parseShortlistParam(undefined, variants), []);
  assert.equal(serializeShortlistIds([3, 3, 2, { variationId: 1 }, "1"]), "3,2");
});

test("browser persistence stores only bounded numeric IDs and restores against the current snapshot", () => {
  const storage = memoryStorage();
  assert.deepEqual(readSavedShortlist(storage, variants), { ids: [], notice: "" });
  const ids = [4, 3, 2, 1];
  assert.equal(writeSavedShortlist(storage, ids), "");
  assert.equal(storage.value(), "[4,3,2,1]");
  assert.deepEqual(readSavedShortlist(storage, [{ variationId: 4 }, { variationId: 1 }]), { ids: [4, 1], notice: "" });
  assert.deepEqual(ids, [4, 3, 2, 1]);
  writeSavedShortlist(storage, [2, { variationId: 3, privateNote: "must not persist" }, "1", 2, 1]);
  assert.equal(storage.value(), "[2,1]");
  writeSavedShortlist(storage, variants.map(v => v.variationId));
  assert.equal(JSON.parse(storage.value()).length, MAX_SHORTLIST);
});

test("unavailable or corrupt browser storage cannot prevent an in-memory shortlist", () => {
  for (const initial of ["{", "null", "2", '{"ids":[1]}', "[".repeat(1001)]) {
    const result = readSavedShortlist(memoryStorage(initial), variants);
    assert.deepEqual(result.ids, []);
    assert.ok(result.notice.length);
  }
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota exceeded"); } };
  assert.deepEqual(readSavedShortlist(broken, variants).ids, []);
  assert.ok(readSavedShortlist(broken, variants).notice.length);
  assert.ok(writeSavedShortlist(broken, [1]).length);
  assert.ok(readSavedShortlist(null, variants).notice.length);
  assert.ok(writeSavedShortlist(null, [1]).length);
  assert.deepEqual(toggleShortlistId([], 2, variants).ids, [2]);
});

test("toggling removes saved IDs at capacity, rejects unavailable IDs, and reports a full list", () => {
  const full = Object.freeze(Array.from({ length: MAX_SHORTLIST }, (_, i) => i + 1));
  assert.deepEqual(toggleShortlistId([2, 1], 3, variants), { ids: [2, 1, 3], notice: "" });
  const blocked = toggleShortlistId(full, 25, variants);
  assert.deepEqual(blocked.ids, full);
  assert.match(blocked.notice, /24/);
  const removed = toggleShortlistId(full, 1, variants);
  assert.equal(removed.ids.length, MAX_SHORTLIST - 1);
  assert.equal(removed.notice, "");
  assert.equal(full.length, MAX_SHORTLIST);
  assert.deepEqual(toggleShortlistId([2, 1], 999, variants).ids, [2, 1]);
  assert.ok(toggleShortlistId([2, 1], "2", variants).notice.length);
});
