import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GEO_PRIORITY_OEMS, GEO_PRIORITY_PRINTERS, geoOemPriority, geoPrinterPriority } from "../src/data/geo-priorities.ts";

test("GEO priority lists contain exactly 20 printers and 20 OEM families", () => {
  assert.equal(GEO_PRIORITY_PRINTERS.length, 20);
  assert.equal(GEO_PRIORITY_OEMS.length, 20);
  assert.equal(new Set(GEO_PRIORITY_PRINTERS.map((item) => item.key)).size, 20);
  assert.equal(new Set(GEO_PRIORITY_OEMS.map((item) => item.key)).size, 20);
});

test("priority matching is exact and normalized", () => {
  assert.equal(geoPrinterPriority("hp-laserjet-m110w")?.label, "HP LaserJet M110w");
  assert.equal(geoOemPriority("TN-2421")?.label, "TN-2421");
  assert.equal(geoOemPriority("W1420A")?.label, "W1420A");
  assert.equal(geoOemPriority("W1350A"), undefined);
});

test("benchmark contains 50 stable unique prompts", () => {
  const data = JSON.parse(fs.readFileSync(new URL("../data/geo-ai-benchmark.json", import.meta.url), "utf8"));
  assert.equal(data.prompts.length, 50);
  assert.equal(new Set(data.prompts.map((item: { id: string }) => item.id)).size, 50);
  for (const item of data.prompts) {
    assert.ok(item.prompt);
    assert.ok(item.target.startsWith("/"));
    assert.ok(item.expected.length > 0);
  }
});

test("priority pages use benchmark questions, cautious wording and server-rendered links", () => {
  const printer = fs.readFileSync(new URL("../src/pages/tlaciarne/[brand]/[model].astro", import.meta.url), "utf8");
  const oem = fs.readFileSync(new URL("../src/pages/oem/[code].astro", import.meta.url), "utf8");
  const content = fs.readFileSync(new URL("../src/data/geo-benchmark-content.ts", import.meta.url), "utf8");
  for (const source of [printer, oem]) {
    assert.match(source, /benchmarkForPath/);
    assert.match(source, /Relevantné návody/);
    assert.match(source, /#produkty/);
    assert.doesNotMatch(source, /Overená kompatibilita|Overené údaje/);
  }
  assert.match(content, /Podľa aktuálneho katalógu ToneryMaxim\.sk/);
});

test("expert profile is a single linked Person entity", () => {
  const expert = fs.readFileSync(new URL("../src/lib/expert.ts", import.meta.url), "utf8");
  const profile = fs.readFileSync(new URL("../src/pages/autor/roman-babcan.astro", import.meta.url), "utf8");
  const catalog = fs.readFileSync(new URL("../src/components/SeoCatalogPage.astro", import.meta.url), "utf8");
  const article = fs.readFileSync(new URL("../src/components/AdviceArticlePage.astro", import.meta.url), "utf8");
  assert.match(expert, /EXPERT_PATH = "\/autor\/roman-babcan"/);
  assert.match(expert, /"@type": "Person"/);
  assert.match(profile, /"@type": "ProfilePage"/);
  assert.match(catalog, /expertPersonJsonLd/);
  assert.match(article, /expertPersonJsonLd/);
});

test("GEO content additions do not add client-side scripts", () => {
  for (const path of [
    "../src/pages/autor/roman-babcan.astro",
    "../src/pages/tlaciarne/[brand]/[model].astro",
    "../src/pages/oem/[code].astro",
  ]) {
    const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<script(?:\s|>)/i);
    assert.doesNotMatch(source, /client:(load|idle|visible|only)/);
  }
});
