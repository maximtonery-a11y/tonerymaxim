import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAssistantAnswer } from "../src/lib/aiSalesAssistant.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("kalendáre sú v mobilnom menu domovskej aj ostatných stránok", () => {
  const home = read("src/pages/index.astro");
  const header = read("src/components/Header.astro");
  assert.match(home, /<a href="\/kalendare\/">Kalendáre 2027<\/a>/);
  assert.match(header, /<a href="\/kalendare\/">Kalendáre 2027<\/a>/);
  assert.match(home, /data-tm-mobile-menu/);
  assert.match(header, /data-tm-global-menu/);
});

test("AI Tomáš odpovie na bežnú otázku čo robíte", async () => {
  for (const question of ["Čo robíte?", "Čomu sa venujete?", "Čo je ToneryMAXIM?"]) {
    const result = await buildAssistantAnswer(question);
    const answer = result.answer.join(" ");
    assert.match(answer, /toner/i, question);
    assert.match(answer, /kalendár/i, question);
    assert.equal(result.unanswered, undefined, question);
  }
});

test("zlúčenie zachovalo opravu zákazníckej adresy a cien s DPH", () => {
  const checkout = read("src/lib/checkout-order.ts");
  const display = read("src/pages/ucet/objednavky.astro");
  assert.match(checkout, /updateWooCustomer/);
  assert.match(checkout, /customerProfileUpdateFromOrder/);
  assert.match(display, /orderLineGrossTotal/);
});

test("kalendárový katalóg nezdržiava odpoveď čakaním na sieť", () => {
  const source = read("src/lib/calendar-ai-catalog.ts");
  assert.match(source, /void refreshRows\(\)/);
  assert.match(source, /return rows/);
  assert.doesNotMatch(source, /return inFlight;\s*\n}\s*\n\s*export function isCalendarQuery/);
});
