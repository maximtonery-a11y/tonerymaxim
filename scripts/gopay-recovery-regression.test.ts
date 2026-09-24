import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("zrušená GoPay platba sa pri offline platbe nemení na novú objednávku", async () => {
  const checkout = await read("src/scripts/checkout.js");
  const endpoint = await read("src/pages/api/gopay-change-payment.ts");
  assert.match(checkout, /isGoPayRecovery[\s\S]*gopay-change-payment/);
  assert.match(checkout, /alreadySubmitted\s*&&\s*isOnlinePayment/);
  assert.match(endpoint, /replaceQueuedOrderPayment/);
  assert.match(endpoint, /updateWooOrderPayment/);
  assert.match(endpoint, /\["CANCELED",\s*"TIMEOUTED",\s*"FAILED"\]/);
  assert.match(endpoint, /\["PAID",\s*"AUTHORIZED"\]/);
});

test("opakovať GoPay vytvorí novú platbu k pôvodnej objednávke", async () => {
  const confirmation = await read("src/pages/platba-dokoncena.astro");
  const retryApi = await read("src/pages/api/gopay-retry.ts");
  assert.match(confirmation, /fetch\('\/api\/gopay-retry'/);
  assert.match(confirmation, /paymentId:String\(data\.paymentId/);
  assert.match(retryApi, /order_number:\s*clean\(pending\.orderNumber\)/);
  assert.match(retryApi, /verifyGoPayPaymentAgainstOrder/);
  assert.match(retryApi, /\["PAID",\s*"AUTHORIZED"\]/);
  assert.match(retryApi, /\["CANCELED",\s*"TIMEOUTED",\s*"FAILED"\]/);
});

test("poznámka o GoPay sa zobrazuje iba pri online platbe", async () => {
  const checkout = await read("src/scripts/checkout.js");
  const page = await read("src/pages/pokladna.astro");
  assert.match(page, /data-secure-payment-note/);
  assert.match(checkout, /Bezpečné odoslanie objednávky/);
  assert.match(checkout, /Bezpečná online platba cez GoPay/);
});

test("dlhé číselné SKU sa nezhoduje iba prefixom", async () => {
  const search = await read("src/pages/api/smart-search.ts");
  assert.match(search, /strictNumeric\s*=\s*\/\^\\d\{5,\}\$\//);
  assert.match(search, /strictNumeric\s*&&\s*\/\^\\d\+\$\/\.test\(tokenCompact\)/);
  assert.match(search, /modelTokenScore\(token, item\.compact, item\.tokens\)\s*>=\s*46/);
});
