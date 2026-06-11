import type { APIRoute } from "astro";
import { filterProducts, getProductsCache, jsonResponse, sortProducts } from "../../lib/tm-products-cache";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const search = url.searchParams.get("search") || url.searchParams.get("s") || "";
    const brand = url.searchParams.get("brand") || "";
    const category = url.searchParams.get("category") || "";
    const type = url.searchParams.get("type") || "";
    const color = url.searchParams.get("color") || "";
    const stock = url.searchParams.get("stock") || "";
    const printer = url.searchParams.get("printer") || "";
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.min(96, Math.max(1, Number(url.searchParams.get("per_page") || 12)));

    const cache = await getProductsCache();
    const filtered = sortProducts(filterProducts(cache.products, { search, brand, category, type, color, stock, printer }));
    const start = (page - 1) * perPage;
    const products = filtered.slice(start, start + perPage);

    return jsonResponse({
      ok: true,
      source: "local-products-cache",
      cache_generated_at: cache.generated_at,
      page,
      per_page: perPage,
      count: products.length,
      total: filtered.length,
      total_pages: Math.max(1, Math.ceil(filtered.length / perPage)),
      filters: { search, brand, category, type, color, stock, printer },
      sorted_by: "compatible-original-renovated",
      products,
    });
  } catch (error: any) {
    return jsonResponse({ ok: false, error: error?.message || "Chyba produktovej cache" }, 500, "no-store");
  }
};
