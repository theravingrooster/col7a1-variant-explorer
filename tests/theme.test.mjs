import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { applyTheme, normalizeTheme, preferredTheme, saveTheme, THEME_STORAGE_KEY } from "../src/theme.mjs";

const bootstrap = await readFile(new URL("../public/theme-init.js", import.meta.url), "utf8");

function environment({ saved = null, dark = false, blocked = false } = {}) {
  return {
    get localStorage() {
      if (blocked) throw new Error("Storage blocked");
      return {
        getItem: key => key === THEME_STORAGE_KEY ? saved : null,
        setItem: (key, value) => { assert.equal(key, THEME_STORAGE_KEY); saved = value; },
      };
    },
    matchMedia: () => ({ matches: dark }),
  };
}

function fakeDocument() {
  const meta = { content: "#173f34" };
  return {
    documentElement: { dataset: {}, style: {} },
    querySelector: selector => selector === 'meta[name="theme-color"]' ? meta : null,
    meta,
  };
}

test("saved light and dark preferences take precedence over system theme", () => {
  assert.equal(preferredTheme(environment({ saved: "light", dark: true })), "light");
  assert.equal(preferredTheme(environment({ saved: "dark", dark: false })), "dark");
  assert.equal(preferredTheme(environment({ dark: true })), "dark");
  assert.equal(preferredTheme(environment({ dark: false })), "light");
});

test("invalid or unavailable storage falls back safely to system preference", () => {
  for (const value of [null, "", "system", "DARK", "javascript:alert(1)", 0]) {
    assert.equal(normalizeTheme(value), null);
    assert.equal(preferredTheme(environment({ saved: value, dark: true })), "dark");
  }
  assert.equal(preferredTheme(environment({ blocked: true, dark: true })), "dark");
  assert.equal(preferredTheme({}), "light");
});

test("theme persistence tolerates restricted storage and ignores invalid values", () => {
  const env = environment();
  saveTheme(env, "dark");
  assert.equal(preferredTheme(env), "dark");
  saveTheme(env, "invalid");
  assert.equal(preferredTheme(env), "dark");
  assert.doesNotThrow(() => saveTheme(environment({ blocked: true }), "light"));
});

test("pre-render initializer and runtime choose identical themes in every fallback case", () => {
  for (const setup of [
    { saved: "light", dark: true }, { saved: "dark", dark: false },
    { saved: "invalid", dark: true }, { dark: false },
    { dark: true, blocked: true }, { blocked: true },
  ]) {
    const window = environment(setup), document = fakeDocument();
    vm.runInNewContext(bootstrap, { window, document });
    assert.equal(document.documentElement.dataset.theme, preferredTheme(window));
    assert.equal(document.documentElement.style.colorScheme, preferredTheme(window));
    const runtimeDocument = fakeDocument();
    applyTheme(runtimeDocument, preferredTheme(window));
    assert.equal(document.meta.content, runtimeDocument.meta.content);
  }
});

test("initializer is external and runs before CSS without async or defer", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const tag = html.match(/<script[^>]+src="\.\/theme-init\.js"[^>]*>/)?.[0];
  assert.ok(tag);
  assert.doesNotMatch(tag, /\b(?:async|defer|type=)/);
  assert.ok(html.indexOf(tag) < html.indexOf('rel="stylesheet"'));
});
