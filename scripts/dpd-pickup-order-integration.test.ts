import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { normalizeDpdPickup } from "../src/lib/dpd-pickup.ts";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
await mkdir(join(project, ".tm-cache"), { recursive: true });
const temporary = await mkdtemp(join(project, ".tm-cache", "dpd-integration-"));
const originalFetch = globalThis.fetch;
const previousEnv = { ...process.env };
Object.assign(process.env, {
  WOO_URL: "https://woo.example.test", WOO_CONSUMER_KEY: "ck_test", WOO_CONSUMER_SECRET: "cs_test",
  TM_PERSISTENCE_SECRET: "dpd-integration-secret-with-more-than-32-characters", CHECKOUT_PROFILER: "0",
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  await rm(temporary, { recursive: true, force: true });
});

const modules: Record<string, any> = {};
const roots: Record<string, string> = { current: project };
if (process.env.TM_DPD_BASELINE_DIR) roots.baseline = resolve(process.env.TM_DPD_BASELINE_DIR);
for (const [label, root] of Object.entries(roots)) {
  const outfile = join(temporary, `${label}.mjs`);
  await build({
    stdin: { contents: `export { createWooOrderFromCheckout } from ${JSON.stringify(join(root, "src/lib/checkout-order.ts"))}; export { validateCheckoutRequest } from ${JSON.stringify(join(root, "src/lib/checkout-validation.ts"))}; ${label === "current" ? `export { ensureDpdPickupRepairStarted } from ${JSON.stringify(join(root, "src/lib/dpd-pickup-repair-worker.ts"))}; export { readSignedJson } from ${JSON.stringify(join(root, "src/lib/secure-persistence.ts"))};` : ""}`, resolveDir: project, loader: "ts" },
    bundle: true, platform: "node", format: "esm", packages: "external", target: "node22",
    outfile, define: { "import.meta.env": "{}" }, logLevel: "silent",
  });
  process.env.TM_PERSISTENT_DATA_DIR = join(temporary, `${label}-data`);
  modules[label] = await import(pathToFileURL(outfile).href);
}

