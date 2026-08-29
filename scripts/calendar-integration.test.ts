import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calendarDiscountRate } from "../src/lib/calendar-pricing.ts";

test("množstevná zľava kalendára má presné hranice 1–2, 3–20 a 21+", () => {
  for (const [qty, expected] of [[1, 0], [2, 0], [3, 0.05], [20, 0.05], [21, 0.15], [99, 0.15]] as const) {
    assert.equal(calendarDiscountRate(qty), expected, `qty ${qty}`);
  }
});

test("serverová normalizácia kalendára nepoužíva klientsku cenu ani názov", async () => {
  const source = await readFile(new URL("../src/lib/secure-checkout-cart.ts", import.meta.url), "utf8");
  assert.match(source, /getCalendarProducts\(\)/);
  assert.match(source, /price:\s*product\.price/);
  assert.match(source, /name:\s*product\.name/);
  assert.match(source, /source:\s*CALENDAR_SOURCE/);
  assert.doesNotMatch(source, /price:\s*money\(item\.price\)/);
  assert.match(source, /product\.availability\.inStock/);
});

test("kalendár bez Woo produktu zostáva oddeleným manuálnym objednávkovým riadkom", async () => {
  const source = await readFile(new URL("../src/lib/checkout-order.ts", import.meta.url), "utf8");
  assert.match(source, /String\(item\.source \|\| ""\) === CALENDAR_SOURCE\s*\? 0/);
  assert.match(source, /tm_catalog_source/);
});

test("tonerová zľava zostáva v pôvodných hraniciach 2 ks a 4 ks", async () => {
  const source = await readFile(new URL("../src/lib/secure-checkout-cart.ts", import.meta.url), "utf8");
  assert.match(source, /item\.qty >= 4\) return 0\.25/);
  assert.match(source, /item\.qty >= 2\) return 0\.10/);
});

test("pokladňa zachová zdroj kalendára až po odoslanie objednávky", async () => {
  const source = await readFile(new URL("../src/scripts/checkout.js", import.meta.url), "utf8");
  assert.match(source, /const source\s*=\s*String\(item\.source \|\| ""\)/);
  assert.match(source, /\r?\n\s+source,\r?\n/);
  assert.match(source, /body:\s*JSON\.stringify\(orderPreview\)/);
});

test("košík nikdy nedohľadáva kalendár medzi tonermi", async () => {
  const source = await readFile(new URL("../src/scripts/cart.js", import.meta.url), "utf8");
  assert.match(source, /item\?\.source \|\| ""\) === "kalendare-2027"/);
  assert.doesNotMatch(source, /data\.products\[0\]\s*\|\|\s*null/);
  assert.match(source, /stock_quantity:\s*null/);
  assert.match(source, /color:\s*""/);
});

test("stará položka kalendára sa v pokladni očistí od tonerových atribútov", async () => {
  const source = await readFile(new URL("../src/scripts/checkout.js", import.meta.url), "utf8");
  assert.match(source, /isCalendarItem\s*=\s*source\s*===\s*"kalendare-2027"/);
  assert.match(source, /color:\s*isCalendarItem\s*\?\s*""/);
  assert.match(source, /stock_quantity:\s*isCalendarItem\s*\?\s*null/);
});

test("záložný katalóg má overený stav skladu pre každý produkt", async () => {
  const rows = JSON.parse(await readFile(new URL("../src/data/calendar-products.json", import.meta.url), "utf8"));
  assert.equal(rows.length, 62);
  assert.equal(rows.filter((row: any) => row?.availability?.checkedAt).length, rows.length);
  assert.equal(new Set(rows.map((row: any) => String(row.sku))).size, rows.length);
});

test("načítanie katalógu zdieľa jednu rozpracovanú požiadavku", async () => {
  const source = await readFile(new URL("../src/lib/calendar-catalog.ts", import.meta.url), "utf8");
  assert.match(source, /let refreshPromise:/);
  assert.match(source, /if \(!refreshPromise\)/);
  assert.match(source, /return refreshPromise/);
});
