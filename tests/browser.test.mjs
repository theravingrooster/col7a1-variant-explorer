import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { sortVariants, TABLE_SORT_FIELDS } from "../src/variant-sort.mjs";

// Run after `npm run build`, with `npm run preview` running in another terminal.
// BASE_URL can point to a deployed preview or production site for a smoke audit.
const baseURL = process.env.BASE_URL || "http://127.0.0.1:3000";
const source = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
let browser, context, page, errors;
const search = () => page.getByRole("searchbox", { name: "Search variants" });
const tableRows = () => page.locator("tbody tr");
const ids = () => page.locator("tbody .clinvar-link").allTextContents();
const multipleSubmittersReview = "criteria provided, multiple submitters, no conflicts";
const filterControl = label => page.getByRole("combobox", { name: label, exact: true, includeHidden: true });
const resetAll = () => page.getByRole("button", { name: "Reset all filters", exact: true });
async function openFilters() {
  const toggle = page.getByRole("button", { name: /^More filters/ });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}
async function openRangeControls() {
  const toggle = page.getByRole("button", { name: "Set residue range", exact: true });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}
async function openDomainChart() {
  await page.getByRole("tab", { name: "Domain comparison", exact: true }).click();
}
async function selectFilter(label, value) {
  await openFilters();
  await filterControl(label).selectOption(value);
}
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
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, colorScheme: "light", reducedMotion: "no-preference" });
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
  assert.match(await page.locator(".research-toolbar .toolbar-count").innerText(), /6,522 matching variants/);
  const mapSummary = await page.locator(".protein-panel .map-summary").innerText();
  assert.match(mapSummary, /4,268 mapped variants/);
  assert.match(mapSummary, /2,254 without protein mapping/);
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
  await resetAll().click();
  await expectCount(source.summary.variants);
});

test("classification, domain and mapping filters combine and reset correctly", async () => {
  const nc2 = source.protein.domains.find(d => d.label === "NC2").id;
  const expected = source.variants.filter(v =>
    v.clinicalSignificance.includes("Pathogenic/Likely pathogenic") && v.proteinMapping.domainIds.includes(nc2));
  await selectFilter("Clinical significance", "Pathogenic/Likely pathogenic");
  await selectFilter("Protein domain", nc2);
  await expectCount(expected.length);
  await selectFilter("Protein mapping", "unmapped");
  const unmappedClassified = source.variants.filter(v => v.clinicalSignificance.includes("Pathogenic/Likely pathogenic") && v.proteinMapping.status === "unmapped");
  await expectCount(unmappedClassified.length);
  assert.equal(await filterControl("Protein domain").inputValue(), "", "Unmapped-only selection clears incompatible domain restrictions");
  assert.equal(await filterControl("Clinical significance").inputValue(), "Pathogenic/Likely pathogenic", "Classification remains active when spatial filters are cleared");
  await page.waitForFunction(() => !new URLSearchParams(location.search).has("domain") && !new URLSearchParams(location.search).has("range"));
  assert.deepEqual((await ids()).map(x => Number(x.replace(/\D/g, ""))), unmappedClassified.slice(0, 50).map(v => v.variationId));
  await resetAll().click();
  await selectFilter("Protein mapping", "unmapped");
  await expectCount(source.summary.unmapped);
  assert.equal(await page.locator("tbody .domain-text").count(), 0);
});

test("clinical summary shows exact source counts and toggles the table classification filter", async () => {
  const classificationChart = page.getByRole("group", { name: "Variant counts by clinical significance", exact: true });
  const pathogenic = classificationChart.getByRole("button", { name: "Filter Pathogenic: 674 variants in current results", exact: true });
  const notReported = classificationChart.getByRole("button", { name: "Filter Not reported: 38 variants in current results", exact: true });
  assert.equal(await pathogenic.isVisible(), true);
  assert.equal(await notReported.isVisible(), true);
  assert.equal(await pathogenic.locator(".chart-count").innerText(), "674");
  assert.equal(await notReported.locator(".chart-count").innerText(), "38");
  await pathogenic.click();
  await expectCount(674);
  assert.equal(await filterControl("Clinical significance").inputValue(), "Pathogenic");
  assert.equal(await pathogenic.getAttribute("aria-pressed"), "true");
  assert.ok((await page.locator("tbody .badge").allTextContents()).every(label => label.trim() === "Pathogenic"));
  await pathogenic.click();
  await expectCount(source.summary.variants);
  assert.equal(await filterControl("Clinical significance").inputValue(), "");
  assert.equal(await pathogenic.getAttribute("aria-pressed"), "false");
});

test("a stacked domain/classification segment applies both filters and clears the selected pair", async () => {
  await openDomainChart();
  const nc2 = source.protein.domains.find(d => d.label === "NC2").id;
  const expected = source.variants.filter(v => v.clinicalSignificance.includes("Pathogenic") && v.proteinMapping.domainIds.includes(nc2));
  assert.equal(expected.length, 25);
  const pair = page.getByRole("group", { name: "Variant counts by protein domain and clinical significance", exact: true })
    .getByRole("button", { name: "Filter NC2 and Pathogenic: 25 variants in current results", exact: true });
  await pair.click();
  await expectCount(25);
  assert.equal(await filterControl("Protein domain").inputValue(), nc2);
  assert.equal(await filterControl("Clinical significance").inputValue(), "Pathogenic");
  assert.equal(await pair.getAttribute("aria-pressed"), "true");
  assert.deepEqual((await ids()).map(x => Number(x.replace(/\D/g, ""))), expected.map(v => v.variationId));
  await pair.click();
  await expectCount(source.summary.variants);
  assert.equal(await filterControl("Protein domain").inputValue(), "");
  assert.equal(await filterControl("Clinical significance").inputValue(), "");
  assert.equal(await pair.getAttribute("aria-pressed"), "false");
});

