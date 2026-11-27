import assert from "node:assert/strict";
import test from "node:test";
import { buildAiProductFeed } from "../src/lib/ai-product-feed.ts";
import { buildHeurekaFeed } from "../src/lib/heureka-feed.ts";
import { buildMerchantFeed, type MerchantFeedConfig } from "../src/lib/merchant-feed.ts";
import { toMerchantProduct } from "../src/lib/merchant-products.ts";
import { isAvailableNow } from "../src/lib/product-availability.ts";
import { notifyIndexNowAfterProductSync } from "../src/lib/indexnow.ts";

const ORIGIN = "https://www.tonerymaxim.sk";
const GENERATED_AT = "2026-10-27T08:00:00Z";
const config: MerchantFeedConfig = {
  origin: ORIGIN, minimumProducts: 1, shippingPrice: 3.9, freeShippingFrom: 29,
  minHandlingTime: 0, maxHandlingTime: 1, minTransitTime: 1, maxTransitTime: 2,
};

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, slug: "brother-tn-2421", name: "Brother TN-2421 čierny kompatibilný toner",
    price: 20, stock_status: "instock", stock_quantity: 5, product_type_key: "compatible",
    product_brand: "Brother", color: "Čierna", capacity: "3000 strán",
    images: [`${ORIGIN}/images/tn2421.jpg`], categories: [{ name: "Tonery" }],
    description: "Kompatibilný čierny toner pre Brother DCP-L2532DW s výťažnosťou 3000 strán.",
    ...overrides,
  };
}

function setEnv(t: any, name: string, value: string) {
  const before = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
}

for (const quantity of [null, undefined, "", "  ", 5, "5"]) {
  test(`feed availability matches storefront for available stock ${JSON.stringify(quantity)}`, (t) => {
    setEnv(t, "HEUREKA_FEED_MIN_PRODUCTS", "1");
    const item = product({ stock_quantity: quantity });
    assert.equal(isAvailableNow(item), true);
    assert.equal(toMerchantProduct(item, ORIGIN)?.availability, "in_stock");
    assert.equal(buildMerchantFeed([item], GENERATED_AT, config).stats.includedProducts, 1);
    assert.match(buildHeurekaFeed([item]).xml, /<SHOPITEM>/);
    const aiXml = buildAiProductFeed([item], GENERATED_AT);
    assert.match(aiXml, /<g:availability>in_stock<\/g:availability>/);
    if (quantity == null || String(quantity).trim() === "") {
      assert.doesNotMatch(aiXml, /<tm:stock_quantity>0<\/tm:stock_quantity>/);
    }
  });
}

for (const quantity of [0, "0", -1, "invalid", Infinity]) {
  test(`feeds do not claim availability for unusable stock ${String(quantity)}`, (t) => {
    setEnv(t, "HEUREKA_FEED_MIN_PRODUCTS", "1");
    const item = product({ stock_quantity: quantity });
    assert.equal(isAvailableNow(item), false);
    assert.equal(toMerchantProduct(item, ORIGIN)?.availability, "out_of_stock");
    assert.throws(() => buildMerchantFeed([item], GENERATED_AT, config), /safety gate/);
    assert.throws(() => buildHeurekaFeed([item]), /safety gate/);
    assert.match(buildAiProductFeed([item], GENERATED_AT), /<g:availability>out_of_stock<\/g:availability>/);
  });
}

test("out-of-stock status overrides a positive quantity in every feed", (t) => {
  setEnv(t, "HEUREKA_FEED_MIN_PRODUCTS", "1");
  const item = product({ stock_status: "outofstock", stock_quantity: 10 });
  assert.equal(toMerchantProduct(item, ORIGIN)?.availability, "out_of_stock");
  assert.throws(() => buildHeurekaFeed([item]), /safety gate/);
  assert.throws(() => buildMerchantFeed([item], GENERATED_AT, config), /safety gate/);
  assert.match(buildAiProductFeed([item], GENERATED_AT), /<g:availability>out_of_stock<\/g:availability>/);
});

