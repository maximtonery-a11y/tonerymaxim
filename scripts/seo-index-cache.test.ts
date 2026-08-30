import assert from "node:assert/strict";
import test from "node:test";
import {
  brandProducts,
  findBrand,
  findOemEntity,
  findPrinterEntity,
  oemEntities,
  printerEntities,
} from "../src/lib/seo-catalog.ts";

function product(id: number, name: string, sku: string, printers: string[], type = "compatible") {
  return {
    id,
    name,
    sku,
    slug: `produkt-${id}`,
    price: 10 + id,
    stock_status: "instock",
    stock_quantity: 10,
    product_type_key: type,
    compatible_printers: printers,
    search_text: `${name} ${sku} ${printers.join(" ")}`.toLowerCase(),
  };
}

function catalogue(multiplier = 1) {
  const base = [
    product(1, "HP 142XL W1420XL kompatibilný toner", "W1420XL", ["HP LaserJet M110w", "HP LaserJet MFP M140w"]),
    product(2, "HP 142A W1420A originálny toner", "W1420A", ["HP LaserJet M110w", "HP LaserJet MFP M140w"], "original"),
    product(3, "Brother TN2421 kompatibilný toner", "TN2421", ["Brother DCP-L2532DW"]),
  ];
  return Array.from({ length: multiplier }, (_, group) => base.map((item) => ({
    ...item,
    id: group * 10 + item.id,
    slug: `${item.slug}-${group}`,
  }))).flat();
}

test("opakované vyhľadanie tlačiarne vracia cacheovanú entitu", () => {
  const products = catalogue(500);
  const first = findPrinterEntity(products, "hp", "hp-laserjet-m110w");
  const second = findPrinterEntity(products, "hp", "hp-laserjet-m110w");
  assert.ok(first);
  assert.strictEqual(second, first);
  assert.equal(first.products.length, 1000);
});

test("neexistujúci model sa cacheuje bez vytvárania falošnej entity", () => {
  const products = catalogue(500);
  assert.equal(findPrinterEntity(products, "hp", "hp-laserjet-neexistuje-9999"), null);
  assert.equal(findPrinterEntity(products, "hp", "hp-laserjet-neexistuje-9999"), null);
});

test("globálny index tlačiarní naplní lookup mapu rovnakými entitami", () => {
  const products = catalogue(100);
  const entities = printerEntities(products);
  const expected = entities.find((item) => item.brand.slug === "brother" && item.slug === "brother-dcp-l2532dw");
  const found = findPrinterEntity(products, "brother", "brother-dcp-l2532dw");
  assert.ok(expected);
  assert.strictEqual(found, expected);
});

test("OEM lookup používa mapu a zachová referenciu entity", () => {
  const products = catalogue(500);
  const entities = oemEntities(products);
  const expected = entities.find((item) => item.slug === "w1420xl");
  const first = findOemEntity(products, "W1420XL");
  const second = findOemEntity(products, "w-1420-xl");
  assert.ok(expected);
  assert.strictEqual(first, expected);
  assert.strictEqual(second, expected);
});

test("produkty značky sa filtrujú iba raz pre rovnakú produktovú cache", () => {
  const products = catalogue(500);
  const hp = findBrand("hp");
  assert.ok(hp);
  const first = brandProducts(products, hp);
  const second = brandProducts(products, hp);
  assert.strictEqual(second, first);
  assert.equal(first.length, 1000);
});

test("nové pole produktov nepoužije index starej produktovej cache", () => {
  const firstProducts = catalogue(10);
  const secondProducts = catalogue(11);
  const first = findPrinterEntity(firstProducts, "hp", "hp-laserjet-m110w");
  const second = findPrinterEntity(secondProducts, "hp", "hp-laserjet-m110w");
  assert.ok(first && second);
  assert.notStrictEqual(first, second);
  assert.equal(first.products.length, 20);
  assert.equal(second.products.length, 22);
});