test("summary charts count all filtered pages and show truthful zero-result counts", async () => {
  await selectFilter("Clinical significance", "Pathogenic");
  await expectCount(674);
  assert.equal(await tableRows().count(), 50);
  assert.match(await page.locator(".summary-heading").innerText(), /674 matching variants/);
  const summary = page.locator(".summary-panel");
  const beforePageChange = await summary.locator(".chart-count, .domain-bar-value").allTextContents();
  await page.getByRole("button", { name: "Next page", exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector(".pagination")?.textContent.includes("Page 2 of"));
  assert.deepEqual(await summary.locator(".chart-count, .domain-bar-value").allTextContents(), beforePageChange);
  assert.match(await page.locator(".summary-heading").innerText(), /674 matching variants/);
  await query("this-variant-does-not-exist", 0);
  const empty = summary.getByRole("status");
  await empty.waitFor();
  assert.match(await empty.innerText(), /No variants match these filters/);
  const zeroCounts = await summary.locator(".chart-count, .domain-bar-value").allTextContents();
  assert.ok(zeroCounts.length > 0);
  assert.ok(zeroCounts.every(value => Number(value.replaceAll(",", "")) === 0));
  assert.match(await page.locator(".summary-heading").innerText(), /0 matching variants/);
  await resetAll().click();
  await expectCount(source.summary.variants);
  assert.equal(await summary.getByRole("status").count(), 0);
});

test("summary tabs show one chart at a time and preserve cohort filters during keyboard navigation", async () => {
  const clinical = page.getByRole("tab", { name: "Clinical significance", exact: true });
  const domains = page.getByRole("tab", { name: "Domain comparison", exact: true });
  const clinicalPanel = page.getByRole("tabpanel", { name: "Clinical significance", exact: true });
  const domainPanel = page.getByRole("tabpanel", { name: "Domain comparison", exact: true });
  assert.equal(await clinical.getAttribute("aria-selected"), "true");
  assert.equal(await clinicalPanel.isVisible(), true);
  assert.equal(await page.locator("#summary-domain-panel").isVisible(), false);
  await page.getByRole("button", { name: "Filter Pathogenic: 674 variants in current results", exact: true }).click();
  await expectCount(674);
  const cohortURL = page.url();
  await clinical.focus();
  await clinical.press("ArrowRight");
  assert.equal(await domains.evaluate(el => el === document.activeElement), true);
  assert.equal(await domains.getAttribute("aria-selected"), "true");
  assert.equal(await domainPanel.isVisible(), true);
  assert.equal(await page.locator("#summary-clinical-panel").isVisible(), false);
  const nc2 = source.protein.domains.find(d => d.label === "NC2");
  const expected = source.variants.filter(v => v.proteinMapping.domainIds.includes(nc2.id) && v.clinicalSignificance.includes("Pathogenic"));
  assert.equal(await domainPanel.getByRole("button", { name: `Filter NC2 domain: ${expected.length} variants in current results`, exact: true }).isVisible(), true);
  assert.equal(page.url(), cohortURL);
  await domains.press("Home");
  assert.equal(await clinical.evaluate(el => el === document.activeElement), true);
  assert.equal(await clinicalPanel.isVisible(), true);
  assert.equal(await filterControl("Clinical significance").inputValue(), "Pathogenic");
  await clinical.press("End");
  assert.equal(await domains.getAttribute("aria-selected"), "true");
  await domains.press("ArrowRight");
  assert.equal(await clinical.getAttribute("aria-selected"), "true");
  await expectCount(674);
});

test("Not reported is filterable and its missing-classification state survives reload", async () => {
  const notReported = page.getByRole("group", { name: "Variant counts by clinical significance", exact: true })
    .getByRole("button", { name: "Filter Not reported: 38 variants in current results", exact: true });
  await notReported.click();
  await expectCount(38);
  assert.equal(await filterControl("Clinical significance").inputValue(), "__not_classified__");
  assert.ok((await page.locator("tbody .badge").allTextContents()).every(label => label.trim() === "Not classified"));
  await page.waitForFunction(() => new URLSearchParams(location.search).get("significance") === "__not_classified__");
  await page.reload({ waitUntil: "networkidle" });
  await expectCount(38);
  assert.equal(await filterControl("Clinical significance").inputValue(), "__not_classified__");
  assert.equal(await notReported.getAttribute("aria-pressed"), "true");
  await notReported.click();
  await expectCount(source.summary.variants);
  await page.waitForFunction(() => !new URLSearchParams(location.search).has("significance"));
});

test("theme toggle persists across reload without altering filters or the shared URL", async () => {
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  const lightBackground = await page.locator("html").evaluate(el => getComputedStyle(el).backgroundColor);
  await query("id:17423", 1);
  await page.waitForFunction(() => new URLSearchParams(location.search).get("q") === "id:17423");
  const filteredURL = page.url();
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.equal(await page.getByRole("button", { name: "Switch to light mode", exact: true }).getAttribute("aria-description"), "Dark mode is active");
  assert.equal(await page.evaluate(() => localStorage.getItem("col7a1-theme")), "dark");
  assert.equal(await page.locator("html").evaluate(el => getComputedStyle(el).colorScheme), "dark");
  assert.notEqual(await page.locator("html").evaluate(el => getComputedStyle(el).backgroundColor), lightBackground);
  assert.equal(page.url(), filteredURL);
  await expectCount(1);
  await page.reload({ waitUntil: "networkidle" });
  await expectCount(1);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await search().inputValue(), "id:17423");
  assert.equal(page.url(), filteredURL);
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  assert.equal(await page.evaluate(() => localStorage.getItem("col7a1-theme")), "light");
  assert.equal(page.url(), filteredURL);
  assert.equal(await search().inputValue(), "id:17423");
});

