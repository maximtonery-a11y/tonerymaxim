import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCatalogQuery,
  findExactPrinterModelMatches,
  findExactProductIdentityMatches,
  printerReferenceMatches,
} from "../src/lib/catalog-query.ts";
import { filterProducts, mapProduct } from "../src/lib/tm-products-cache.ts";
import { validateGroundedOpenAiResult } from "../src/lib/openai-sales-assistant.ts";

const products = [
  {
    id: 1,
    name: "HP F6V24AE (no. 652) Black originálna atramentová náplň",
    sku: "F6V24AE",
    slug: "hp-f6v24ae-no-652-originalna-atramentova-napln",
    product_type_key: "original",
    stock_status: "instock",
    categories: [{ name: "HP", slug: "hp" }],
    compatible_printers: ["HP DeskJet Ink Advantage 1115"],
  },
  {
    id: 2,
    name: "HP F6V25AE (no. 652XL) renovovaná atramentová náplň",
    sku: "F6V25AE",
    slug: "hp-f6v25ae-no-652xl-renovovana-atramentova-napln",
    product_type_key: "renovated",
    stock_status: "instock",
    categories: [{ name: "HP", slug: "hp" }],
    compatible_printers: ["HP DeskJet Ink Advantage 1115"],
  },
  {
    id: 3,
    name: "Epson T11C kompatibilná atramentová náplň",
    sku: "T11C",
    slug: "epson-t11c-kompatibilna-atramentova-napln",
    product_type_key: "compatible",
    stock_status: "instock",
    categories: [{ name: "Epson", slug: "epson" }],
    compatible_printers: ["HP DeskJet 6520"],
  },
  {
    id: 4,
    name: "HP CF320A renovovaný toner",
    sku: "CF320A",
    slug: "hp-cf320a-renovovany-toner",
    product_type_key: "renovated",
    stock_status: "instock",
    categories: [{ name: "HP", slug: "hp" }],
    compatible_printers: ["HP Color LaserJet Enterprise M652"],
  },
  {
    id: 5,
    name: "HP CZ109AE (no. 655) originálna atramentová náplň",
    sku: "CZ109AE",
    slug: "hp-cz109ae-no-655-originalna-atramentova-napln",
    product_type_key: "original",
    stock_status: "instock",
    categories: [{ name: "HP", slug: "hp" }],
  },
  {
    id: 6,
    name: "HP CZ101AE (no. 650 XL) renovovaná atramentová náplň",
    sku: "CZ101AE",
    slug: "hp-cz101ae-no-650-xl-renovovana-atramentova-napln",
    product_type_key: "renovated",
    stock_status: "instock",
    categories: [{ name: "HP", slug: "hp" }],
  },
  {
    id: 7,
    name: "HP 3YM61AE (no. 305) Black originálna atramentová náplň",
    sku: "3YM61AE",
    slug: "hp-3ym61ae-no-305-black-originalna-atramentova-napln",
    product_type_key: "original",
    stock_status: "instock",
    categories: [{ name: "Originálne HP atramentové náplne", slug: "originalne-hp-atramentove-naplne" }],
    search_text: "hp 3ym61ae no 305 black originalna atramentova napln",
  },
  {
    id: 8,
    name: "HP 3YM62AE (no. 305XL) Black originálna atramentová náplň",
    sku: "3YM62AE",
    slug: "hp-3ym62ae-no-305xl-black-originalna-atramentova-napln",
    product_type_key: "original",
    stock_status: "instock",
    categories: [{ name: "Originálne HP atramentové náplne", slug: "originalne-hp-atramentove-naplne" }],
    search_text: "hp 3ym62ae no 305xl black originalna atramentova napln",
  },
  {
    id: 9,
    name: "Renovovaný toner HATONA pre HP CE411A 305A Cyan",
    sku: "HAT-305A-C",
    slug: "renovovany-toner-hatona-pre-hp-ce411a-305a-cyan",
    product_type_key: "renovated",
    stock_status: "instock",
    categories: [{ name: "HP tonery", slug: "hp-tonery" }],
    search_text: "renovovany toner hatona pre hp ce411a 305a cyan",
  },
  {
    id: 10,
    name: "Renovovaný toner HATONA pre HP CE410X 305X Black",
    sku: "HAT-305X-BK",
    slug: "renovovany-toner-hatona-pre-hp-ce410x-305x-black",
    product_type_key: "renovated",
    stock_status: "instock",
    categories: [{ name: "HP tonery", slug: "hp-tonery" }],
    search_text: "renovovany toner hatona pre hp ce410x 305x black",
  },
];

const okiPrinters = [
  "OKI C301",
  "OKI C301dn",
  "OKI C321",
  "OKI C321dn",
  "OKI C331",
  "OKI C331dn",
  "OKI C511",
  "OKI C511dn",
  "OKI C530",
  "OKI C531",
  "OKI C531dn",
  "OKI MC352",
  "OKI MC352dn",
  "OKI MC362",
  "OKI MC362dn",
  "OKI MC562dn",
];

