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
