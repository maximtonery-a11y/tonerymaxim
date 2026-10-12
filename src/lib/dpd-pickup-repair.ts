import { normalizeDpdPickup } from "./dpd-pickup.ts";

type Meta = { id?: number; key?: string; value?: any };
type ShippingLine = { id?: number; method_id?: string; method_title?: string; meta_data?: Meta[] };
export type PickupRepairOrder = { id: number; meta_data?: Meta[]; shipping_lines?: ShippingLine[] };

function meta(order: PickupRepairOrder, key: string): string {
  const value = order.meta_data?.find((entry) => entry.key === key)?.value;
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function decode(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const result = JSON.parse(String(value || "{}"));
    return result && typeof result === "object" && !Array.isArray(result) ? result : {};
  } catch { return {}; }
}

function comparable(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function dpdPickupRepairCandidate(order: PickupRepairOrder) {
  if (!["source", "sales_channel", "created_via", "_tm_source", "tm_source"].some((key) => meta(order, key).toLowerCase().includes("tonerymaxim"))) return null;
  const lines = order.shipping_lines || [];
  if (lines.length !== 1 || !["dpd_pickup", "dpd_box"].includes(lines[0].method_id || "") || !lines[0].id) return null;
  const shippingCode = lines[0].method_id!;
  if (meta(order, "tm_shipping_code") && meta(order, "tm_shipping_code") !== shippingCode) return null;
  const raw = decode(order.meta_data?.find((entry) => entry.key === "tm_shipping_pickup")?.value);
  if (raw.carrier && String(raw.carrier).toUpperCase() !== "DPD") return null;
  const p = normalizeDpdPickup(raw, shippingCode);
  const id = meta(order, "tm_shipping_pickup_id") || p.pickup_id || meta(order, "dpd_pickup_id") || meta(order, "dpd_parcelshop_id") || meta(order, "dpd_pudo_id");
  if (!/^SK[A-Z0-9-]+$/i.test(id) || (p.pickup_id && id !== p.pickup_id)) return null;
  const name = meta(order, "tm_shipping_pickup_name") || p.pickup_name;
  const street = meta(order, "tm_shipping_pickup_street") || p.pickup_address;
  const city = meta(order, "tm_shipping_pickup_city") || p.pickup_city;
  const zip = (meta(order, "tm_shipping_pickup_postcode") || p.pickup_zip).replace(/\s/g, "");
  if (street && city && /^\d{5}$/.test(zip)) return null;
  return { id, name, street, city, zip, raw, shippingCode, line: lines[0] };
}

/** Metadata-only PUT: shipping_lines would cause Woo to recalculate prices and taxes. */
export function dpdPickupRepairPatch(order: PickupRepairOrder, point: unknown) {
  const candidate = dpdPickupRepairCandidate(order);
  if (!candidate) return null;
  const p = normalizeDpdPickup(point, candidate.shippingCode);
  const zip = p.pickup_zip.replace(/\s/g, "");
  if (p.pickup_id !== candidate.id || p.pickup_country !== "SK" || !p.pickup_address || !p.pickup_city || !/^\d{5}$/.test(zip)) return null;
  if (candidate.name !== "DPD Pickup miesto" && comparable(candidate.name) !== comparable(p.pickup_name)) return null;
  if ((candidate.street && comparable(candidate.street) !== comparable(p.pickup_address))
    || (candidate.city && comparable(candidate.city) !== comparable(p.pickup_city))
    || (candidate.zip && candidate.zip !== zip)) return null;

  const pickup = {
    ...candidate.raw,
    carrier: "DPD",
    delivery_type: candidate.raw.delivery_type || p.delivery_type,
    pickup_id: candidate.id,
    pickup_name: candidate.name === "DPD Pickup miesto" ? p.pickup_name : candidate.name,
    pickup_address: candidate.street || p.pickup_address,
    pickup_city: candidate.city || p.pickup_city,
    pickup_zip: candidate.zip || zip,
    pickup_country: "SK",
  };
  const label = [pickup.pickup_name, pickup.pickup_address, `${pickup.pickup_zip} ${pickup.pickup_city}`].join(", ");
  const values: Record<string, string> = {
    tm_shipping_pickup: JSON.stringify(pickup),
    tm_shipping_pickup_id: pickup.pickup_id,
    tm_shipping_pickup_name: pickup.pickup_name,
    tm_shipping_pickup_street: pickup.pickup_address,
    tm_shipping_pickup_city: pickup.pickup_city,
    tm_shipping_pickup_postcode: pickup.pickup_zip,
    tm_shipping_pickup_country: pickup.pickup_country,
    tm_shipping_carrier: "DPD",
    tm_shipping_pickup_type: pickup.delivery_type,
    tm_shipping_pickup_text: label,
  };
  const updates = (entries: Meta[] | undefined, fields: Record<string, string>) => Object.entries(fields).map(([key, value]) => {
    const id = entries?.find((entry) => entry.key === key)?.id;
    return { ...(id ? { id } : {}), key, value };
  });
  return {
    meta_data: updates(order.meta_data, values),
  };
}

export type PickupRepairIO = {
  lookupPoint: (id: string) => Promise<unknown>;
  readOrder: (id: number) => Promise<PickupRepairOrder>;
  updateOrder: (id: number, patch: NonNullable<ReturnType<typeof dpdPickupRepairPatch>>) => Promise<unknown>;
};

export async function repairDpdPickupOrder(order: PickupRepairOrder, io: PickupRepairIO) {
  const candidate = dpdPickupRepairCandidate(order);
  if (!candidate) return "unchanged";
  const point = await io.lookupPoint(candidate.id);
  if (!dpdPickupRepairPatch(order, point)) return "unresolved";
  // Re-read immediately before writing: an administrator may have corrected it.
  const fresh = await io.readOrder(order.id);
  const patch = dpdPickupRepairPatch(fresh, point);
  if (!patch) return "unchanged";
  await io.updateOrder(order.id, patch);
  return "repaired";
}
