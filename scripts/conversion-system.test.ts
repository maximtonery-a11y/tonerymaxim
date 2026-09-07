import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function extractFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Chýba ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Neuzavretá funkcia ${signature}`);
}

test("nové vstupné stránky sú indexovateľné a majú kanonické URL", async () => {
  const sitemap = await read("src/lib/sitemaps.ts");
  assert.match(sitemap, /"\/firemna-tlac"/);
  assert.match(sitemap, /"\/kalkulacka-ceny-tlace"/);
  const firm = await read("src/pages/firemna-tlac.astro");
  const calculator = await read("src/pages/kalkulacka-ceny-tlace.astro");
  assert.match(firm, /canonical=\{canonical\}/);
  assert.match(calculator, /canonical=\{canonical\}/);
  assert.match(firm, /bez povinnosti objednať/i);
  assert.match(calculator, /cena kazety ÷ deklarovaná výťažnosť/i);
});

test("firemný formulár používa existujúci bezpečný kontaktný endpoint", async () => {
  const firm = await read("src/pages/firemna-tlac.astro");
  assert.match(firm, /action="\/api\/contact"/);
  assert.match(firm, /name="privacy"/);
  assert.match(firm, /Bezplatná kontrola firemnej tlače/);
});

test("cena za stranu sa zobrazí len pri kladnej cene a výťažnosti", async () => {
  const detail = await read("src/scripts/product-detail.js");
  assert.match(detail, /if \(!pages \|\| !Number\.isFinite\(price\) \|\| price <= 0\) return ""/);
  assert.match(detail, /ml\|cl\|dl/);
  assert.match(detail, /count \* perItem/);
  assert.match(detail, /€ \/ strana/);
  assert.match(detail, /cena s DPH ÷ deklarovaná výťažnosť/i);
  assert.match(detail, /Skutočná spotreba závisí od pokrytia tlače/);
  assert.match(detail, /minimumFractionDigits: 3, maximumFractionDigits: 3/);
});

test("alternatívy vyžadujú rovnaký druh, farbu a spoločný model tlačiarne", async () => {
  const detail = await read("src/scripts/product-detail.js");
  assert.match(detail, /currentKind !== comparableKind\(candidate\)/);
  assert.match(detail, /currentColor !== candidateColor/);
  assert.match(detail, /if \(!overlap\) return -1/);
  assert.match(detail, /picked\.length === 3 \? picked : \[\]/);
  assert.match(detail, /alternatives\.length === 3/);
  assert.match(detail, /data-alternatives-section hidden/);
  assert.match(detail, /verifiedCandidates\(\)\.length < 3/);

  const source = extractFunction(detail, "function comparableKind(product)");
  const comparableKind = new Function(`${source}; return comparableKind;`)() as (product: Record<string, unknown>) => string;
  assert.equal(comparableKind({ name: "Brother TN-241BK toner" }), "toner");
  assert.equal(comparableKind({ name: "Brother WT-220CL originálna nádobka na odpadový toner" }), "waste-toner");
  assert.equal(comparableKind({ name: "Brother DR-241BK optický valec" }), "drum");

  const colorSource = extractFunction(detail, "function comparableColor(product)");
  const comparableColor = new Function(`${colorSource}; return comparableColor;`)() as (product: Record<string, unknown>) => string;
  const printerSource = extractFunction(detail, "function printerModelKeys(product)");
  const printerModelKeys = new Function("getPrinters", `${printerSource}; return printerModelKeys;`)((product: Record<string, unknown>) => product.compatible_printers || []);
  const scoreSource = extractFunction(detail, "function alternativeScore(current, candidate)");
  const alternativeScore = new Function("comparableKind", "comparableColor", "printerModelKeys", "seriesSearchKey", `${scoreSource}; return alternativeScore;`)(
    comparableKind,
    comparableColor,
    printerModelKeys,
    (product: Record<string, unknown>) => product.family || "",
  );
  const current = { name: "Brother TN-241BK toner", color: "Čierna", family: "TN241", compatible_printers: ["Brother DCP-9020CDW"] };
  assert.ok(alternativeScore(current, { name: "Brother TN-291K renovovaný toner", color: "Čierna", family: "TN291", compatible_printers: ["Brother DCP-9020CDW"] }) >= 0);
  assert.equal(alternativeScore(current, { name: "Brother WT-220CL nádobka na odpadový toner", color: "", compatible_printers: ["Brother DCP-9020CDW"] }), -1);
  assert.equal(alternativeScore(current, { name: "Brother DR-241BK optický valec", color: "Čierna", compatible_printers: ["Brother DCP-9020CDW"] }), -1);
  assert.equal(alternativeScore(current, { name: "Brother TN-241C toner", color: "Azúrová", compatible_printers: ["Brother DCP-9020CDW"] }), -1);
  assert.equal(alternativeScore(current, { name: "Brother TN-241BK toner", color: "", compatible_printers: ["Brother DCP-9020CDW"] }), -1);
  assert.equal(alternativeScore(current, { name: "Brother TN-241BK toner", color: "Čierna", compatible_printers: ["Brother HL-9999"] }), -1);
});

test("výťažnosť správne počíta rovnakofarebný dualpack a odmieta ml aj CMYK súčet", async () => {
  const detail = await read("src/scripts/product-detail.js");
  const source = extractFunction(detail, "function numericPageYield(product)");
  const numericPageYield = new Function(`${source}; return numericPageYield;`)() as (product: Record<string, unknown>) => number;
  assert.equal(numericPageYield({ name: "HP CF283XD Dualpack Bk", color: "Čierna", page_yield: "2 x 2200 strán" }), 4400);
  assert.equal(numericPageYield({ name: "HP W1103AD originálne tonery", color: "Čierna", page_yield: "2 x 2500 strán" }), 5000);
  assert.equal(numericPageYield({ name: "Canon PG-540", color: "Čierna", page_yield: "7 ml" }), 0);
  assert.equal(numericPageYield({ name: "HP Troj-Pack CMY", color: "CMY", page_yield: "3 x 2300 strán" }), 0);
  assert.equal(numericPageYield({ name: "Brother Multipack", color: "CMYK", page_yield: "600 strán (BK) + 3 x 600 strán (CMY)" }), 0);
  assert.equal(numericPageYield({ name: "Neoverené balenie", color: "Čierna", page_yield: "3 x 750 strán" }), 0);
});

test("mapovanie katalógu používa CIQ výťažnosť bez zásahu do ceny a URL", async () => {
  const cache = await read("src/lib/tm-products-cache.ts");
  assert.match(cache, /_ciq_yield_pages/);
  assert.match(cache, /normalizeWooPageYield/);
  assert.match(cache, /Objem atramentu ani hmotnosť prášku nie sú počet vytlačených strán/);
  assert.match(cache, /detail_url: `\/produkt\/\$\{product\.slug \|\| product\.id\}`/);
  assert.match(cache, /price: cleanPrice\(product\.price\)/);
});
