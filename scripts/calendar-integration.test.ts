import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calendarDiscountRate, calendarDiscountedUnitPrice } from "../src/lib/calendar-pricing.ts";
import { calendarWooLineReference } from "../src/lib/calendar-woo-line.ts";

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

test("všetkých 62 kalendárov používa rovnakú zaokrúhlenú jednotkovú cenu v katalógu aj pokladni", async () => {
  const rows = JSON.parse(await readFile(new URL("../src/data/calendar-products.json", import.meta.url), "utf8"));
  assert.equal(rows.length, 62);

  for (const row of rows) {
    for (const [qty, tierIndex] of [[1, 0], [3, 1], [21, 2]] as const) {
      const expectedUnitPrice = Number(row.price_tiers[tierIndex].unit_price);
      assert.equal(
        calendarDiscountedUnitPrice(row.price, qty),
        expectedUnitPrice,
        `${row.sku}, qty ${qty}`,
      );
    }
  }

  const polonovnik = rows.find((row: any) => row.sku === "NK-03-27");
  assert.equal(Math.round(calendarDiscountedUnitPrice(polonovnik.price, 3) * 3 * 100) / 100, 14.58);
});

test("server, košík aj pokladňa používajú rovnaký výpočet kalendárovej ceny", async () => {
  for (const file of [
    "../src/lib/secure-checkout-cart.ts",
    "../src/lib/checkout-order.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /calendarDiscountedUnitPrice\(item\.price, item\.qty\)/, file);
  }

  for (const file of ["../src/scripts/cart.js", "../src/scripts/checkout.js"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /function quantityLineDiscount\(item\)/, file);
    assert.match(source, /const discountedUnit = Math\.round\(Number\(item\.price \|\| 0\) \* \(1 - rate\) \* 100\) \/ 100/, file);
  }
});

test("server rozpozná kalendár aj keď staršia položka stratila source", async () => {
  const source = await readFile(new URL("../src/lib/secure-checkout-cart.ts", import.meta.url), "utf8");
  const rows = JSON.parse(await readFile(new URL("../src/data/calendar-products.json", import.meta.url), "utf8"));
  assert.match(source, /id\.startsWith\("calendar:"\)/);
  assert.match(source, /isBundledCalendarSku\(skuFromItem\(item\)\)/);
  assert.equal(rows.some((row: any) => row?.sku === "NK-03-27"), true);
});

test("kalendár bez Woo produktu zostáva oddeleným manuálnym objednávkovým riadkom", async () => {
  const source = await readFile(new URL("../src/lib/checkout-order.ts", import.meta.url), "utf8");
  assert.match(source, /String\(item\.source \|\| ""\) === CALENDAR_SOURCE\s*\? 0/);
  assert.match(source, /calendarWooLineReference\(item, CALENDAR_SOURCE\)/);
  assert.match(source, /tm_catalog_source/);
});

test("kalendárový Woo riadok má povinné SKU a tonerový riadok zostáva nezmenený", () => {
  assert.deepEqual(
    calendarWooLineReference(
      { source: "kalendare-2027", sku: " NK-03-27 ", name: "Nástenný kalendár Poľovník 2027" },
      "kalendare-2027",
    ),
    { sku: "NK-03-27" },
  );
  assert.equal(
    calendarWooLineReference({ source: "tonerymaxim", sku: "15048", name: "Brother TN-2421" }, "kalendare-2027"),
    null,
  );
  assert.throws(
    () => calendarWooLineReference({ source: "kalendare-2027", sku: "", name: "Kalendár" }, "kalendare-2027"),
    /SKU kalendára je povinné/,
  );
});

test("tonerová zľava zostáva v pôvodných hraniciach 2 ks a 4 ks", async () => {
  const source = await readFile(new URL("../src/lib/secure-checkout-cart.ts", import.meta.url), "utf8");
  assert.match(source, /item\.qty >= 4\) return 0\.25/);
  assert.match(source, /item\.qty >= 2\) return 0\.10/);
});

test("pokladňa zachová zdroj kalendára až po odoslanie objednávky", async () => {
  const source = await readFile(new URL("../src/scripts/checkout.js", import.meta.url), "utf8");
  assert.match(source, /const source\s*=\s*String\(item\.source \|\| ""\)/);
  assert.match(source, /source:\s*isCalendarItem\s*\?\s*"kalendare-2027"\s*:\s*source/);
  assert.match(source, /body:\s*JSON\.stringify\(orderPreview\)/);
});

test("košík nikdy nedohľadáva kalendár medzi tonermi", async () => {
  const source = await readFile(new URL("../src/scripts/cart.js", import.meta.url), "utf8");
  assert.match(source, /function isCalendarCartItem\(item\)/);
  assert.match(source, /source:\s*"kalendare-2027"/);
  assert.doesNotMatch(source, /data\.products\[0\]\s*\|\|\s*null/);
  assert.match(source, /stock_quantity:\s*null/);
  assert.match(source, /color:\s*""/);
});

test("stará položka kalendára sa v pokladni očistí od tonerových atribútov", async () => {
  const source = await readFile(new URL("../src/scripts/checkout.js", import.meta.url), "utf8");
  assert.match(source, /isCalendarItem\s*=\s*isCalendarCartItem\(item\)/);
  assert.match(source, /source:\s*isCalendarItem\s*\?\s*"kalendare-2027"/);
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

test("pôvodný e-shop je obnovený iba ako oddelený panel a mobilný odkaz", async () => {
  const footer = await readFile(new URL("../src/components/Footer.astro", import.meta.url), "utf8");
  const header = await readFile(new URL("../src/components/Header.astro", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/components/LegacyShopPanel.astro", import.meta.url), "utf8");
  assert.match(footer, /import LegacyShopPanel/);
  assert.match(footer, /<LegacyShopPanel\s*\/>/);
  assert.match(header, /tm-global-mobile-legacy-link/);
  assert.match(panel, /const legacyShopUrl = "https:\/\/www\.tonerymaxim\.info"/);
  assert.match(panel, /data-legacy-shop-toggle/);
  assert.match(panel, /@media \(max-width: 760px\)/);
});
