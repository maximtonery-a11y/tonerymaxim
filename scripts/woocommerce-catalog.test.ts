import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function mockProduct(id: number) {
  return {
    id,
    sku: `TM-${id}`,
    name: `HP Test ${id} kompatibilný toner`,
    slug: `hp-test-${id}-kompatibilny-toner`,
    price: "12.90",
    regular_price: "12.90",
    sale_price: "",
    stock_quantity: 10,
    stock_status: "instock",
    images: [{ src: `https://example.test/product-${id}.jpg` }],
    description: `Testovací produkt ${id}`,
    short_description: "Kompatibilný toner",
    categories: [{ id: 1, name: "Tonery", slug: "tonery" }],
    tags: [],
    attributes: [
      { id: 1, name: "Typ produktu", slug: "typ-produktu", options: ["Kompatibilný"] },
      { id: 2, name: "Kompatibilné tlačiarne", slug: "kompatibilne-tlaciarne", options: ["HP LaserJet Test"] },
    ],
    meta_data: [],
  };
}

test("WooCommerce katalóg načíta všetky strany, prežije 429 a uloží kompletnú cache", async () => {
  const products = Array.from({ length: 235 }, (_, index) => mockProduct(index + 1));
  const cacheDir = await mkdtemp(join(tmpdir(), "tm-woo-cache-"));
  const expectedAuth = `Basic ${Buffer.from("ck_test:cs_test").toString("base64")}`;
  let pageTwoAttempts = 0;

  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/wp-json/wc/v3/products") {
      response.writeHead(404).end("not found");
      return;
    }
    if (request.headers.authorization !== expectedAuth) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "woocommerce_rest_cannot_view", message: "Unauthorized" }));
      return;
    }

    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.max(1, Number(url.searchParams.get("per_page") || 100));
    if (page === 2 && pageTwoAttempts++ === 0) {
      response.writeHead(429, { "content-type": "application/json", "retry-after": "0" });
      response.end(JSON.stringify({ code: "rate_limited", message: "Try again" }));
      return;
    }

    const start = (page - 1) * perPage;
    const body = products.slice(start, start + perPage);
    response.writeHead(200, {
      "content-type": "application/json",
      "x-wp-total": String(products.length),
      "x-wp-totalpages": String(Math.ceil(products.length / perPage)),
    });
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  const previous = {
    WOO_URL: process.env.WOO_URL,
    WOO_CONSUMER_KEY: process.env.WOO_CONSUMER_KEY,
    WOO_CONSUMER_SECRET: process.env.WOO_CONSUMER_SECRET,
    WOO_SYNC_MIN_PRODUCTS: process.env.WOO_SYNC_MIN_PRODUCTS,
    WOO_SYNC_EXPECTED_MIN_PRODUCTS: process.env.WOO_SYNC_EXPECTED_MIN_PRODUCTS,
    WOO_SYNC_PER_PAGE: process.env.WOO_SYNC_PER_PAGE,
    TM_CACHE_DIR: process.env.TM_CACHE_DIR,
  };

  process.env.WOO_URL = `http://127.0.0.1:${address.port}/wp-json/wc/v3`;
  process.env.WOO_CONSUMER_KEY = "ck_test";
  process.env.WOO_CONSUMER_SECRET = "cs_test";
  process.env.WOO_SYNC_MIN_PRODUCTS = "100";
  process.env.WOO_SYNC_EXPECTED_MIN_PRODUCTS = "0";
  process.env.WOO_SYNC_PER_PAGE = "100";
  process.env.TM_CACHE_DIR = cacheDir;

  try {
    const module = await import(`../src/lib/tm-products-cache.ts?woo-test=${Date.now()}`);
    assert.equal(module.normalizeWooSiteUrl(process.env.WOO_URL), `http://127.0.0.1:${address.port}`);

    const result = await module.syncProductsCache({ force: true });
    assert.equal(result.refreshed, true);
    assert.equal(result.cache.total, products.length);
    assert.equal(result.cache.woo_reported_total, products.length);
    assert.equal(result.cache.products.length, products.length);
    assert(pageTwoAttempts >= 2, "Druhá strana sa mala po 429 zopakovať.");

    const saved = JSON.parse(await readFile(join(cacheDir, "products.json"), "utf8"));
    assert.equal(saved.total, products.length);
    assert.equal(saved.products.length, products.length);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(cacheDir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("produkčná cesta /app sa na Windows localhoste nepoužije", async () => {
  const { portableStoragePath } = await import("../src/lib/runtime-paths.ts");
  assert.equal(portableStoragePath("/app/data/product-cache", "win32"), "");
  assert.equal(portableStoragePath("C:\\Users\\roman\\tonerymaxim\\.tm-cache", "win32"), "C:\\Users\\roman\\tonerymaxim\\.tm-cache");
  assert.equal(portableStoragePath("/app/data/product-cache", "linux"), "/app/data/product-cache");
});
