import assert from "node:assert/strict";
import test from "node:test";
import { parseFirmwareArticle } from "../src/lib/firmware-info.ts";

test("ABIX firmware článok sa premení na bezpečný zákaznícky prehľad", () => {
  const payload = {
    textHtml: `<p>Vážení zákazníci,</p><p>Model CF259 - na sklade kazety s najnovším čipom.</p><p>Model HP415 - na sklade kazety s najnovším čipom.</p><p>Atramentové kazety našej výroby:</p><p>Model HP903;HP907 - funkčné kazety s označením s označením ABA</p><p>Model HP963 - funkčné kazety s označením C6</p>`,
  };
  assert.deepEqual(parseFirmwareArticle(payload), [
    { codes: "CF259", status: "Dostupná je verzia kazety s najnovším čipom.", kind: "toner" },
    { codes: "HP415", status: "Dostupná je verzia kazety s najnovším čipom.", kind: "toner" },
    { codes: "HP903; HP907", status: "Funkčné sú kazety s čipom označeným ABA.", kind: "atrament" },
    { codes: "HP963", status: "Funkčné sú kazety s čipom označeným C6.", kind: "atrament" },
  ]);
});

test("parser odmietne nečakaný obsah namiesto zverejnenia cudzej stránky", () => {
  assert.throws(() => parseFirmwareArticle({ textHtml: "Prihláste sa" }), /rozpoznateľné údaje/);
});
