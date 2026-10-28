import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

// Run after `npm run build`, with `npm run preview` running in another terminal.
// BASE_URL can point to a deployed preview or production site for a smoke audit.
const baseURL = process.env.BASE_URL || "http://127.0.0.1:3000";
const source = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
let browser, context, page, errors;
const search = () => page.getByRole("searchbox", { name: "Search variants" });
const tableRows = () => page.locator("tbody tr");
const ids = () => page.locator("tbody .clinvar-link").allTextContents();
async function expectCount(count) {
  await page.waitForFunction((expected) =>
    Number(document.querySelector(".count-pill")?.textContent.replaceAll(",", "")) === expected,
  count);
  assert.equal(await tableRows().count(), Math.min(50, count));
}
async function query(value, count) {
  await search().fill(value);
  await expectCount(count);
}
async function expectNoPageOverflow() {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.page <= dimensions.viewport + 1,
    `Document overflows: ${JSON.stringify(dimensions)}`);
}
function csvRows(text) {
  // Parse quoted CSV, including embedded commas/newlines and escaped quotes.
  const rows = [], row = [];
  let cell = "", quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (c === "\r" || c === "\n")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push([...row]); row.length = 0; cell = "";
    } else cell += c;
  }
  assert.equal(quoted, false, "CSV must not end inside a quoted field");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await context.newPage();
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Explore the variants/ }).waitFor();
  await expectCount(source.summary.variants);
});
afterEach(async () => {
  await context?.close();
  assert.deepEqual(errors, [], "No application errors should reach the browser console");
});

test("initial dataset counts and direct HGVS, exact ID, dbSNP and genomic searches", async () => {
  assert.match(await page.locator(".stats").innerText(), /6,522[\s\S]*4,268[\s\S]*2,254/);
  for (const value of ["c.8393T>A", "p.Met2798Lys", "id:17423", "rs121912828"]) {
    await query(value, 1);
    assert.deepEqual((await ids()).map(x => Number(x.replace(/\D/g, ""))), [17423], value);
  }
  const coordinateMatches = source.variants.filter(v => v.genomicPositions.some(p =>
    p.assembly === "GRCh38" && p.chromosome === "3" && p.start <= 48566281 && p.end >= 48566281));
  await query("GRCh38 chr3:48566281", coordinateMatches.length);
  assert.deepEqual((await ids()).map(x => Number(x.replace(/\D/g, ""))), coordinateMatches.map(v => v.variationId));
  await query("this-variant-does-not-exist", 0);
  await page.getByRole("heading", { name: "No matching variants" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Export CSV/ }).isDisabled(), true);
  await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  await expectCount(source.summary.variants);
});

test("classification, domain and mapping filters combine and reset correctly", async () => {
  const nc2 = source.protein.domains.find(d => d.label === "NC2").id;
  const expected = source.variants.filter(v =>
    v.clinicalSignificance.includes("Pathogenic/Likely pathogenic") && v.proteinMapping.domainIds.includes(nc2));
  await page.getByLabel("Clinical significance", { exact: true }).selectOption("Pathogenic/Likely pathogenic");
  await page.getByLabel("Protein domain", { exact: true }).selectOption(nc2);
  await expectCount(expected.length);
  await page.getByLabel("Protein mapping", { exact: true }).selectOption("unmapped");
  await expectCount(0);
  await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  await page.getByLabel("Protein mapping", { exact: true }).selectOption("unmapped");
  await expectCount(source.summary.unmapped);
  assert.equal(await page.locator("tbody .domain-text").count(), 0);
});

test("protein chart domain and residue selections work with mouse and keyboard", async () => {
  const nc2 = source.protein.domains.find(d => d.label === "NC2").id;
  const expected = source.variants.filter(v => v.proteinMapping.domainIds.includes(nc2));
  const domain = page.getByRole("button", { name: /^Filter NC2,/ });
  await domain.click();
  await expectCount(expected.length);
  assert.equal(await domain.getAttribute("aria-pressed"), "true");
  await domain.press("Enter");
  await expectCount(source.summary.variants);
  assert.equal(await domain.getAttribute("aria-pressed"), "false");
  const chartStops = page.locator(".histogram-bin[tabindex='0']");
  assert.equal(await chartStops.count(), 1, "Histogram should occupy one tab stop");
  await chartStops.focus();
  const firstLabel = await page.locator(":focus").getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.locator(":focus").getAttribute("aria-label"), firstLabel);
  const selectedLabel = await page.locator(":focus").getAttribute("aria-label");
  const [, start, end] = selectedLabel.match(/amino acids (\d+) to (\d+)/);
  await page.keyboard.press("Enter");
  await expectCount(source.variants.filter(v => v.proteinMapping.status === "mapped" &&
    v.proteinMapping.start <= Number(end) && v.proteinMapping.end >= Number(start)).length);
  assert.equal(await page.locator(":focus").getAttribute("aria-pressed"), "true");
});

test("sort and both pagination controls preserve the correct records", async () => {
  const sorted = [...source.variants].sort((a, b) => b.variationId - a.variationId);
  await page.getByRole("combobox", { name: "Sort variants" }).selectOption("id-desc");
  await page.waitForFunction(expected => Number(document.querySelector("tbody .clinvar-link")?.textContent.replace(/\D/g, "")) === expected, sorted[0].variationId);
  await page.getByRole("button", { name: "Next page", exact: true }).first().click();
  await page.waitForFunction(expected => Number(document.querySelector("tbody .clinvar-link")?.textContent.replace(/\D/g, "")) === expected, sorted[50].variationId);
  assert.deepEqual((await ids()).map(x => Number(x.replace(/\D/g, ""))), sorted.slice(50, 100).map(v => v.variationId));
  await page.getByRole("button", { name: "Previous page", exact: true }).last().click();
  await page.waitForFunction(expected => Number(document.querySelector("tbody .clinvar-link")?.textContent.replace(/\D/g, "")) === expected, sorted[0].variationId);
  await query("id:17423", 1);
  for (const next of await page.getByRole("button", { name: "Next page", exact: true }).all())
    assert.equal(await next.isDisabled(), true);
});

