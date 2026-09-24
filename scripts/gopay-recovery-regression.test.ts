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
  assert.match(endpoint, /\["CREATED",\s*"PAYMENT_METHOD_CHOSEN",\s*"CANCELED",\s*"TIMEOUTED",\s*"FAILED"\]/);
  assert.match(endpoint, /\["PAID",\s*"AUTHORIZED"\]/);
});

test("opakovať GoPay vytvorí novú platbu k pôvodnej objednávke", async () => {
  const confirmation = await read("src/pages/platba-dokoncena.astro");
  const retryApi = await read("src/pages/api/gopay-retry.ts");
  assert.match(confirmation, /fetch\('\/api\/gopay-retry'/);
  assert.match(confirmation, /paymentId:String\(data\.paymentId/);
  assert.match(retryApi, /order_number:\s*clean\(pending\.orderNumber\)/);
  assert.match(retryApi, /verifyGoPayPaymentAgainstOrder/);
  assert.match(retryApi, /withOrderIdempotency\(`gopay-retry-/);
  assert.match(retryApi, /paymentState:\s*"RETRIED"/);
  assert.match(retryApi, /paymentState:\s*"CREATED"/);
  assert.match(retryApi, /\["PAID",\s*"AUTHORIZED"\]/);
  assert.match(retryApi, /\["CREATED",\s*"PAYMENT_METHOD_CHOSEN"\]/);
  assert.match(retryApi, /gwUrl:\s*existingGatewayUrl/);
  assert.match(retryApi, /reused:\s*true/);
  assert.match(retryApi, /\["CANCELED",\s*"TIMEOUTED",\s*"FAILED"\]/);
});

test("nedokončená GoPay platba vždy ponúkne opakovanie aj zmenu platby", async () => {
  const confirmation = await read("src/pages/platba-dokoncena.astro");
  assert.match(confirmation, /data-gopay-change/);
  assert.match(confirmation, /Zmeniť spôsob platby/);
  assert.match(confirmation, /\['CREATED','PAYMENT_METHOD_CHOSEN'\]\.includes\(state\)[\s\S]*showRecoveryActions\(\)/);
});

test("zmena na dobierku overí GoPay a upraví pôvodnú objednávku", async () => {
  const changeApi = await read("src/pages/api/gopay-change-payment.ts");
  assert.match(changeApi, /verifyGoPayPaymentAgainstOrder/);
  assert.match(changeApi, /\["PAID",\s*"AUTHORIZED"\]\.includes\(state\)/);
  assert.match(changeApi, /originalGoPayAmountCents/);
  assert.match(changeApi, /replaceQueuedOrderPayment/);
  assert.match(changeApi, /updateWooOrderPayment/);
});

test("po zmene platby sa zákazníkovi vždy vráti číslo ToneryMAXIM, nie interné Woo ID", async () => {
  const changeApi = await read("src/pages/api/gopay-change-payment.ts");
  assert.match(changeApi, /orderNumber:\s*pending\.orderNumber/);
  assert.match(changeApi, /const orderNumber\s*=\s*updatedSource\.orderNumber/);
  assert.doesNotMatch(changeApi, /orderNumber:\s*pending\.wooOrderNumber\s*\|\|\s*pending\.orderNumber/);
  assert.doesNotMatch(changeApi, /orderNumber\s*=\s*woo\.orderNumber\s*\|\|\s*orderNumber/);
});

test("stavový e-mail po zmene platby používa aktualizovanú platbu, poplatok a celkovú sumu", async () => {
  const checkoutOrder = await read("src/lib/checkout-order.ts");
  const emailQueue = await read("src/lib/email-queue.ts");
  assert.match(checkoutOrder, /function orderSnapshot\(/);
  assert.match(checkoutOrder, /tm_order_snapshot[\s\S]*orderSnapshot\(source, payment\.title\)/);
  assert.match(checkoutOrder, /tm_payment_amount_cents[\s\S]*source\.amountCents/);
  assert.match(checkoutOrder, /tm_order_total_gross[\s\S]*source\.total/);
  assert.match(emailQueue, /snapshot\?\.paymentLabel\s*\|\|\s*order\.payment_method_title/);
  assert.match(emailQueue, /snapshot\?\.total\s*\?\?\s*order\.total/);
  assert.match(emailQueue, /snapshot\?\.paymentPrice\s*\?\?\s*0/);
});

test("oneskorená GoPay notifikácia po zmene platby nevytvorí druhú objednávku", async () => {
  const checkoutOrder = await read("src/lib/checkout-order.ts");
  const statusApi = await read("src/pages/api/gopay-status.ts");
  const notifyApi = await read("src/pages/api/gopay-notify.ts");
  assert.match(statusApi, /pending\.originalGoPayAmountCents\s*\|\|\s*pending\.amountCents/);
  assert.match(notifyApi, /pending\.originalGoPayAmountCents\s*\|\|\s*pending\.amountCents/);
  assert.match(checkoutOrder, /CONVERTED_TO_OFFLINE[\s\S]*lastGoPayState/);
  assert.match(checkoutOrder, /convertedFromOffline[\s\S]*payment_method:\s*"gopay"/);
  assert.match(checkoutOrder, /convertedFeeLines[\s\S]*total:\s*"0\.00"/);
});

test("stará GoPay poistka v prehliadači po 24 hodinách neblokuje novú objednávku", async () => {
  const checkout = await read("src/scripts/checkout.js");
  assert.match(checkout, /SUBMITTED_GOPAY_MAX_AGE_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(checkout, /Date\.now\(\)\s*-\s*submittedAt\s*>\s*SUBMITTED_GOPAY_MAX_AGE_MS/);
  assert.match(checkout, /localStorage\.removeItem\(SUBMITTED_GOPAY_KEY\)/);
});

test("zaplatený opakovaný pokus označí už existujúcu Woo objednávku ako zaplatenú", async () => {
  const checkoutOrder = await read("src/lib/checkout-order.ts");
  assert.match(checkoutOrder, /if\s*\(!result\.created\s*&&\s*result\.orderId\s*>\s*0\)/);
  assert.match(checkoutOrder, /markWooGoPayOrderPaid\(updated,\s*payment\)/);
});

test("po zmene na offline platbu sa GoPay nedá znova aktivovať", async () => {
  const retryApi = await read("src/pages/api/gopay-retry.ts");
  const changeApi = await read("src/pages/api/gopay-change-payment.ts");
  assert.match(retryApi, /storedState\s*===\s*"CONVERTED_TO_OFFLINE"/);
  assert.match(changeApi, /storedState\s*===\s*"RETRIED"/);
  assert.match(changeApi, /storedState\s*===\s*"CONVERTED_TO_OFFLINE"/);
});

test("neistá zámka po páde procesu nesmie zopakovať externý GoPay alebo Woo zásah", async () => {
  const idempotency = await read("src/lib/order-idempotency.ts");
  assert.match(idempotency, /id\.startsWith\('gopay-retry-'\)/);
  assert.match(idempotency, /id\.startsWith\('gopay-change-'\)/);
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
