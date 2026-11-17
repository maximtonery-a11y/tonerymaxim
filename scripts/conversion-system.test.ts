import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { selectProductAlternatives, savingsAgainstOriginal } from "../src/lib/product-alternatives.ts";
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

const current = { id: 1, sku: "C1", slug: "brother-tn-2421", name: "Brother TN-2421 čierny kompatibilný toner",
  product_type_key: "compatible", color: "Čierna", price: 13.05, page_yield: "3 000 strán",
  compatible_printers: ["Brother DCP-L2512D", "Brother HL-L2352DW"] };
const original = { ...current, id: 2, sku: "O2", name: "Brother TN2421 čierny originálny toner", product_type_key: "original", price: 104.66 };
const renovated = { ...current, id: 3, sku: "R3", name: "Brother TN 2421 čierny renovovaný toner", product_type_key: "renovated", price: 41.27 };
const smaller = { ...original, id: 4, sku: "O4", name: "Brother TN-2411 čierny originálny toner", page_yield: "1 200 strán", price: 58.71 };

test("zobrazí nula až tri jedinečné alternatívy a zachová rozličné vyhotovenia", () => {
  for (const rows of [[], [original], [original, renovated], [original, renovated, smaller]]) {
    const found = selectProductAlternatives(current, [current, ...rows, ...rows]).alternatives;
    assert.equal(found.length, rows.length);
    assert.deepEqual(new Set(found.map(a => a.variant.product.id)), new Set(rows.map(p => p.id)));
  }
  assert.equal(selectProductAlternatives(current, [smaller, renovated, original, { ...original, id: 6 }]).alternatives.length, 3);
  const [small] = selectProductAlternatives(current, [smaller]).alternatives;
  assert.equal(small.difference, -1800);
  assert.equal(small.comparable, false);
  const [some] = selectProductAlternatives(current, [{ ...original, compatible_printers: ["Brother HL-L2352DW"] }]).alternatives;
  assert.equal(some.partial, true);
});

test("rovnaká tlačiareň nestačí pri inom druhu, odtieni, OEM, sade alebo značke", () => {
  for (const fields of [
    { name: "Brother WT-220CL nádobka na odpadový toner" }, { name: "Brother DR-241 optický valec" },
    { name: "Canon TN-2421 čierny toner" }, { name: "Brother TN-291K čierny toner" }, { color: "Azúrová" }, { color: "" },
    { name: "Brother TN-2421 čierny toner (2 ks)" }, { name: "Brother TN-2421 čierny toner Dualpack" },
    { compatible_printers: ["Brother HL-9999"] }, { compatible_printers: [] }, { price: 0 }, { price: Infinity },
    { sku: "" }, { product_type_key: "compatible", name: "Brother TN-2421 čierny toner bez čipu" },
  ]) assert.equal(selectProductAlternatives(current, [{ ...original, ...fields }]).alternatives.length, 0, JSON.stringify(fields));
  const ink = { ...current, name: "Canon CLI-8C azúrová atramentová náplň", color: "Azúrová", compatible_printers: ["Canon PIXMA Pro9000"] };
  assert.equal(selectProductAlternatives(ink, [{ ...ink, id: 2, name: "Canon CLI-8PC foto azúrová atramentová náplň" }]).alternatives.length, 0);
  assert.equal(selectProductAlternatives({ ...ink, color: "Čierna", name: "Canon PGI-580PGBK atrament" },
    [{ ...ink, id: 2, color: "Čierna", name: "Canon CLI-581BK atrament" }]).alternatives.length, 0);
});

test("úspora používa aktuálnu cenu rovnocenného originálu", () => {
  assert.equal(savingsAgainstOriginal(current, original), 91.61);
  assert.equal(savingsAgainstOriginal(renovated, original), 63.39);
  for (const item of [smaller, renovated, { ...original, page_yield: "" }, { ...original, color: "Azúrová" },
    { ...original, name: "Brother TN2421 Multipack" }, { ...original, price: 12.99 }, { ...original, price: Infinity }]) {
    assert.equal(savingsAgainstOriginal(current, item), 0);
  }
  const ml = { ...current, name: "Canon PGI-580PGBK čierna atramentová náplň", page_yield: "", capacity: "11,2 ml" };
  const mlOriginal = { ...ml, id: 2, product_type_key: "original", price: 20.05 };
  assert.equal(selectProductAlternatives(ml, [mlOriginal]).alternatives[0].variant.pages, null);
  assert.equal(savingsAgainstOriginal(ml, mlOriginal), 7);
  assert.equal(savingsAgainstOriginal(ml, { ...mlOriginal, capacity: "25 ml" }), 0);
  assert.equal(savingsAgainstOriginal({ ...current, name: current.name + " (2 ks)" }, { ...original, name: original.name + " (2 ks)" }), 0);
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
