import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseLegacyPath } from "../src/lib/legacy/parser.ts";
import {
  resolveLegacyBrandFallback,
  resolveLegacyRedirect,
} from "../src/lib/legacy/redirects.ts";
import { LEGACY_PRODUCT_REDIRECTS } from "../src/lib/legacy/product-redirect-map.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("staré URL sa normalizujú bez query, lomiek a veľkosti písmen", () => {
  const route = parseLegacyPath("https://www.tonerymaxim.sk//HP/Laserova-Tlaciaren/HP-LaserJet-M404DN/?utm_source=old");
  assert.equal(route.normalizedPath, "/hp/laserova-tlaciaren/hp-laserjet-m404dn");
  assert.equal(route.kind, "brand-tree");
  assert.equal(route.brandSlug, "hp");
});

test("koreň výrobcu tlačiarní má jeden trvalý cieľ", () => {
  const hp = resolveLegacyRedirect(parseLegacyPath("/vyrobci/hp/"));
  const sharp = resolveLegacyRedirect(parseLegacyPath("/vyrobci/sharp/"));
  assert.deepEqual(hp, { location: "/tlaciarne/hp", status: 301, reason: "manufacturer-brand" });
  assert.deepEqual(sharp, { location: "/tlaciarne/sharp", status: 301, reason: "manufacturer-brand" });
});

test("stará kategória značky smeruje na značku, model sa nesmie zovšeobecniť", () => {
  const category = resolveLegacyBrandFallback(parseLegacyPath("/hp/laserova-tlaciaren/"));
  const model = resolveLegacyBrandFallback(parseLegacyPath("/hp/laserova-tlaciaren/hp-laserjet-m404dn/"));
  assert.deepEqual(category, { location: "/tlaciarne/hp", status: 301, reason: "brand-fallback" });
  assert.equal(model, null);
});

test("starý model sa presmeruje iba na existujúcu kanonickú dvojúrovňovú routu", () => {
  const source = read("src/pages/[...legacy].astro");
  assert.match(source, /entitySlug\(printerMatch\.title\)/);
  assert.match(source, /findPrinterEntity\(cache\.products, route\.brandSlug, modelSlug\)/);
  assert.match(source, /if \(canonicalPrinter\)[\s\S]*Astro\.redirect\(`\/tlaciarne\/\$\{canonicalPrinter\.brand\.slug\}\/\$\{canonicalPrinter\.slug\}`, 301\)/);
  assert.ok(source.indexOf("resolveLegacyBrandFallback(route)") < source.indexOf("findLegacyCollection(route)"));
});

test("odstránený sortiment vracia skutočný 410 a neindexuje sa", () => {
  const source = read("src/pages/[...legacy].astro");
  assert.match(source, /Astro\.response\.status = 410/);
  assert.match(source, /X-Robots-Tag", "noindex, follow, noarchive"/);
});

test("lokálny Migration Gate vypína workery a pred testom pripraví jednu cache", () => {
  const runner = read("scripts/run-migration-gate.mjs");
  const middleware = read("src/middleware.ts");
  const cache = read("src/lib/tm-products-cache.ts");

  assert.match(runner, /TM_DISABLE_BACKGROUND_WORKERS: "1"/);
  assert.match(runner, /warmProductsCache\(options\.baseUrl\)/);
  assert.match(runner, /\/api\/cache-status/);
  assert.match(runner, /\/api\/health/);
  assert.match(runner, /AUTH_SECRET:\s*strongOr/);
  assert.match(runner, /TM_PERSISTENCE_SECRET:\s*strongOr/);
  assert.match(runner, /SYNC_SECRET:\s*strongOr/);
  assert.match(runner, /ADMIN_API_SECRET:\s*strongOr/);
  assert.match(middleware, /ensureEmailQueueStarted/);
  assert.doesNotMatch(middleware, /ensureAsyncOrderQueueStarted/);
  assert.match(middleware, /TM_DISABLE_BACKGROUND_WORKERS/);
  assert.match(cache, /__TM_PRODUCTS_SYNC_PROMISE__/);
  assert.match(cache, /if \(activeSync\) return activeSync/);
});

test("finálna migrácia používa overenú produktovú mapu bez 302 fallbacku", () => {
  const page = read("src/pages/[...legacy].astro");
  const lookup = read("src/lib/legacy/product-lookup.ts");
  const recovery = read("src/lib/legacy/recovery.ts");
  const gate = read("scripts/migration-gate.mjs");

  assert.equal(Object.keys(LEGACY_PRODUCT_REDIRECTS).length, 1492);
  assert.match(page, /route\.kind === "product"[\s\S]*findLegacyProduct\(route\.productSlug\)/);
  assert.doesNotMatch(page, /isLegacyPrintProductSlug/);
  assert.match(lookup, /LEGACY_PRODUCT_REDIRECTS\[legacySlug\]/);
  assert.match(lookup, /matchedBy: "verified-redirect-map"/);
  assert.doesNotMatch(recovery, /status:\s*302/);
  assert.doesNotMatch(recovery, /product-search|printer-search|article-help|static-help/);
  assert.match(recovery, /discontinued-print-product/);
  assert.match(recovery, /obsolete-printer-model/);
  assert.match(recovery, /obsolete-article/);
  assert.match(gate, /DOČASNÝ REDIRECT/);
  assert.match(gate, /new Set\(\["PASS", "410 OK"\]\)/);
});
