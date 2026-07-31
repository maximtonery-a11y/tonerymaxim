import type { APIRoute } from "astro";
import { buildAdsProducts } from "../../lib/ads-products";
import { getProductsCache } from "../../lib/tm-products-cache";

export const prerender = false;
const PRODUCTION_ORIGIN = "https://www.tonerymaxim.sk";

export const GET: APIRoute = async ({ url }) => {
  try {
    const cache = await getProductsCache();
    const includeOutOfStock = url.searchParams.get("include_out_of_stock") === "1";
    const products = buildAdsProducts(cache.products, PRODUCTION_ORIGIN, !includeOutOfStock);

    return new Response(JSON.stringify({
      ok: true,
      source: "tonerymaxim-astro-products-cache",
      generated_at: new Date().toISOString(),
      products_cache_generated_at: cache.generated_at,
      filters: {
        product_type: "compatible",
        material_types: ["toner", "ink"],
        only_in_stock: !includeOutOfStock,
      },
      total: products.length,
      products,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || "Nepodarilo sa vytvoriť reklamný export." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};
