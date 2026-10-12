import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDpdPickup } from "../src/lib/dpd-pickup.ts";
import { validateCheckoutRequest } from "../src/lib/checkout-validation.ts";
import { dpdPickupRepairCandidate, dpdPickupRepairPatch, repairDpdPickupOrder, type PickupRepairOrder } from "../src/lib/dpd-pickup-repair.ts";

// Public DPD response for the exact pickup ID in the reported screenshot.
const box = {
  id: "SK20276", name: "AlzaBox (Billa)", type: "locker",
  location: {
    address: { street: "SVÄTOPLUKOVA 1A", zip: "903 01", city: "SENEC", country: "SK", propertyNumber: "1A" },
    coordinates: { latitude: 48.217297, longitude: 17.393026 },
  },
  paymentOptions: { codAllowed: true },
  pickupPointResult: "SK20276, SVÄTOPLUKOVA 1A, 903 01 SENEC SK",
};
const expectedAddress = { pickup_address: "SVÄTOPLUKOVA 1A", pickup_city: "SENEC", pickup_zip: "903 01", pickup_country: "SK" };

function checkout(pickup: unknown, method = "dpd_box", payment = "cod") {
  return {
    termsAccepted: true,
    contact: { email: "test@example.sk", phone: "+421900123456" },
    billing: { firstName: "Ján", lastName: "Novák", address: "Hlavná 1", city: "Banská Bystrica", zip: "97401" },
    delivery: { differentAddress: false }, shipping: { method, pickup }, payment,
  };
}

function oldOrder(method = "dpd_box"): PickupRepairOrder {
  return {
    id: 53320,
    shipping_lines: [{ id: 123, method_id: method, method_title: "DPD Pickup Box – AlzaBox (Billa)" }],
    meta_data: [
      { id: 1, key: "source", value: "tonerymaxim" },
      { id: 2, key: "tm_shipping_code", value: method },
      { id: 3, key: "tm_shipping_pickup_id", value: "SK20276" },
      { id: 4, key: "tm_shipping_pickup", value: JSON.stringify({ carrier: "DPD", delivery_type: "box", pickup_id: "SK20276", pickup_name: "AlzaBox (Billa)", pickup_address: "", pickup_city: "", pickup_zip: "", pickup_country: "SK" }) },
      { id: 5, key: "gopay_state", value: "PAID" },
      { id: 6, key: "tm_order_total_gross", value: "11.12" },
      { id: 7, key: "_tm_email_queue_observed_status", value: "processing" },
    ],
  };
}

for (const [label, value] of [
  ["direct widget", box], ["message wrapper", { dpdWidget: box }],
  ["pickupPoint wrapper", { pickupPoint: box }], ["parcelShop wrapper", { parcelShop: box }],
  ["address object", { ...box, location: undefined, address: box.location.address }],
] as const) {
  test(`DPD current schema: ${label}`, () => {
    const p = normalizeDpdPickup(value, "dpd_box");
    for (const [key, expected] of Object.entries(expectedAddress)) assert.equal(p[key as keyof typeof p], expected);
    assert.equal(p.pickup_id, "SK20276");
    assert.equal(p.pickup_name, "AlzaBox (Billa)");
    assert.equal(p.delivery_type, "box");
    assert.doesNotMatch(p.pickup_address, /\[object Object\]|1A 1A/);
  });
}

test("DPD map supplies nested coordinates and COD flag", () => {
  const p = normalizeDpdPickup(box);
  assert.equal(p.pickup_lat, "48.217297"); assert.equal(p.pickup_lng, "17.393026"); assert.equal(p.cod_allowed, true);
});

test("flat older DPD schema preserves house number and pickup type", () => {
  const p = normalizeDpdPickup({ id: "SK12345", name: "Test výdajňa", street: "Hlavná", houseno: "12", city: "Zvolen", zipCode: "96001", countryCode: "sk", type: "parcelshop" });
  assert.equal(p.pickup_address, "Hlavná 12"); assert.equal(p.delivery_type, "pickup"); assert.equal(p.pickup_country, "SK");
});

test("previous checkout selection recovers address from official result string", () => {
  const p = normalizeDpdPickup({ carrier: "DPD", pickup_id: box.id, pickup_name: box.name, pickup_address: "", pickup_city: "", pickup_zip: "", raw_result: box.pickupPointResult });
  for (const [key, expected] of Object.entries(expectedAddress)) assert.equal(p[key as keyof typeof p], expected);
});

test("previous checkout selection recovers nested raw JSON", () => {
  const p = normalizeDpdPickup({ carrier: "DPD", pickup_id: box.id, pickup_name: box.name, raw_result: JSON.stringify(box) });
  assert.equal(p.pickup_address, box.location.address.street); assert.equal(p.pickup_city, "SENEC");
});

test("existing normalized fields remain authoritative", () => {
  const p = normalizeDpdPickup({ ...normalizeDpdPickup(box), pickup_address: "Ručne upravená 7" });
  assert.equal(p.pickup_address, "Ručne upravená 7");
});

test("close or malformed widget events never become an invented pickup ID", () => {
  assert.equal(normalizeDpdPickup({ message: "widgetClose" }).pickup_id, "");
  assert.equal(normalizeDpdPickup({ pickupPointResult: "invalid" }).pickup_id, "");
});

