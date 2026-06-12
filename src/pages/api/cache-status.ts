import type { APIRoute } from "astro";
import { getProductsCache, jsonResponse } from "../../lib/tm-products-cache";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const cache = await getProductsCache();
    return jsonResponse({
      ok: true,
      total: cache.total,
      generated_at: cache.generated_at,
      first_products: cache.products.slice(0, 5).map((p: any) => ({ id: p.id, sku: p.sku, name: p.name })),
    }, 200, "no-store");
  } catch (error: any) {
    return jsonResponse({ ok: false, error: error?.message || "Cache status zlyhal" }, 500, "no-store");
  }
};