test("Shopping set titles identify the exact family and descriptions use only that set’s printers", () => {
  const families = [
    { id: 52830, code: "CRG-045", model: "Canon i-SENSYS LBP611Cn" },
    { id: 52837, code: "CRG-054", model: "Canon i-SENSYS LBP623Cdw" },
    { id: 52853, code: "CRG-075", model: "Canon i-SENSYS LBP646Cdw" },
  ];
  const sets = families.map(({ id, code, model }) => product({
    id, slug: `canon-${code.toLowerCase()}-sada`, name: `Canon ${code} CMYK kompatibilná sada tonerov (4 ks)`,
    product_brand: "Canon", color: "CMYK", compatible_printers: [model, model],
  }));
  const items = buildMerchantFeed(sets, GENERATED_AT, config).xml.split("<item>").slice(1);
  assert.equal(items.length, families.length);
  families.forEach(({ id, code, model }, index) => {
    const xml = items[index];
    assert.ok(xml.includes(`<g:id>${id}</g:id>`));
    assert.ok(xml.includes(`<g:content>Kompatibilná sada pre Canon ${code} – 4 tonery CMYK</g:content>`));
    assert.ok(xml.includes(`<g:content>Určené pre tlačiarne ${model}. `));
    assert.equal(xml.split(model).length - 1, 1);
    for (const other of families.filter((family) => family.id !== id)) {
      assert.ok(!xml.includes(other.code) && !xml.includes(other.model));
    }
  });
});

test("Shopping preserves the identity of a new mixed pack and does not infer missing printers", () => {
  const pack = product({
    id: 999999, name: "Canon PGI-5/CLI-8 BK+CMYK kompatibilná sada atramentových náplní (5 ks)",
    slug: "canon-pgi5-cli8-sada", product_brand: "Canon", color: "BK+CMYK",
    compatible_printers: [], description: "Sada obsahuje päť atramentových náplní pre farebnú tlač.",
  });
  const { xml } = buildMerchantFeed([pack], GENERATED_AT, config);
  assert.match(xml, /<g:title>Kompatibilné pre Canon PGI-5\/CLI-8 BK\+CMYK – sada atramentových náplní \(5 ks\)<\/g:title>/);
  assert.doesNotMatch(xml, /Určené pre tlačiarne/);
});

test("an explicitly curated printer list is emitted once without adding other models", () => {
  const pack = product({
    id: 52849, name: "Canon CRG-067H CMYK kompatibilná sada tonerov", slug: "canon-crg-067h-sada",
    product_brand: "Canon", color: "CMYK", compatible_printers: ["Canon i-SENSYS LBP631Cw", "Other model"],
  });
  const { xml } = buildMerchantFeed([pack], GENERATED_AT, config);
  assert.equal(xml.split("Canon i-SENSYS LBP631Cw").length - 1, 1);
  assert.doesNotMatch(xml, /Other model/);
});

function captureIndexNow(t: any) {
  setEnv(t, "TM_DISABLE_INDEXNOW", "0");
  const payloads: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.indexnow.org/indexnow");
    payloads.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 200 });
  });
  return payloads;
}

test("IndexNow reports both old and new URLs after a slug change", async (t) => {
  const payloads = captureIndexNow(t);
  const result = await notifyIndexNowAfterProductSync([product()], [product({ slug: "brother-tn-2421-black" })]);
  const urls = payloads.flatMap((p) => p.urlList);
  assert.ok(urls.includes(`${ORIGIN}/produkt/brother-tn-2421`));
  assert.ok(urls.includes(`${ORIGIN}/produkt/brother-tn-2421-black`));
  assert.equal(new Set(urls).size, urls.length);
  assert.equal(result.accepted, urls.length);
});

test("IndexNow does not make requests for an unchanged catalogue", async (t) => {
  const payloads = captureIndexNow(t);
  assert.equal((await notifyIndexNowAfterProductSync([product()], [product()])).status, "skipped");
  assert.equal(payloads.length, 0);
});

test("IndexNow preserves deletion notifications and deduplicates product URLs", async (t) => {
  const payloads = captureIndexNow(t);
  await notifyIndexNowAfterProductSync([product()], []);
  const urls = payloads.flatMap((p) => p.urlList);
  assert.equal(urls.filter((url: string) => url === `${ORIGIN}/produkt/brother-tn-2421`).length, 1);
});

test("disabled IndexNow never makes an external request", async (t) => {
  const payloads = captureIndexNow(t);
  process.env.TM_DISABLE_INDEXNOW = "1";
  assert.equal((await notifyIndexNowAfterProductSync([], [product()])).status, "skipped");
  assert.equal(payloads.length, 0);
});