test("shared URLs restore filters, page, sort and the open evidence record", async () => {
  const url = new URL(baseURL);
  url.search = new URLSearchParams({ sort: "id-desc", page: "2" }).toString();
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Explore the variants/ }).waitFor();
  const expected = [...source.variants].sort((a, b) => b.variationId - a.variationId).slice(50, 100);
  assert.deepEqual((await ids()).map(x => Number(x.replace(/\D/g, ""))), expected.map(v => v.variationId));
  assert.equal(await page.getByRole("combobox", { name: "Sort variants" }).inputValue(), "id-desc");
  await query("id:17423", 1);
  await page.getByRole("button", { name: "View evidence", exact: true }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get("variant") === "17423");
  assert.equal(new URL(page.url()).searchParams.get("q"), "id:17423");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("dialog").waitFor();
  assert.equal(await search().inputValue(), "id:17423");
  assert.match(await page.getByRole("dialog").innerText(), /CLINVAR VARIATION 17423/);
  await page.getByRole("button", { name: "Close variant details", exact: true }).click();
  await page.waitForFunction(() => !new URLSearchParams(location.search).has("variant"));
});

test("evidence dialog retains inside clicks, closes via Escape/backdrop and restores focus", async () => {
  await query("id:17423", 1);
  const opener = page.getByRole("button", { name: "View evidence", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /aa 2798[\s\S]*NC2/);
  const box = await dialog.boundingBox();
  await page.mouse.click(box.x + 8, box.y + 8);
  assert.equal(await dialog.isVisible(), true, "Clicking dialog padding must not dismiss it");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await opener.evaluate(el => el === document.activeElement), true);
  await opener.click();
  await dialog.waitFor();
  await page.mouse.click(4, 4);
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await opener.evaluate(el => el === document.activeElement), true);
});

test("CSV download contains every filtered record beyond the current page", async () => {
  const expected = source.variants.filter(v => v.clinicalSignificance.includes("Pathogenic"));
  assert.ok(expected.length > 50);
  await page.getByLabel("Clinical significance", { exact: true }).selectOption("Pathogenic");
  await expectCount(expected.length);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export CSV/ }).click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.csv$/);
  const rows = csvRows(await readFile(await download.path(), "utf8"));
  assert.equal(rows.length, expected.length + 1);
  assert.ok(rows[0].includes("Source row SHA256"));
  assert.deepEqual(rows.slice(1).map(row => Number(row[0])).sort((a, b) => a - b), expected.map(v => v.variationId).sort((a, b) => a - b));
  assert.ok(rows.every(row => row.length === rows[0].length));
});

test("source downloads retain the committed evidence and valid external links", async () => {
  await page.getByRole("link", { name: "Data & methods", exact: true }).click();
  assert.equal(await page.locator("details.sources").getAttribute("open"), "");
  for (const [name, path, expectedHash] of [
    ["Processed JSON", "variants.json", null],
    ["Original matching rows", "clinvar-col7a1.tsv", source.sources.clinvar.extractedSha256],
    ["UniProt source JSON", "Q02388.json", source.sources.uniprot.sha256],
  ]) {
    const link = page.getByRole("link", { name: new RegExp(name) });
    assert.equal(await link.getAttribute("download"), "");
    const response = await context.request.get(new URL(`data/${path}`, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).href);
    assert.equal(response.status(), 200, path);
    const body = await response.body();
    if (expectedHash) assert.equal(createHash("sha256").update(body).digest("hex"), expectedHash, path);
    else assert.equal(JSON.parse(body).variants.length, source.summary.variants);
  }
  const links = await page.locator("a[target='_blank']").evaluateAll(elements => elements.map(e => ({ href: e.href, rel: e.rel })));
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.match(link.href, /^https:\/\/(www\.)?(ncbi\.nlm\.nih\.gov|uniprot\.org)\//);
    assert.match(link.rel, /noreferrer|noopener/);
  }
});

test("skip link and search shortcut avoid the chart; mobile widths keep page and dialog in bounds", async () => {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /Skip to variants/i });
  assert.equal(await skip.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Enter");
  await page.keyboard.press("/");
  assert.equal(await search().evaluate(el => el === document.activeElement), true);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoPageOverflow();
    await query("id:17423", 1);
    await page.getByRole("button", { name: "View evidence", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Dialog exceeds ${width}px viewport`);
    await expectNoPageOverflow();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
});

test("dataset failures show an actionable retry and recover without stale errors", async () => {
  await page.route("**/data/variants.json", route => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "The dataset could not be loaded." }).waitFor();
  await page.unroute("**/data/variants.json");
  // A deliberate 503 is the expected network error for this test.
  errors = errors.filter(message => !message.includes("503"));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expectCount(source.summary.variants);
});

test("a successful HTTP response with malformed dataset content fails safely", async () => {
  await page.route("**/data/variants.json", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: "1.0.0", variants: [{}] }),
  }));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "The dataset could not be loaded." }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Try again", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("heading", { name: /Explore the variants/ }).count(), 0);
});
