import assert from "node:assert/strict";
import test from "node:test";
import { toAdsProduct } from "../src/lib/ads-products.ts";
import { buildProductSeo } from "../src/lib/catalog-seo-text.ts";

const origin = "https://www.tonerymaxim.sk";
const pack = {
  id: 53690,
  name: "HP 201X / CF400-1-2-3X CMYK – kompatibilná sada (4 ks)",
  slug: "hp-201x-cmyk-sada",
  categories: [{ name: "Kompatibilné HP tonery" }],
  price: 70,
  product_type_key: "compatible",
  stock_status: "instock",
  stock_quantity: null,
};

test("Ads preserves missing quantities and agrees with the shop's stock flag", () => {
  for (const quantity of [undefined, null, ""]) {
    const item = toAdsProduct({ ...pack, stock_quantity: quantity }, origin);
    assert.equal(item?.material_type, "toner");
    assert.equal(item?.availability, "in_stock");
    assert.equal(item?.stock_quantity, null);
  }
  for (const quantity of [0, -1, "bad"]) {
    assert.equal(toAdsProduct({ ...pack, stock_quantity: quantity }, origin)?.availability, "out_of_stock");
  }
  assert.equal(toAdsProduct({ ...pack, stock_status: "outofstock" }, origin)?.availability, "out_of_stock");
  assert.equal(toAdsProduct({ ...pack, stock_quantity: 4 }, origin)?.stock_quantity, 4);
});

test("a quantity in the pack name takes precedence over a shortened HP OEM suffix", () => {
  assert.match(buildProductSeo(pack).title, /4 ks/);
  assert.doesNotMatch(buildProductSeo({ ...pack, name: pack.name.replace(" (4 ks)", "") }).title, /3 ks/);
});