const okiProducts = [
  {
    id: 101,
    name: "OKI 44973533 žltý kompatibilný toner",
    sku: "44973533",
    slug: "oki-44973533-zlty-kompatibilny-toner",
    product_type_key: "compatible",
    stock_status: "instock",
    categories: [{ name: "OKI", slug: "oki" }],
    compatible_printers: okiPrinters,
    printers: okiPrinters,
    search_text: `oki 44973533 kompatibilny toner ${okiPrinters.join(" ").toLowerCase()}`,
  },
  {
    id: 102,
    name: "OKI 44973536 originálny toner",
    sku: "44973536",
    slug: "oki-44973536-originalny-toner",
    product_type_key: "original",
    stock_status: "instock",
    categories: [{ name: "OKI", slug: "oki" }],
    compatible_printers: ["OKI C301"],
    search_text: "oki 44973536 originalny toner oki c301",
  },
  {
    id: 103,
    name: "Renovovaný toner HATONA pre OKI C301/321 Black",
    sku: "HAT-C301-BK",
    slug: "renovovany-toner-hatona-pre-oki-c301-321-black",
    product_type_key: "renovated",
    stock_status: "instock",
    categories: [{ name: "OKI", slug: "oki" }],
    compatible_printers: [],
    search_text: "renovovany toner hatona pre oki c301 321 black",
  },
  {
    id: 104,
    name: "Toner pre inú tlačiareň",
    sku: "OTHER-C301DN",
    slug: "toner-pre-oki-c301dn",
    product_type_key: "compatible",
    stock_status: "instock",
    categories: [{ name: "OKI", slug: "oki" }],
    compatible_printers: ["OKI C301dn"],
    search_text: "toner pre inu tlaciaren oki c301dn",
  },
];

test("HP 652 nájde iba produktovú rodinu 652 a 652XL", () => {
  const matches = findExactProductIdentityMatches(products, "HP 652");
  assert.deepEqual(matches.map((match) => match.product.id), [1, 2]);
});

test("spojený zápis HP652 funguje rovnako", () => {
  const matches = findExactProductIdentityMatches(products, "HP652");
  assert.deepEqual(matches.map((match) => match.product.id), [1, 2]);
});

test("HP 652XL vráti iba XL variant", () => {
  const matches = findExactProductIdentityMatches(products, "HP 652 XL");
  assert.deepEqual(matches.map((match) => match.product.id), [2]);
});

test("HP 655 a HP 650 sa nemiešajú s modelmi tlačiarní", () => {
  assert.deepEqual(findExactProductIdentityMatches(products, "HP 655").map((match) => match.product.id), [5]);
  assert.deepEqual(findExactProductIdentityMatches(products, "HP 650").map((match) => match.product.id), [6]);
});

test("HP 305 vráti atramentovú rodinu 305/305XL bez tonerov 305A a 305X", () => {
  assert.deepEqual(findExactProductIdentityMatches(products, "HP 305").map((match) => match.product.id), [7, 8]);
  assert.deepEqual(filterProducts(products, { search: "HP 305", category: "atramentove-naplne" }).map((product) => product.id), [7, 8]);
});

test("HP M652 zostáva modelom tlačiarne, nie náplňou HP 652", () => {
  const analysis = analyzeCatalogQuery("HP M652");
  assert.equal(findExactProductIdentityMatches(products, "HP M652").length, 0);
  assert.equal(printerReferenceMatches("HP Color LaserJet Enterprise M652", analysis), true);
});

test("HP 652 sa nezhoduje s tlačiarňou HP DeskJet 6520", () => {
  const analysis = analyzeCatalogQuery("HP 652");
  assert.equal(printerReferenceMatches("HP DeskJet 6520", analysis), false);
});

test("OKI C301 nájde produkty podľa priradeného modelu, nielen podľa názvu", () => {
  assert.deepEqual(
    findExactPrinterModelMatches(okiProducts, "OKI C301").map((match) => match.product.id),
    [101, 102],
  );

  assert.deepEqual(
    filterProducts(okiProducts, { search: "OKI C301" }).map((product) => product.id),
    [101, 102, 103],
  );
});

test("každý zo 16 priradených modelov dohľadá produkt", () => {
  for (const printer of okiPrinters) {
    const matches = findExactPrinterModelMatches(okiProducts, printer).map((match) => match.product.id);
    assert.ok(matches.includes(101), `${printer} musí nájsť produkt 101`);
  }
});

test("import z WooCommerce zachová všetkých 16 priradených modelov", () => {
  const mapped = mapProduct({
    id: 201,
    name: "OKI 44973533 žltý kompatibilný toner",
    sku: "44973533",
    slug: "oki-44973533-zlty-kompatibilny-toner",
    price: "12.36",
    stock_status: "instock",
    categories: [{ id: 1, name: "Tonery", slug: "tonery" }],
    tags: [],
    images: [],
    description: "",
    short_description: "",
    attributes: [{
      id: 10,
      name: "Kompatibilné tlačiarne",
      slug: "kompatibilne-tlaciarne",
      options: okiPrinters,
    }],
    meta_data: [],
  });

  assert.equal(mapped.compatible_printers.length, 16);
  assert.deepEqual(mapped.compatible_printers, okiPrinters);
});

test("presný model C301 sa nemieša s C301dn ani C3010", () => {
  assert.equal(findExactPrinterModelMatches(okiProducts, "OKI C301").some((match) => match.product.id === 104), false);
  assert.equal(findExactPrinterModelMatches(okiProducts, "OKI C301dn").some((match) => match.product.id === 104), true);
});

test("OpenAI odpoveď musí mať povolený stav, odseky a istotu", () => {
  assert.deepEqual(validateGroundedOpenAiResult({
    status: "clarify",
    answer: ["Napíšte presný model tlačiarne."],
    confidence: 0.61,
  }), {
    status: "clarify",
    answer: ["Napíšte presný model tlačiarne."],
    confidence: 0.61,
  });

  assert.equal(validateGroundedOpenAiResult({
    status: "answer",
    answer: [],
    confidence: 1,
  }), null);
});
