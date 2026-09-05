import type { APIRoute } from "astro";
import { getProductFromCache, jsonResponse } from "../../lib/tm-products-cache";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const slug = String(url.searchParams.get("slug") || "").trim();
    const id = String(url.searchParams.get("id") || "").trim();

    if (!slug && !id) return jsonResponse({ ok: false, error: "Chýba slug alebo id produktu." }, 400, "no-store");

    const { cache, product } = await getProductFromCache({ id, slug });

    if (!product) return jsonResponse({ ok: false, error: "Produkt sa nenašiel v lokálnej cache." }, 404, "no-store");

    return jsonResponse(
      { ok: true, source: "local-products-cache-index", cache_generated_at: cache.generated_at, product },
      200,
      "no-store",
    );
  } catch (error: any) {
    return jsonResponse({ ok: false, error: error?.message || "Chyba detailu produktu" }, 500, "no-store");
  }
};
