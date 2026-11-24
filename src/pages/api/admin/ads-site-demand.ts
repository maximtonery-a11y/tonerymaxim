import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAdminAccessKey, constantTimeEqual } from "../../../lib/admin-access";
import { TM_DATA_ROOT } from "../../../lib/secure-persistence";

export const prerender = false;
const headers = { "Cache-Control": "private, no-store" };
export const GET: APIRoute = async ({ request, locals }) => {
  const key = getAdminAccessKey(locals);
  if (!key || !constantTimeEqual(key, request.headers.get("x-admin-key") || "")) {
    return Response.json({ status: "unauthorized" }, { status: 401, headers });
  }
  try {
    const snapshot = JSON.parse(await readFile(join(TM_DATA_ROOT, "ads-intelligence", "site-demand.json"), "utf8"));
    const age = Date.now() - Date.parse(snapshot.observed_at);
    if (["observed", "partial"].includes(snapshot.status) && Number.isFinite(age) && age >= 0 && age <= 120_000) {
      return Response.json(snapshot, { headers });
    }
  } catch { /* Missing or incomplete snapshots are unavailable. */ }
  return Response.json({ status: "unavailable", rows: null }, { status: 503, headers });
};
