import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
test("printer pages expose clickable type filters", async () => {
  const component = await read("src/components/SeoCatalogPage.astro");
  const page = await read("src/pages/tlaciarne/[brand]/[model].astro");
  assert.match(component, /data-seo-type-filter/); assert.match(component, /applyTypeFilter/); assert.match(page, /productTypeFilters=\{!notFound\}/);
});
test("renovation service products are removed from public catalog", async () => {
  const cache = await read("src/lib/tm-products-cache.ts"); assert.match(cache, /isHiddenRenovationService/); assert.match(cache, /sluzba renovacia/); assert.match(cache, /publicCatalogCache/);
});
test("description modal is scrollable and closable above sticky UI", async () => {
  const css = await read("src/styles/product-detail.css"); const js = await read("src/scripts/product-detail.js");
  assert.match(css, /description-modal\{z-index:2147483000/); assert.match(css, /description-modal \.modal-close\{position:sticky/); assert.match(css, /overflow-y:auto/); assert.match(js, /data-close-description/);
});
