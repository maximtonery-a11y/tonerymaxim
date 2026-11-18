import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
test("printer pages expose clickable type filters", async () => {
  const component = await read("src/components/SeoCatalogPage.astro");
  const page = await read("src/pages/tlaciarne/[brand]/[model].astro");
  assert.match(component, /data-seo-type-filter/);
  assert.match(component, /filterHref/);
  assert.match(page, /searchParams\.get\("typ"\)/);
  assert.match(page, /productTypeFilters=\{!notFound\}/);
});
test("renovation service products are removed from public catalog", async () => {
  const cache = await read("src/lib/tm-products-cache.ts"); assert.match(cache, /isHiddenRenovationService/); assert.match(cache, /sluzba renovacia/); assert.match(cache, /publicCatalogCache/);
});
test("server-rendered description has native disclosure and an independently scrollable modal", async () => {
  const component = await read("src/components/ProductInformation.astro");
  const css = await read("src/styles/product-information.css");
  const js = await read("src/scripts/product-detail.js");
  assert.match(component, /<details class="pd-info-reading">/);
  assert.match(component, /<dialog id="pd-info-dialog"/);
  assert.match(component, /<form method="dialog">/);
  assert.match(css, /\.pd-info-dialog-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(js, /dialog\.showModal\(\)/);
  assert.match(js, /slot\.append\(copy\)/);
});