test("deployment migration delays startup, repairs two pages and finishes without polling", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const jobs: Array<{ callback: () => void; delay: number }> = [];
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    jobs.push({ callback, delay }); return { unref() { return this; } };
  }) as unknown as typeof setTimeout;
  const makeOrder = (id: number): any => ({
    id, status: "processing", total: "11.12", payment_method: "gopay", billing: { city: "Senec" },
    shipping_lines: [{ id: id + 100, method_id: "dpd_box", method_title: "DPD Pickup Box – AlzaBox (Billa)", total: "2.36", total_tax: "0.54" }],
    meta_data: [
      { id: 1, key: "source", value: "tonerymaxim" }, { id: 2, key: "tm_shipping_pickup_id", value: point.id },
      { id: 3, key: "tm_shipping_pickup", value: JSON.stringify({ carrier: "DPD", pickup_id: point.id, pickup_name: point.name, pickup_country: "SK" }) },
      { id: 4, key: "gopay_state", value: "PAID" }, { id: 5, key: "_tm_email_queue_observed_status", value: "processing" },
    ],
  });
  const first = makeOrder(53320); const second = makeOrder(53321);
  const glsOrders = Array.from({ length: 24 }, (_, i) => ({ ...makeOrder(54000 + i), shipping_lines: [{ id: i + 900, method_id: "gls_pickup" }] }));
  const originals = [structuredClone(first), structuredClone(second)];
  const writes: any[] = []; const pages: number[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname === "api.dpd.cz") {
      assert.equal(url.pathname, "/api/v1/pickup-points/SK20276"); return Response.json(point);
    }
    assert.equal(url.hostname, "woo.example.test");
    if (url.pathname === "/wp-json/wc/v3/orders") {
      const page = Number(url.searchParams.get("page")); pages.push(page);
      assert.equal(url.searchParams.get("per_page"), "25"); assert.equal(url.searchParams.get("orderby"), "id");
      return Response.json(page === 1 ? [first, ...glsOrders] : [second]);
    }
    const order = url.pathname.endsWith("/53320") ? first : second;
    if (options?.method === "GET") return Response.json(order);
    assert.equal(options?.method, "PUT");
    assert.equal(new Headers(options?.headers).get("x-tonerymaxim-suppress-emails"), "1");
    const patch = JSON.parse(String(options?.body)); writes.push(patch);
    assert.deepEqual(Object.keys(patch), ["meta_data"]);
    order.meta_data = [...order.meta_data.filter((m: any) => !patch.meta_data.some((n: any) => n.key === m.key)), ...patch.meta_data];
    return Response.json(order);
  };
  const statePath = join(temporary, "current-data", "migrations", "dpd-pickup-address-v1.json");
  const waitFor = async (predicate: () => Promise<boolean> | boolean) => {
    for (let i = 0; i < 200; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => originalSetTimeout(resolve, 5));
    }
    throw new Error("Migration did not settle");
  };
  try {
    process.env.TM_DISABLE_BACKGROUND_WORKERS = "1";
    modules.current.ensureDpdPickupRepairStarted(); assert.equal(jobs.length, 0);
    process.env.TM_DISABLE_BACKGROUND_WORKERS = "0";
    modules.current.ensureDpdPickupRepairStarted(); modules.current.ensureDpdPickupRepairStarted();
    assert.equal(jobs.length, 1); assert.equal(jobs[0].delay, 120_000); assert.equal(pages.length, 0);
    jobs.shift()!.callback(); await waitFor(() => jobs.length === 1);
    assert.equal(jobs[0].delay, 5_000); assert.deepEqual(pages, [1]);
    const checkpoint = await modules.current.readSignedJson(statePath);
    assert.equal(checkpoint.page, 2); assert.equal(checkpoint.completed, false);
    jobs.shift()!.callback();
    await waitFor(async () => Boolean((await modules.current.readSignedJson(statePath))?.completed));
    assert.deepEqual(pages, [1, 2]); assert.equal(jobs.length, 0); assert.equal(writes.length, 2);
    const finished = await modules.current.readSignedJson(statePath);
    assert.equal(finished.repaired, 2); assert.equal(finished.unresolved, 0);
    for (const [index, order] of [first, second].entries()) {
      for (const key of ["status", "total", "payment_method", "billing"]) assert.deepEqual(order[key], originals[index][key]);
      assert.equal(order.shipping_lines[0].total, originals[index].shipping_lines[0].total);
      assert.equal(order.shipping_lines[0].total_tax, originals[index].shipping_lines[0].total_tax);
      assert.deepEqual(order.shipping_lines, originals[index].shipping_lines);
      const values = Object.fromEntries(order.meta_data.map((m: any) => [m.key, m.value]));
      assert.equal(values.gopay_state, "PAID"); assert.equal(values._tm_email_queue_observed_status, "processing");
      assert.equal(values.tm_shipping_pickup_street, "SVÄTOPLUKOVA 1A");
    }
    assert(glsOrders.every((o: any) => !o.meta_data.some((m: any) => m.key === "tm_shipping_pickup_street")));
  } finally { globalThis.setTimeout = originalSetTimeout; }
});

const point = {
  id: "SK20276", name: "AlzaBox (Billa)", type: "locker",
  location: { address: { street: "SVÄTOPLUKOVA 1A", city: "SENEC", zip: "903 01", country: "SK", propertyNumber: "1A" } },
  pickupPointResult: "SK20276, SVÄTOPLUKOVA 1A, 903 01 SENEC SK",
};
const gls = { carrier: "GLS", delivery_type: "pickup", pickup_id: "1607", pickup_name: "Bio-obchodík.sk", pickup_address: "Krížna 21", pickup_city: "Bratislava", pickup_zip: "81107", pickup_country: "SK" };

async function mapSelection(label: string, shippingCode: string, widgetPoint: unknown) {
  if (label === "current") return normalizeDpdPickup(widgetPoint, shippingCode);
  const script = await readFile(join(roots[label], "src/scripts/checkout.js"), "utf8");
  const start = script.indexOf("  function normalizeDpdPickup(widgetData)");
  const end = script.indexOf("  function normalizeGlsPickup", start);
  assert(start >= 0 && end > start);
  return runInNewContext(`(${script.slice(start, end).trim()})`, { getSelected: () => shippingCode })(widgetPoint);
}

