import { join } from "node:path";
import { readSignedJson, writeSignedJson, TM_DATA_ROOT } from "./secure-persistence";
import { wooRequest } from "./woo-client";
import { repairDpdPickupOrder, type PickupRepairOrder } from "./dpd-pickup-repair.ts";

const STATE_PATH = join(TM_DATA_ROOT, "migrations", "dpd-pickup-address-v1.json");
type State = { page: number; before: string; completed: boolean; repaired: number; unresolved: number };
let started = false;

async function lookupPoint(id: string) {
  const response = await fetch(`https://api.dpd.cz/api/v1/pickup-points/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`DPD pickup lookup failed (${response.status})`);
  return response.json();
}

/** A finite, resumable migration; one small page at a time, outside request handling. */
export function ensureDpdPickupRepairStarted(): void {
  if (started || process.env.TM_DISABLE_BACKGROUND_WORKERS === "1") return;
  const env = (key: string) => String(process.env[key] || (import.meta as any).env?.[key] || "").trim();
  if (!["WOO_URL", "WOO_CONSUMER_KEY", "WOO_CONSUMER_SECRET"].every((key) => env(key))) return;
  started = true;

  const schedule = (delay: number) => setTimeout(() => { void tick(); }, delay).unref();
  async function tick() {
    try {
      const state = await readSignedJson<State>(STATE_PATH) || {
        // Woo's date filter uses the store timezone; include today's orders in any timezone.
        page: 1, before: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19), completed: false, repaired: 0, unresolved: 0,
      };
      if (state.completed || process.env.TM_DISABLE_BACKGROUND_WORKERS === "1") return;
      const orders = await wooRequest<PickupRepairOrder[]>("/orders", { query: {
        after: "2026-06-01T00:00:00", before: state.before,
        per_page: 25, page: state.page, orderby: "id", order: "asc",
        _fields: "id,meta_data,shipping_lines",
      } });
      if (!Array.isArray(orders)) throw new Error("Invalid Woo order response for DPD migration");
      for (const order of orders) {
        const result = await repairDpdPickupOrder(order, {
          lookupPoint,
          readOrder: (id) => wooRequest<PickupRepairOrder>(`/orders/${id}`),
          updateOrder: (id, body) => wooRequest(`/orders/${id}`, { method: "PUT", body }),
        });
        if (result === "repaired") state.repaired += 1;
        if (result === "unresolved") {
          state.unresolved += 1;
          console.warn("[TM DPD address] could not verify pickup for order", order.id);
        }
      }
      state.page += 1;
      state.completed = orders.length < 25;
      await writeSignedJson(STATE_PATH, state);
      if (state.completed) console.info("[TM DPD address] migration complete", { repaired: state.repaired, unresolved: state.unresolved });
      else schedule(5_000);
    } catch (error) {
      console.error("[TM DPD address] migration paused", error instanceof Error ? error.message : error);
      schedule(60_000);
    }
  }
  // Keep Woo capacity available to the catalogue and checkout during startup.
  schedule(120_000);
}
