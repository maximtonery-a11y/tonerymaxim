import type { APIRoute } from "astro";
import { jsonResponse, syncProductsCache } from "../../lib/tm-products-cache";
import { safeEqual } from "../../lib/security";

export const prerender = false;

function env(name: string) {
  return String(import.meta.env[name] || process.env[name] || "").trim();
}

function isLocalRequest(url: URL, request: Request) {
  const host = url.hostname.toLowerCase();
  const headerHost = String(request.headers.get("host") || "").toLowerCase();

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    headerHost.startsWith("localhost:") ||
    headerHost.startsWith("127.0.0.1:") ||
    headerHost.startsWith("[::1]:")
  );
}

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const secret = env("SYNC_SECRET");
    const token = url.searchParams.get("token") || request.headers.get("x-sync-token") || "";
    const localRequest = isLocalRequest(url, request);

    if (!localRequest) {
      if (secret.length < 24) {
        return jsonResponse(
          { ok: false, error: "SYNC_SECRET nie je v produkcii správne nastavený." },
          503,
          "no-store"
        );
      }
      if (!safeEqual(secret, token)) {
        return jsonResponse(
          { ok: false, error: "Neplatný alebo chýbajúci sync token." },
          401,
          "no-store"
        );
      }
    }

    if (localRequest && secret && token && !safeEqual(secret, token)) {
      return jsonResponse(
        { ok: false, error: "Zadaný sync token je nesprávny." },
        401,
        "no-store"
      );
    }

    const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
    const startedAt = Date.now();
    const result = await syncProductsCache({ force });

    return jsonResponse(
      {
        ok: true,
        mode: localRequest ? "local-manual" : "protected",
        refreshed: result.refreshed,
        warning: (result as any).warning || "",
        total: result.cache.total,
        generated_at: result.cache.generated_at,
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
