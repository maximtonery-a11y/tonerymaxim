import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";

const dataRoot = await mkdtemp(join(tmpdir(), "tm-checkout-hard-"));
process.env.TM_PERSISTENT_DATA_DIR = dataRoot;
process.env.TM_PERSISTENCE_SECRET = "hard-regression-secret-with-more-than-32-characters";

const { withCheckoutSubmission } = await import("../src/lib/checkout-submission.ts");

function okResponse(orderNumber = "300999") {
  return Response.json({ ok: true, orderId: 999, orderNumber });
}

test("dve súbežné rovnaké odoslania vykonajú side-effect iba raz", async () => {
  let runs = 0;
  const work = async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 60));
    return okResponse();
  };
  const body = { requestId: "parallel-same", payment: "cod", cart: [{ sku: "X", qty: 1 }] };
  const [first, second] = await Promise.all([
    withCheckoutSubmission(body.requestId, "order", body, work),
    withCheckoutSubmission(body.requestId, "order", body, work),
  ]);
  assert.equal(runs, 1);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
});

test("ten istý pokus nemôže prejsť raz cez GoPay a raz cez dobierku", async () => {
  let codRuns = 0;
  const body = { requestId: "cross-payment", payment: "gopay", cart: [{ sku: "X", qty: 1 }] };
  const gopay = await withCheckoutSubmission(body.requestId, "gopay", body, async () => okResponse("301000"));
  const cod = await withCheckoutSubmission(body.requestId, "order", body, async () => {
    codRuns += 1;
    return okResponse("301001");
  });
  assert.equal(gopay.status, 200);
  assert.equal(cod.status, 409);
  assert.equal(codRuns, 0);
});

test("rovnaké requestId s pozmenenými údajmi sa odmietne", async () => {
  const firstBody = { requestId: "changed-body", payment: "cod", total: 10 };
  const secondBody = { ...firstBody, total: 99 };
  await withCheckoutSubmission(firstBody.requestId, "order", firstBody, async () => okResponse());
  let rerun = false;
  const response = await withCheckoutSubmission(secondBody.requestId, "order", secondBody, async () => {
    rerun = true;
    return okResponse();
  });
  assert.equal(response.status, 409);
  assert.equal(rerun, false);
});

test("stará neistá checkout zámka po páde procesu zlyhá bezpečne", async () => {
  const id = "stale-crash";
  const lock = join(dataRoot, "order-idempotency", "locks", `checkout-submit-${id}`);
  await mkdir(lock, { recursive: true });
  const old = new Date(Date.now() - 120_000);
  await utimes(lock, old, old);
  let rerun = false;
  const response = await withCheckoutSubmission(id, "order", { requestId: id }, async () => {
    rerun = true;
    return okResponse();
  });
  assert.equal(response.status, 409);
  assert.equal(rerun, false);
});

test("GoPay CREATED nespotrebuje 5 % kupón ani nevydá 7 % odmenu", async () => {
  const source = await readFile(new URL("../src/lib/checkout-order.ts", import.meta.url), "utf8");
  assert.match(source, /finalizeCheckoutBenefits[\s\S]*canClaimPaperReward/);
  assert.match(source, /paymentState:\s*String\(payment\.state\s*\|\|\s*"PAID"\)[\s\S]*finalizeCheckoutBenefits/);
});

test("nová Woo objednávka obsahuje východiskový marker stavového e-mailu", async () => {
  const source = await readFile(new URL("../src/lib/checkout-order.ts", import.meta.url), "utf8");
  assert.match(source, /_tm_email_queue_observed_status["']?,\s*value:\s*payment\.status/);
});

test("middleware spúšťa stavové e-maily, ale nie počas healthchecku alebo migrácie", async () => {
  const source = await readFile(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.match(source, /ensureEmailQueueStarted/);
  assert.match(source, /TM_DISABLE_BACKGROUND_WORKERS\s*!==\s*'1'/);
  assert.match(source, /\/api\/health/);
});

test("počas odosielania sú zamknuté tlačidlá, doprava aj platba", async () => {
  const source = await readFile(new URL("../src/scripts/checkout.js", import.meta.url), "utf8");
  assert.match(source, /\[name="shipping"\], \[name="payment"\]/);
  assert.match(source, /control\.disabled = disabled/);
});

test("GoPay ochrana zostáva aktívna až do potvrdenej platby", async () => {
  const checkout = await readFile(new URL("../src/scripts/checkout.js", import.meta.url), "utf8");
  const confirmation = await readFile(new URL("../src/pages/platba-dokoncena.astro", import.meta.url), "utf8");
  assert.doesNotMatch(checkout, /sessionStorage\.removeItem\("tm_checkout_request_id"\)[\s\S]{0,120}window\.location\.href = data\.gwUrl/);
  assert.match(checkout, /tm_submitted_gopay_v1/);
  assert.match(checkout, /Táto objednávka už bola odoslaná/);
  assert.match(confirmation, /clearCheckoutLock\(\)/);
});

test("čas vytvorenia nemení identitu opakovaného requestu", async () => {
  let runs = 0;
  const first = { requestId: "same-intent-time", createdAt: "2026-09-03T08:00:00.000Z", payment: "gopay", cart: [{ sku: "X", qty: 1 }] };
  const second = { ...first, createdAt: "2026-09-03T08:01:00.000Z" };
  const a = await withCheckoutSubmission(first.requestId, "gopay", first, async () => { runs += 1; return okResponse("301100"); });
  const b = await withCheckoutSubmission(second.requestId, "gopay", second, async () => { runs += 1; return okResponse("301101"); });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(runs, 1);
  assert.deepEqual(await a.json(), await b.json());
});
