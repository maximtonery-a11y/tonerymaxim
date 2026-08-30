import test from "node:test";
import assert from "node:assert/strict";
import { buildAiProductFeed } from "../src/lib/ai-product-feed.ts";
import { buildHeurekaFeed } from "../src/lib/heureka-feed.ts";
import { buildMerchantProducts } from "../src/lib/merchant-products.ts";
import { buildProductSeo } from "../src/lib/catalog-seo-text.ts";
import { publicationEligibleProduct, resolvedPublicationBrand } from "../src/lib/product-publication-policy.ts";
import { validIndexableProduct } from "../src/lib/seo-catalog.ts";

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, slug: "test", name: "Brother TN2421 kompatibilný toner", price: "20",
    stock_status: "instock", stock_quantity: 2, product_type_key: "compatible",
    product_brand: "Brother", color: "Čierna", capacity: "3000 strán",
    images: ["https://www.tonerymaxim.sk/test.jpg"], categories: [{ name: "Tonery" }],
    ...overrides,
  } as any;
}

test("jednoznačná značka sa publikuje a je prvá v SEO title", () => {
  const item = product();
  assert.equal(resolvedPublicationBrand(item), "Brother");
  assert.equal(publicationEligibleProduct(item), true);
  assert.match(buildProductSeo(item, [item]).title, /^Brother TN2421 čierny kompatibilný toner/);
});

test("C-EXV sa bezpečne mapuje na Canon automaticky", () => {
  const item = product({ name: "Kompatibilná tonerová náplň C-EXV33 comp", product_brand: "", slug: "c-exv33" });
  assert.equal(resolvedPublicationBrand(item), "Canon");
  assert.match(buildProductSeo(item, [item]).title, /^Canon C-EXV 33/);
});

test("nejasná značka zablokuje index, Merchant, Heureka aj AI feed", () => {
  const unclear = product({ id: 9, slug: "neznamy-123", name: "123 kompatibilný toner", product_brand: "" });
  assert.equal(publicationEligibleProduct(unclear), false);
  assert.equal(validIndexableProduct(unclear), false);
  assert.equal(buildMerchantProducts([unclear], "https://www.tonerymaxim.sk").length, 0);
  assert.doesNotMatch(buildAiProductFeed([unclear], new Date().toISOString()), /<item>/);
  process.env.HEUREKA_FEED_MIN_PRODUCTS = "1";
  assert.throws(() => buildHeurekaFeed([unclear]), /safety gate/);
});

test("nový produkt sa vyhodnotí z dát bez ručného zoznamu ID", () => {
  const future = product({ id: 999999, slug: "star-sp-200", name: "Original páska STAR SP 200 black", product_brand: "", product_type_key: "original" });
  assert.equal(resolvedPublicationBrand(future), "STAR");
  assert.equal(publicationEligibleProduct(future), true);
  assert.match(buildProductSeo(future, [future]).title, /^STAR SP 200 čierna originálna tlačová páska/);
});

test("papier ani obálka LC5 sa nezmenia na atramentovú náplň", () => {
  const paper = product({ name: "Glossy foto papier, lesklý A4, atramentový", product_brand: "Canon", product_type_key: "product", color: "" });
  const envelope = product({ name: "Canon Obálka LC5 samolepiaca", product_brand: "Canon", product_type_key: "product", color: "" });
  assert.doesNotMatch(buildProductSeo(paper, [paper]).title, /atramentová náplň/);
  assert.doesNotMatch(buildProductSeo(envelope, [envelope]).title, /atramentová náplň/);
});