for (const method of ["dpd_box", "dpd_pickup"]) {
  for (const payment of ["cod", "gopay", "bank_prepaid"]) {
    test(`checkout validation retains full DPD address: ${method}, ${payment}`, () => {
      const p = validateCheckoutRequest(checkout(box, method, payment), new Set([payment])).pickup!;
      assert.equal(p.pickup_address, box.location.address.street); assert.equal(p.pickup_city, "SENEC");
      assert.equal(p.pickup_zip, "90301"); assert.equal(p.pickup_id, "SK20276"); assert.equal(p.raw_result, box.pickupPointResult);
    });
  }
}

test("GLS validation and courier delivery remain unchanged", () => {
  const gls = { carrier: "GLS", delivery_type: "pickup", pickup_id: "1607", pickup_name: "Bio-obchodík.sk", pickup_address: "Krížna 21", pickup_city: "Bratislava", pickup_zip: "81107", pickup_country: "SK" };
  assert.deepEqual(validateCheckoutRequest(checkout(gls, "gls_pickup"), new Set(["cod"])).pickup, gls);
  const courier = checkout(null, "dpd_courier");
  courier.delivery = { differentAddress: false };
  assert.equal(validateCheckoutRequest(courier, new Set(["cod"])).pickup, null);
});

test("wrong carrier is still rejected", () => {
  assert.throws(() => validateCheckoutRequest(checkout({ carrier: "GLS", pickup_id: "123", pickup_name: "GLS" }), new Set(["cod"])), /dopravcovi/);
});

test("historical screenshot order receives only pickup metadata, avoiding Woo recalculation", () => {
  const order = oldOrder();
  const untouched = structuredClone(order);
  const patch = dpdPickupRepairPatch(order, box)!;
  assert(patch);
  const values = Object.fromEntries(patch.meta_data.map((m) => [m.key, m.value]));
  assert.equal(values.tm_shipping_pickup_street, "SVÄTOPLUKOVA 1A"); assert.equal(values.tm_shipping_pickup_city, "SENEC");
  assert.equal(values.tm_shipping_pickup_postcode, "90301");
  assert.match(values.tm_shipping_pickup_text, /SVÄTOPLUKOVA 1A, 90301 SENEC/);
  assert.deepEqual(Object.keys(patch), ["meta_data"]);
  assert.equal("shipping_lines" in patch, false);
  assert(patch.meta_data.every((m) => /^tm_shipping_/.test(m.key)));
  assert.equal(patch.meta_data.find((m) => m.key === "tm_shipping_pickup")?.id, 4);
  assert.deepEqual(order, untouched);
});

test("completed address is never replaced and migration is idempotent", () => {
  const order = oldOrder();
  const patch = dpdPickupRepairPatch(order, box)!;
  order.meta_data = [...order.meta_data!.filter((m) => !patch.meta_data.some((n) => n.key === m.key)), ...patch.meta_data];
  assert.equal(dpdPickupRepairCandidate(order), null); assert.equal(dpdPickupRepairPatch(order, box), null);
});

test("non-TM, GLS, courier, conflicting or mismatched points cannot be repaired", () => {
  const nonTm = oldOrder(); nonTm.meta_data![0].value = "coloriq";
  for (const order of [nonTm, oldOrder("gls_pickup"), oldOrder("dpd_courier")]) assert.equal(dpdPickupRepairCandidate(order), null);
  assert.equal(dpdPickupRepairPatch(oldOrder(), { ...box, id: "SK99999" }), null);
  assert.equal(dpdPickupRepairPatch(oldOrder(), { ...box, name: "Iný box" }), null);
  assert.equal(dpdPickupRepairPatch(oldOrder(), { ...box, location: { address: { ...box.location.address, country: "CZ" } } }), null);
  const partial = oldOrder(); partial.meta_data!.push({ key: "tm_shipping_pickup_street", value: "Iná ulica 12" });
  assert.equal(dpdPickupRepairPatch(partial, box), null);
});

test("repair re-reads before writing and preserves administrative corrections", async () => {
  const order = oldOrder(); const patch = dpdPickupRepairPatch(order, box)!;
  const fresh = structuredClone(order);
  // Simulate Woo's updated value rather than duplicate meta entries.
  fresh.meta_data = [...patch.meta_data, ...order.meta_data!.filter((m) => !patch.meta_data.some((n) => n.key === m.key))];
  let writes = 0;
  const result = await repairDpdPickupOrder(order, { lookupPoint: async () => box, readOrder: async () => fresh, updateOrder: async () => { writes++; } });
  assert.equal(result, "unchanged"); assert.equal(writes, 0);
});

test("repair writes exactly once and never sends status or payment changes", async () => {
  const order = oldOrder(); const writes: any[] = [];
  const result = await repairDpdPickupOrder(order, { lookupPoint: async () => box, readOrder: async () => order, updateOrder: async (id, patch) => { writes.push({ id, patch }); } });
  assert.equal(result, "repaired"); assert.equal(writes.length, 1); assert.equal(writes[0].id, 53320);
  assert.equal("status" in writes[0].patch, false); assert.equal("payment_method" in writes[0].patch, false);
  assert.equal("line_items" in writes[0].patch, false); assert.equal("billing" in writes[0].patch, false);
});

test("failed lookup makes no Woo writes", async () => {
  let writes = 0;
  const io = { lookupPoint: async () => { throw new Error("DPD unavailable"); }, readOrder: async () => oldOrder(), updateOrder: async () => { writes++; } };
  await assert.rejects(repairDpdPickupOrder(oldOrder(), io), /DPD unavailable/); assert.equal(writes, 0);
});
