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