test("theme initially follows system preference until the user chooses a mode", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("col7a1-theme")), null);
  await page.reload({ waitUntil: "networkidle" });
  await expectCount(source.summary.variants);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.reload({ waitUntil: "networkidle" });
  await expectCount(source.summary.variants);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
});

test("protein map leads the charts and table, with domain and keyboard range selection", async () => {
  const order = await page.evaluate(() => {
    const map = document.querySelector(".protein-panel"), summary = document.querySelector(".summary-panel"), table = document.querySelector(".table-panel");
    return {
      mapBeforeSummary: !!(map.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING),
      summaryBeforeTable: !!(summary.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  assert.deepEqual(order, { mapBeforeSummary: true, summaryBeforeTable: true });
  const mapBounds = await page.locator(".protein-map").boundingBox();
  assert.ok(mapBounds.height > 120 && mapBounds.height < mapBounds.width * .4, "The full-width residue map keeps its compact proportions");
  assert.equal(await page.getByRole("region", { name: "Collagen VII schematic", exact: true }).isVisible(), true);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const overview = await page.locator(".protein-schematic").boundingBox();
    const residues = await page.locator(".residue-workspace").boundingBox();
    assert.ok(overview.y + overview.height <= residues.y, `The protein overview must sit above the residue map at ${width}px`);
    assert.ok(Math.abs(overview.width - residues.width) <= 2, `Both protein views use the available width at ${width}px`);
    await expectNoPageOverflow();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const nc2 = source.protein.domains.find(d => d.label === "NC2").id;
  const expected = source.variants.filter(v => v.proteinMapping.domainIds.includes(nc2));
  const nc2Region = source.protein.domains.find(d => d.id === nc2);
  const domain = page.getByRole("button", { name: `Filter NC2, amino acids ${nc2Region.start} to ${nc2Region.end}`, exact: true });
  await domain.click();
  await expectCount(expected.length);
  assert.equal(await domain.getAttribute("aria-pressed"), "true");
  assert.equal(await filterControl("Protein domain").inputValue(), nc2);
  await domain.press("Enter");
  await expectCount(source.summary.variants);
  assert.equal(await domain.getAttribute("aria-pressed"), "false");
  const chartStops = page.locator("[data-bin][tabindex='0']");
  assert.equal(await chartStops.count(), 1, "Density bins should occupy one tab stop");
  await chartStops.focus();
  const firstLabel = await page.locator(":focus").getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.locator(":focus").getAttribute("aria-label"), firstLabel);
  const selectedLabel = await page.locator(":focus").getAttribute("aria-label");
  const [, start, end] = selectedLabel.match(/amino acids (\d+) to (\d+)/);
  await page.keyboard.press("Enter");
  await expectCount(source.variants.filter(v => v.proteinMapping.status === "mapped" &&
    v.proteinMapping.start <= Number(end) && v.proteinMapping.end >= Number(start)).length);
  await page.waitForFunction(expected => new URLSearchParams(location.search).get("range") === expected, `${start}-${end}`);
  await page.getByRole("button", { name: "Reset map region", exact: true }).click();
  await expectCount(source.summary.variants);
});

test("a variant marker exposes hover and keyboard evidence and opens the full record", async () => {
  await query("id:17423", 1);
  const marker = page.getByRole("button", { name: /^Open variant 17423:/ });
  assert.equal(await marker.count(), 1);
  await marker.hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /c\.8393T>A/);
  assert.match(await tooltip.innerText(), /p\.Met2798Lys/);
  assert.match(await tooltip.innerText(), /Pathogenic/);
  assert.match(await tooltip.innerText(), /multiple submitters, no conflicts/);
  await search().focus();
  await page.keyboard.press("Escape");
  await tooltip.waitFor({ state: "hidden" });
  await marker.focus();
  assert.equal(await tooltip.isVisible(), true);
  await marker.press("Escape");
  await tooltip.waitFor({ state: "hidden" });
  await marker.press("Tab");
  await marker.focus();
  await tooltip.waitFor();
  await marker.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /CLINVAR VARIATION 17423/);
  assert.match(await dialog.innerText(), /submitter/i);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await marker.evaluate(el => el === document.activeElement), true);
});

