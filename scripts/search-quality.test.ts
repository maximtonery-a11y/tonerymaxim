import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCatalogQuery,
  findExactProductIdentityMatches,
  printerReferenceMatches,
} from "../src/lib/catalog-query.ts";
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

test("HP M652 zostáva modelom tlačiarne, nie náplňou HP 652", () => {
  const analysis = analyzeCatalogQuery("HP M652");
  assert.equal(findExactProductIdentityMatches(products, "HP M652").length, 0);
  assert.equal(printerReferenceMatches("HP Color LaserJet Enterprise M652", analysis), true);
});

test("HP 652 sa nezhoduje s tlačiarňou HP DeskJet 6520", () => {
  const analysis = analyzeCatalogQuery("HP 652");
  assert.equal(printerReferenceMatches("HP DeskJet 6520", analysis), false);
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