async function captureOrder(label: string, shippingCode: string, paymentCode: string) {
  const isDpdPickup = ["dpd_box", "dpd_pickup"].includes(shippingCode);
  const widgetPoint = shippingCode === "dpd_pickup" ? { ...point, name: "Test výdajné miesto", type: "parcelshop" } : point;
  const pickup = isDpdPickup ? await mapSelection(label, shippingCode, widgetPoint) : shippingCode === "gls_pickup" ? gls : null;
  const validated = modules[label].validateCheckoutRequest({
    termsAccepted: true, contact: { email: "test@example.sk", phone: "+421900123456" },
    billing: { firstName: "Ján", lastName: "Novák", address: "Hlavná 1", city: "Banská Bystrica", zip: "97401" },
    delivery: { differentAddress: false }, shipping: { method: shippingCode, pickup }, payment: paymentCode,
  }, new Set([paymentCode]));
  let payload: any;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "woo.example.test", "No external service is called by this integration test");
    assert.equal(new Headers(options?.headers).get("authorization"), `Basic ${Buffer.from("ck_test:cs_test").toString("base64")}`);
    if (url.pathname === "/wp-json/wc/v3/orders" && options?.method === "POST") {
      payload = JSON.parse(String(options.body));
      assert.equal(new Headers(options.headers).get("x-tonerymaxim-suppress-emails"), "1");
      return Response.json({ ...payload, id: 70001, number: "300001" });
    }
    if (url.pathname === "/wp-json/wc/v3/orders" && options?.method === "GET") return Response.json([]);
    if (url.pathname === "/wp-json/wc/v3/taxes") return Response.json([{ id: 1, rate: "23", country: "SK", class: "" }]);
    throw new Error(`Unexpected mock request: ${options?.method} ${url.pathname}`);
  };
  const paymentPrice = paymentCode === "cod" ? 1.2 : 0;
  const result = await modules[label].createWooOrderFromCheckout({
    ...validated, orderNumber: `test-${shippingCode}-${paymentCode}`, currency: "EUR",
    cart: [{ id: "123", productId: 123, sku: "TEST-123", name: "Test kompatibilný toner", price: 10, qty: 2, product_type_key: "compatible" }],
    shippingCode, shippingLabel: shippingCode, shippingPrice: 2.9, paymentCode, paymentLabel: paymentCode, paymentPrice,
    originalSubtotal: 20, quantityDiscount: 2, subtotal: 18, total: 20.9 + paymentPrice,
    createdAt: "2026-10-12T08:00:00.000Z", termsAcceptedAt: "2026-10-12T08:00:00.000Z",
    paymentState: paymentCode === "gopay" ? "CREATED" : "", customerId: 0,
  }, { sendConfirmationEmail: false });
  assert.equal(result.created, true); assert(payload);
  return payload;
}

function withoutPickupChanges(payload: any) {
  const copy = structuredClone(payload);
  const pickupMeta = (key: string) => key.startsWith("tm_shipping_pickup") || key === "tm_shipping_carrier" || key === "dpd_pickup_address";
  copy.meta_data = copy.meta_data.filter((m: any) => !pickupMeta(m.key)).map((m: any) => {
    if (m.key !== "tm_order_snapshot") return m;
    const snapshot = JSON.parse(m.value); snapshot.delivery.pickup = null;
    return { ...m, value: JSON.stringify(snapshot) };
  });
  copy.shipping_lines = copy.shipping_lines.map((line: any) => ({
    ...line, method_title: line.method_title.split(" – ")[0], meta_data: line.meta_data.filter((m: any) => !pickupMeta(m.key)),
  }));
  return copy;
}

for (const shipping of ["dpd_box", "dpd_pickup", "gls_pickup", "dpd_courier", "gls_courier"]) {
  for (const payment of ["cod", "gopay"]) {
    test(`map → validation → Woo order: ${shipping}, ${payment}`, async () => {
      const current = await captureOrder("current", shipping, payment);
      const meta = Object.fromEntries(current.meta_data.map((m: any) => [m.key, m.value]));
      const isDpdPickup = ["dpd_box", "dpd_pickup"].includes(shipping);
      if (isDpdPickup) {
        assert.equal(meta.tm_shipping_pickup_street, "SVÄTOPLUKOVA 1A"); assert.equal(meta.tm_shipping_pickup_city, "SENEC");
        assert.equal(meta.tm_shipping_pickup_postcode, "90301"); assert.equal(meta.tm_shipping_pickup_id, "SK20276");
        assert.match(current.shipping_lines[0].method_title, /SVÄTOPLUKOVA 1A, 90301 SENEC/);
        assert.equal(JSON.parse(meta.tm_order_snapshot).delivery.pickup.pickup_address, "SVÄTOPLUKOVA 1A");
      }
      if (modules.baseline) {
        const baseline = await captureOrder("baseline", shipping, payment);
        if (isDpdPickup) {
          const before = Object.fromEntries(baseline.meta_data.map((m: any) => [m.key, m.value]));
          assert.equal(JSON.parse(before.tm_shipping_pickup).pickup_address, "", "The reported bug must reproduce in the original version");
          assert.equal(before.tm_shipping_pickup_id, meta.tm_shipping_pickup_id);
          assert.deepEqual(withoutPickupChanges(current), withoutPickupChanges(baseline), "Prices, taxes, payments, discounts, items and customer data remain identical");
        } else assert.deepEqual(current, baseline, "GLS and courier payloads must remain identical");
      }
    });
  }
}