test("custom residue ranges validate, filter inclusively and retain unmapped records on demand", async () => {
  await openRangeControls();
  const start = page.getByLabel("Range start (amino acid)", { exact: true });
  const end = page.getByLabel("Range end (amino acid)", { exact: true });
  await start.fill("2800");
  await end.fill("2798");
  await page.getByRole("button", { name: "Apply residue range", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await expectCount(source.summary.variants);
  await start.fill("2798");
  await end.fill("2798");
  await page.getByRole("button", { name: "Apply residue range", exact: true }).click();
  const expected = source.variants.filter(v => v.proteinMapping.status === "mapped" && v.proteinMapping.start <= 2798 && v.proteinMapping.end >= 2798);
  await expectCount(expected.length);
  assert.match(await page.locator(".summary-heading").innerText(), new RegExp(`${expected.length} matching variants`));
  await page.getByRole("button", { name: "Show unmapped variants", exact: true }).click();
  await expectCount(source.summary.unmapped);
  assert.equal(await filterControl("Protein mapping").inputValue(), "unmapped");
  await page.waitForFunction(() => !new URLSearchParams(location.search).has("range") && !new URLSearchParams(location.search).has("domain"));
});

test("domain charts replace stale map ranges and unmapped-only state consistently", async () => {
  const nc2 = source.protein.domains.find(d => d.label === "NC2");
  const nc2Variants = source.variants.filter(v => v.proteinMapping.domainIds.includes(nc2.id));
  assert.equal(nc2Variants.length, 225);
  await openRangeControls();
  await page.getByLabel("Range start (amino acid)", { exact: true }).fill("1");
  await page.getByLabel("Range end (amino acid)", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Apply residue range", exact: true }).click();
  await expectCount(source.variants.filter(v => v.proteinMapping.status === "mapped" && v.proteinMapping.start <= 25 && v.proteinMapping.end >= 1).length);
  await openDomainChart();
  const domain = page.locator(".domain-chart-filter").filter({ hasText: "NC2" });
  await domain.click();
  await expectCount(225);
  assert.equal(await filterControl("Protein domain").inputValue(), nc2.id);
  await page.waitForFunction(() => !new URLSearchParams(location.search).has("range"));
  assert.equal(await page.getByLabel("Range start (amino acid)", { exact: true }).inputValue(), "2785");
  assert.equal(await page.getByLabel("Range end (amino acid)", { exact: true }).inputValue(), "2944");
  await domain.click();
  await expectCount(source.summary.variants);
  await page.getByRole("button", { name: "Show unmapped variants", exact: true }).click();
  await expectCount(source.summary.unmapped);
  await domain.click();
  await expectCount(225);
  assert.equal(await filterControl("Protein mapping").inputValue(), "");
  await page.waitForFunction(() => !new URLSearchParams(location.search).has("mapping"));
  const pair = page.getByRole("button", { name: /^Filter NC2 and Pathogenic:/ });
  await pair.click();
  await expectCount(nc2Variants.filter(v => v.clinicalSignificance.includes("Pathogenic")).length);
  assert.equal(await pair.getAttribute("aria-pressed"), "true");
  await pair.click();
  await expectCount(source.summary.variants);
  assert.equal(await filterControl("Clinical significance").inputValue(), "");
  assert.equal(await filterControl("Protein domain").inputValue(), "");
});

test("protein regions and subdomains expose rich pointer and keyboard tooltips", async () => {
  const subdomain = source.protein.domains.find(d => d.level === "subdomain");
  const control = page.getByRole("button", { name: `Filter ${subdomain.label}, amino acids ${subdomain.start} to ${subdomain.end}`, exact: true });
  await control.hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.waitFor();
  assert.ok((await tooltip.innerText()).includes(subdomain.label));
  const boundary = `aa ${subdomain.start.toLocaleString("en-US")}–${subdomain.end.toLocaleString("en-US")}`;
  assert.ok((await tooltip.innerText()).includes(boundary));
  assert.match(await tooltip.innerText(), /variants/);
  await control.focus();
  assert.equal(await tooltip.isVisible(), true);
  await control.press("Escape");
  await tooltip.waitFor({ state: "hidden" });
  await search().focus();
  await control.focus();
  await tooltip.waitFor();
  await control.press("Enter");
  await expectCount(source.variants.filter(v => v.proteinMapping.domainIds.includes(subdomain.id)).length);
  assert.equal(await filterControl("Protein domain").inputValue(), subdomain.id);
});

test("the quiet density view offers significance colors without changing the cohort", async () => {
  assert.equal(await page.locator(".variant-position-track").count(), 0, "The dense repeated position tracks no longer compete with the map");
  const bins = page.locator("[data-bin]");
  assert.ok(await bins.count() > 0 && await bins.count() <= 60, "The overview uses a bounded number of density bars");
  const colorToggle = page.getByRole("button", { name: "Color by significance", exact: true });
  assert.equal(await colorToggle.getAttribute("aria-pressed"), "false");
  const initialURL = page.url();
  const idsBefore = await ids();
  await colorToggle.click();
  assert.equal(await colorToggle.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await ids(), idsBefore);
  assert.equal(page.url(), initialURL, "A presentation choice must not modify filter state");
  const stop = page.locator("[data-bin][tabindex='0']");
  assert.equal(await stop.count(), 1);
  await stop.focus();
  const label = await stop.getAttribute("aria-label");
  const [, start, end] = label.match(/amino acids (\d+) to (\d+)/);
  await stop.press("Enter");
  const expected = source.variants.filter(v => v.proteinMapping.status === "mapped" && v.proteinMapping.start <= Number(end) && v.proteinMapping.end >= Number(start));
  await expectCount(expected.length);
  await page.waitForFunction(range => new URLSearchParams(location.search).get("range") === range, `${start}-${end}`);
  assert.ok(await page.locator("[data-marker]").count() > 0, "Zoom exposes individual variant markers");
});

test("protein and residue views share hover, keyboard focus and selected-region filters", async () => {
  const schematic = page.getByRole("region", { name: "Collagen VII schematic", exact: true });
  const nc2 = source.protein.domains.find(d => d.label === "NC2");
  const subdomain = source.protein.domains.find(d => d.level === "subdomain");
  const mapSubdomain = page.getByRole("button", { name: `Filter ${subdomain.label}, amino acids ${subdomain.start} to ${subdomain.end}`, exact: true });
  const diagramNC2 = schematic.getByRole("button", { name: "Select NC2 on protein schematic", exact: true });
  const initialURL = page.url();
  await mapSubdomain.hover();
  await page.waitForFunction(range => {
    const schematic = document.querySelector(".protein-schematic");
    return schematic?.dataset.activeStart === String(range[0]) && schematic?.dataset.activeEnd === String(range[1]);
  }, [subdomain.start, subdomain.end]);
  const highlightedPaths = await schematic.locator('[data-schematic-highlight="true"]').evaluateAll(paths => paths.filter(path => Boolean(path.getAttribute("d"))).length);
  assert.ok(highlightedPaths > 0, "Map hover must illuminate a real part of the schematic");
  assert.equal(page.url(), initialURL, "Hover links the views without changing the cohort");
  const nc1 = source.protein.domains.find(d => d.label === "NC1");
  const diagramNC1 = schematic.getByRole("button", { name: "Select NC1 on protein schematic", exact: true });
  await diagramNC1.focus();
  await page.waitForFunction(range => {
    const schematic = document.querySelector(".protein-schematic");
    return schematic?.dataset.activeStart === String(range[0]) && schematic?.dataset.activeEnd === String(range[1]);
  }, [nc1.start, nc1.end]);
  await page.getByRole("button", { name: `Filter NC2, amino acids ${nc2.start} to ${nc2.end}`, exact: true }).hover();
  assert.equal(await diagramNC1.evaluate(el => el === document.activeElement), true,
    "Pointer hover on the map must not require blurring the schematic keyboard target");
  await page.waitForFunction(range => {
    const schematic = document.querySelector(".protein-schematic");
    return schematic?.dataset.activeStart === String(range[0]) && schematic?.dataset.activeEnd === String(range[1]);
  }, [nc2.start, nc2.end]);
  assert.equal(page.url(), initialURL, "The newest linked hover takes precedence without filtering");
  await search().focus();
  await diagramNC2.focus();
  await page.waitForFunction(range => {
    const mark = document.querySelector(".map-linked-highlight");
    return mark?.dataset.start === String(range[0]) && mark?.dataset.end === String(range[1]);
  }, [nc2.start, nc2.end]);
  assert.equal(await schematic.getAttribute("data-rotating"), "false", "Keyboard interaction pauses rotation");
  await diagramNC2.press("Enter");
  const expected = source.variants.filter(v => v.proteinMapping.domainIds.includes(nc2.id));
  await expectCount(expected.length);
  assert.equal(await diagramNC2.getAttribute("aria-pressed"), "true");
  assert.equal(await filterControl("Protein domain").inputValue(), nc2.id);
  const pathogenic = expected.filter(v => v.clinicalSignificance.includes("Pathogenic"));
  assert.equal(await page.getByRole("button", { name: `Filter Pathogenic: ${pathogenic.length} variants in current results`, exact: true }).isVisible(), true);
  await openDomainChart();
  await page.getByRole("button", { name: `Filter NC2 and Pathogenic: ${pathogenic.length} variants in current results`, exact: true }).click();
  await expectCount(pathogenic.length);
  assert.equal(await diagramNC2.getAttribute("aria-pressed"), "true");
  await resetAll().click();
  await expectCount(source.summary.variants);
  const signal = source.protein.domains.find(d => d.label === "Signal peptide");
  await page.getByRole("button", { name: `Filter ${signal.label}, amino acids ${signal.start} to ${signal.end}`, exact: true }).focus();
  await page.waitForFunction(() => document.querySelector(".schematic-context")?.textContent.includes("precursor only; not shown"));
  assert.match(await schematic.innerText(), /not a resolved structure/);
});

test("schematic rotation can be paused and adjusted and respects reduced motion", async () => {
  const schematic = page.getByRole("region", { name: "Collagen VII schematic", exact: true });
  await schematic.scrollIntoViewIfNeeded();
  await search().focus();
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.querySelector(".protein-schematic")?.dataset.rotating === "true");
  await schematic.getByRole("button", { name: "Pause protein rotation", exact: true }).click();
  assert.equal(await schematic.getAttribute("data-rotating"), "false");
  assert.equal(await schematic.getByRole("button", { name: "Start protein rotation", exact: true }).isVisible(), true);
  const angle = schematic.getByRole("slider", { name: "Protein rotation angle", exact: true });
  await angle.focus();
  await angle.press("Home");
  assert.equal(await angle.inputValue(), "0");
  const pathsBefore = await schematic.locator('[data-schematic-highlight="false"]').evaluateAll(paths => paths.map(path => path.getAttribute("d")));
  await angle.press("ArrowRight");
  assert.equal(await angle.inputValue(), "1");
  const pathsAfter = await schematic.locator('[data-schematic-highlight="false"]').evaluateAll(paths => paths.map(path => path.getAttribute("d")));
  assert.notDeepEqual(pathsAfter, pathsBefore, "Manual rotation changes the drawn geometry");
  assert.equal(await schematic.getAttribute("data-rotating"), "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  await expectCount(source.summary.variants);
  await schematic.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  assert.equal(await schematic.getAttribute("data-rotating"), "false");
  assert.equal(await schematic.getByRole("button", { name: "Start protein rotation", exact: true }).isVisible(), true);
  await angle.focus();
  await angle.press("Home");
  await angle.press("ArrowRight");
  assert.equal(await angle.inputValue(), "1", "Manual rotation remains available with reduced motion");
  assert.equal(await schematic.getAttribute("data-rotating"), "false");
});

test("dragging the protein rotates it without filtering and releases safely outside the canvas", async () => {
  const schematic = page.getByRole("region", { name: "Collagen VII schematic", exact: true });
  const canvas = schematic.locator(".schematic-canvas");
  const nc1 = source.protein.domains.find(domain => domain.label === "NC1");
  const region = schematic.getByRole("button", { name: "Select NC1 on protein schematic", exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const target = await region.locator(".schematic-hit-area").boundingBox();
  const bounds = await canvas.boundingBox();
  const startX = target.x + target.width / 2, startY = target.y + target.height / 2;
  await page.mouse.move(startX, startY);
  const initialAngle = Number(await canvas.getAttribute("data-angle"));
  const initialURL = page.url();
  await page.mouse.down();
  await page.mouse.move(startX + 70, startY, { steps: 8 });
  await page.waitForFunction(() => document.querySelector(".protein-schematic")?.dataset.dragging === "true");
  assert.notEqual(Number(await canvas.getAttribute("data-angle")), initialAngle, "Dragging must alter the drawn rotation angle");
  await page.mouse.move(Math.min(1430, bounds.x + bounds.width + 12), startY, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".protein-schematic")?.dataset.dragging === "false");
  assert.equal(await schematic.getAttribute("data-rotating"), "false", "Manual drag leaves automatic rotation paused");
  assert.equal(page.url(), initialURL, "A drag beginning on a region must not also filter it");
  await expectCount(source.summary.variants);
  assert.equal(await filterControl("Protein domain").inputValue(), "");
  await region.click();
  await expectCount(source.variants.filter(variant => variant.proteinMapping.domainIds.includes(nc1.id)).length);
  assert.equal(await filterControl("Protein domain").inputValue(), nc1.id, "The next ordinary click must still select the region");
  await region.press("Enter");
  await expectCount(source.summary.variants);
  const slider = schematic.getByRole("slider", { name: "Protein rotation angle", exact: true });
  await slider.press("Home");
  await slider.press("ArrowRight");
  assert.equal(await slider.inputValue(), "1", "Keyboard rotation remains available after dragging");
});

test("the consensus preset uses exact review status and keeps graphs and evidence in sync", async () => {
  const expected = source.variants.filter(v => v.reviewStatus.includes(multipleSubmittersReview));
  assert.equal(expected.length, 928);
  const preset = page.getByRole("button", { name: "Multiple submitters, no conflicts", exact: true });
  await preset.click();
  await expectCount(expected.length);
  assert.equal(await preset.getAttribute("aria-pressed"), "true");
  assert.equal(await filterControl("Review status").inputValue(), multipleSubmittersReview);
  assert.match(await page.locator(".summary-heading").innerText(), /928 matching variants/);
  assert.deepEqual((await ids()).map(x => Number(x.replace(/\D/g, ""))), expected.slice(0, 50).map(v => v.variationId));
  await page.reload({ waitUntil: "networkidle" });
  await expectCount(928);
  assert.equal(await preset.getAttribute("aria-pressed"), "true");
  await preset.click();
  await expectCount(source.summary.variants);
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

test("every sortable column toggles whole-cohort order and exposes its active direction", async () => {
  const dropdown = page.getByRole("combobox", { name: "Sort variants", exact: true });
  for (const field of TABLE_SORT_FIELDS) {
    // Begin from another column so the first heading click always requests ascending order.
    await dropdown.selectOption(field.key === "id" ? "hgvs" : "id");
    const button = page.locator(`[data-sort-field="${field.key}"]`);
    for (const descending of [false, true]) {
      const sort = `${field.key}${descending ? "-desc" : ""}`;
      const expected = sortVariants(source.variants, sort).slice(0, 50).map(variant => variant.variationId);
      await button.click();
      await page.waitForFunction(({ sort, first }) =>
        document.querySelector('[aria-label="Sort variants"]')?.value === sort &&
        Number(document.querySelector("tbody .clinvar-link")?.textContent.replace(/\D/g, "")) === first,
      { sort, first: expected[0] });
      assert.deepEqual((await ids()).map(value => Number(value.replace(/\D/g, ""))), expected, sort);
      assert.equal(await page.locator(`th:has([data-sort-field="${field.key}"])`).getAttribute("aria-sort"), descending ? "descending" : "ascending");
      assert.equal(await page.locator('th[aria-sort="ascending"], th[aria-sort="descending"]').count(), 1);
      assert.equal(await dropdown.inputValue(), sort);
      assert.equal(new URL(page.url()).searchParams.get("sort") || "id", sort);
      await expectCount(source.summary.variants);
    }
  }
});

test("header sorting preserves filters, resets the scrolled page and survives shared URL reload and CSV export", async () => {
  await selectFilter("Clinical significance", "Pathogenic");
  await page.getByRole("button", { name: "Multiple submitters, no conflicts", exact: true }).click();
  const cohort = source.variants.filter(variant => variant.clinicalSignificance.includes("Pathogenic") && variant.reviewStatus.includes(multipleSubmittersReview));
  await expectCount(cohort.length);
  assert.ok(cohort.length > 50);
  const submitters = page.locator('[data-sort-field="submitters"]');
  await submitters.click();
  await submitters.click();
  const descending = sortVariants(cohort, "submitters-desc");
  await page.waitForFunction(first => Number(document.querySelector("tbody .clinvar-link")?.textContent.replace(/\D/g, "")) === first, descending[0].variationId);
  assert.deepEqual((await ids()).map(value => Number(value.replace(/\D/g, ""))), descending.slice(0, 50).map(variant => variant.variationId));
  const displayedCounts = descending.slice(0, 50).map(variant => Math.max(...variant.numberSubmitters));
  assert.ok(displayedCounts.every((count, index) => !index || displayedCounts[index - 1] >= count), "Submitter descending order is numeric across the cohort");
  await page.getByRole("button", { name: "Next page", exact: true }).last().click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get("page") === "2");
  assert.deepEqual((await ids()).map(value => Number(value.replace(/\D/g, ""))), descending.slice(50, 100).map(variant => variant.variationId));
  const viewport = page.locator(".table-scroll");
  await viewport.focus();
  await viewport.press("PageDown");
  await page.waitForFunction(() => document.querySelector(".table-scroll").scrollTop > 0);
  await page.locator('[data-sort-field="position"]').click();
  const expected = sortVariants(cohort, "position");
  await page.waitForFunction(first => Number(document.querySelector("tbody .clinvar-link")?.textContent.replace(/\D/g, "")) === first, expected[0].variationId);
  assert.deepEqual((await ids()).map(value => Number(value.replace(/\D/g, ""))), expected.slice(0, 50).map(variant => variant.variationId));
  assert.equal(await viewport.evaluate(element => element.scrollTop), 0);
  assert.equal(new URL(page.url()).searchParams.has("page"), false);
  assert.equal(await filterControl("Clinical significance").inputValue(), "Pathogenic");
  assert.equal(await filterControl("Review status").inputValue(), multipleSubmittersReview);
  const sortedURL = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await expectCount(cohort.length);
  assert.equal(page.url(), sortedURL);
  assert.equal(await page.getByRole("combobox", { name: "Sort variants", exact: true }).inputValue(), "position");
  assert.equal(await page.locator('th:has([data-sort-field="position"])').getAttribute("aria-sort"), "ascending");
  assert.deepEqual((await ids()).map(value => Number(value.replace(/\D/g, ""))), expected.slice(0, 50).map(variant => variant.variationId));
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export CSV/ }).click();
  const download = await pending;
  const exported = csvRows(await readFile(await download.path(), "utf8"));
  assert.deepEqual(exported.slice(1).map(row => Number(row[0])), expected.map(variant => variant.variationId), "CSV keeps the complete sorted cohort, not only the visible page");
});

test("research controls stay visible, reset every filter and copy a restorable view URL", async () => {
  const toolbar = page.getByRole("region", { name: "Research controls", exact: true });
  assert.equal(await resetAll().count(), 1);
  assert.equal(await resetAll().isEnabled(), true);
  assert.equal(await toolbar.locator(".research-legend").isVisible(), true);
  assert.match(await toolbar.locator(".research-legend").innerText(), /Pathogenic/);
  assert.match(await toolbar.locator(".research-legend").innerText(), /VUS|Uncertain/);
  assert.match(await toolbar.locator(".research-legend").innerText(), /Benign/);
  await page.getByRole("heading", { name: /Explore the variants/ }).scrollIntoViewIfNeeded();
  const bounds = await toolbar.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1000, "Research controls remain visible above the scrolled results");
  await query("id:17423", 1);
  const nc2 = source.protein.domains.find(d => d.label === "NC2");
  await selectFilter("Protein domain", nc2.id);
  await page.getByRole("combobox", { name: "Sort variants", exact: true }).selectOption("id-desc");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL).origin });
  await toolbar.getByRole("button", { name: "Copy view link", exact: true }).click();
  await toolbar.getByRole("status").filter({ hasText: "View link copied" }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const copiedURL = new URL(copied);
  assert.equal(copiedURL.searchParams.get("q"), "id:17423");
  assert.equal(copiedURL.searchParams.get("domain"), nc2.id);
  assert.equal(copiedURL.searchParams.get("sort"), "id-desc");
  assert.equal(copiedURL.searchParams.has("theme"), false);
  assert.equal(copiedURL.hash, "");
  await resetAll().click();
  await expectCount(source.summary.variants);
  assert.equal(await search().inputValue(), "");
  for (const label of ["Clinical significance", "Protein domain", "Review status", "Protein mapping", "Variant type"])
    assert.equal(await filterControl(label).inputValue(), "", label);
  await page.goto(copied, { waitUntil: "networkidle" });
  await expectCount(1);
  assert.equal(await search().inputValue(), "id:17423");
  assert.equal(await filterControl("Protein domain").inputValue(), nc2.id);
  await page.getByRole("button", { name: "View evidence", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Copy view link", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "View link copied" }).waitFor();
  const variantURL = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(variantURL.searchParams.get("variant"), "17423");
  assert.equal(variantURL.searchParams.get("q"), "id:17423");
  assert.equal(variantURL.searchParams.get("domain"), nc2.id);
});

test("clickable variant rows support keyboard selection without hijacking ClinVar links", async () => {
  await query("id:17423", 1);
  const row = page.locator('.variant-row[data-variant-id="17423"]');
  const dialog = page.getByRole("dialog");
  await row.locator(".domain-text").click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /CLINVAR VARIATION 17423/);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await row.evaluate(el => el === document.activeElement), true);
  for (const key of ["Enter", "Space"]) {
    await row.focus();
    await row.press(key);
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  const popupPromise = context.waitForEvent("page");
  await row.locator(".clinvar-link").click();
  const popup = await popupPromise;
  await popup.close();
  assert.equal(await dialog.count(), 0, "Following the nested ClinVar link must not also open the row dialog");
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
  assert.equal(await dialog.getByRole("heading", { name: "Review & submitters", exact: true }).isVisible(), true);
  assert.match(await dialog.locator(".review-source-label").innerText(), /criteria provided, multiple submitters, no conflicts/);
  const selected = source.variants.find(v => v.variationId === 17423);
  assert.match(await dialog.locator(".submitter-count").innerText(), new RegExp(String(selected.numberSubmitters[0])));
  assert.equal(await dialog.getByRole("heading", { name: "Full HGVS & source names", exact: true }).isVisible(), true);
  assert.deepEqual(await dialog.locator(".source-hgvs-list code").allTextContents(), selected.names);
  const domain = source.protein.domains.find(d => d.label === "NC2");
  assert.match(await dialog.locator(".detail-domain-list").innerText(), /NC2[\s\S]*aa 2,785–2,944/);
  assert.equal(await dialog.getByRole("link", { name: /UniProt Q02388/ }).getAttribute("href"), source.protein.url);
  assert.ok(selected.proteinMapping.domainIds.includes(domain.id));
  const provenance = dialog.locator("details").filter({ has: page.locator("summary", { hasText: "Source evidence & mapping" }) });
  assert.equal(await provenance.getAttribute("open"), null, "Technical evidence starts collapsed");
  await provenance.locator("summary").click();
  assert.deepEqual(await provenance.locator(".source-lines code").allTextContents(), selected.sourceRecords.map(row => row.sha256));
  assert.match(await provenance.innerText(), /2026-10-27/);
  assert.match(await provenance.innerText(), /Unknown in supplied source/);
  await provenance.locator("summary").click();
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

test("CSV exports all combined-filter results with evidence, positions and snapshot context", async () => {
  const expected = source.variants.filter(v => v.clinicalSignificance.includes("Pathogenic") && v.reviewStatus.includes(multipleSubmittersReview));
  assert.ok(expected.length > 50);
  await selectFilter("Clinical significance", "Pathogenic");
  await page.getByRole("button", { name: "Multiple submitters, no conflicts", exact: true }).click();
  await expectCount(expected.length);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export CSV/ }).click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.csv$/);
  const rows = csvRows(await readFile(await download.path(), "utf8"));
  assert.equal(rows.length, expected.length + 1);
  const column = name => {
    const index = rows[0].indexOf(name);
    assert.ok(index >= 0, `CSV must include ${name}`);
    return index;
  };
  for (const name of ["Coding HGVS", "Protein HGVS", "Clinical significance", "Review status", "Domains", "Protein start (1-based)", "Protein end (inclusive)", "Variation ID", "Conditions (as reported)", "ClinVar URL", "Source row SHA256"])
    column(name);
  const submitters = column("Number of submitters (source counts)");
  const prepared = column("Snapshot prepared date");
  const release = column("ClinVar release date");
  const method = column("Protein mapping method");
  const byId = new Map(expected.map(v => [v.variationId, v]));
  assert.deepEqual(rows.slice(1).map(row => Number(row[0])).sort((a, b) => a - b), expected.map(v => v.variationId).sort((a, b) => a - b));
  assert.ok(rows.every(row => row.length === rows[0].length));
  for (const row of rows.slice(1)) {
    const variant = byId.get(Number(row[0]));
    assert.equal(row[submitters], variant.numberSubmitters.join("; "));
    assert.equal(row[prepared], source.snapshot.preparedDate);
    assert.equal(row[release], "Unknown");
    assert.equal(row[column("Clinical significance")], variant.clinicalSignificance.join("; "));
    assert.equal(row[column("Review status")], variant.reviewStatus.join("; "));
    if (variant.proteinMapping.status === "mapped") assert.equal(row[method], "explicit_protein_hgvs");
  }
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
    await query("", source.summary.variants);
    await expectNoPageOverflow();
    const themeToggle = page.getByRole("button", { name: width < 768 ? "Switch to dark mode" : "Switch to light mode", exact: true });
    if (await themeToggle.isVisible()) await themeToggle.click();
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
