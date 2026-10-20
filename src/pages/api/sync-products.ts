import type { APIRoute } from "astro";
import { jsonResponse, syncProductsCache } from "../../lib/tm-products-cache";
import { validateSyncAccess } from "../../lib/sync-access.ts";

export const prerender = false;

function env(name: string) {
  return String(process.env[name] || (import.meta as any).env?.[name] || "").trim();
}

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const secret = env("SYNC_SECRET");
    const access = validateSyncAccess(url, request, secret);
    if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status, "no-store");

    const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
    const startedAt = Date.now();
    const result = await syncProductsCache({ force });

    return jsonResponse(
      {
        ok: true,
        mode: "protected",
        refreshed: result.refreshed,
        warning: (result as any).warning || "",
        total: result.cache.total,
        generated_at: result.cache.generated_at,
        indexnow: result.indexNow || { status: "skipped", attempted: 0, accepted: 0 },
        duration_ms: Date.now() - startedAt,
      },
      200,
      "no-store"
    );
  } catch (error: any) {
    return jsonResponse(
      { ok: false, error: error?.message || "Synchronizácia produktov zlyhala." },
      500,
      "no-store"
    );
  }
};

// POST is preferred for scheduled server-to-server refreshes; authenticated GET
// remains supported for existing callers using the x-sync-token header.
export const POST: APIRoute = GET;
