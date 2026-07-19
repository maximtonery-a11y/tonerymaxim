import type { APIRoute } from "astro";
import { filterProducts, getProductsCache, jsonResponse, type TmProduct } from "../../lib/tm-products-cache";

export const prerender = false;

type ProductsApiCacheEntry = {
  expiresAt: number;
  body: string;
};

const RESULT_CACHE_TTL_MS = Number(import.meta.env.PRODUCTS_API_CACHE_TTL_MS || process.env.PRODUCTS_API_CACHE_TTL_MS || 60_000);
const RESULT_CACHE_MAX_ITEMS = Number(import.meta.env.PRODUCTS_API_CACHE_MAX_ITEMS || process.env.PRODUCTS_API_CACHE_MAX_ITEMS || 250);

const globalStore = globalThis as typeof globalThis & {
  __TM_PRODUCTS_API_RESULT_CACHE__?: Map<string, ProductsApiCacheEntry>;
};

const resultCache = globalStore.__TM_PRODUCTS_API_RESULT_CACHE__ || new Map<string, ProductsApiCacheEntry>();
globalStore.__TM_PRODUCTS_API_RESULT_CACHE__ = resultCache;

function cleanParam(value: string | null) {
  return String(value || "").trim();
}

function canonicalCacheKey(input: Record<string, string | number>) {
  return Object.entries(input)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
}

function getCachedBody(key: string) {
  const cached = resultCache.get(key);
  if (!cached) return "";
  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return "";
  }

  // Obnoví poradie v Map ako jednoduché LRU.
  resultCache.delete(key);
  resultCache.set(key, cached);
  return cached.body;
}

function setCachedBody(key: string, body: string) {
  if (RESULT_CACHE_TTL_MS <= 0) return;
  resultCache.set(key, { body, expiresAt: Date.now() + RESULT_CACHE_TTL_MS });

  while (resultCache.size > RESULT_CACHE_MAX_ITEMS) {
    const firstKey = resultCache.keys().next().value;
    if (!firstKey) break;
    resultCache.delete(firstKey);
  }
}

function slimProduct(product: TmProduct) {
  return {
    id: product.id,
    sku: product.sku || "",
    name: product.name || "",
    slug: product.slug || "",
    price: product.price,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    stock_quantity: product.stock_quantity ?? null,
    stock_status: product.stock_status || "",
    image: product.image || "",
    images: Array.isArray(product.images) ? product.images.slice(0, 1) : [],
    detail_url: product.detail_url || (product.slug ? `/novy/produkt/${product.slug}` : `/novy/produkt/${product.id}`),
    product_type_key: product.product_type_key || "product",
    product_type_label: product.product_type_label || "PRODUKT",
    product_type_detail_label: product.product_type_detail_label || product.product_type_label || "Spotrebný materiál",
    product_type_note: product.product_type_note || "Spotrebný materiál",
    product_type_icon: product.product_type_icon || "dot",
    color: product.color || product.farba || "",
    farba: product.farba || product.color || "",
    capacity: product.capacity || product.kapacita || product.yield || product.page_yield || "",
    kapacita: product.kapacita || product.capacity || product.yield || product.page_yield || "",
    yield: product.yield || product.capacity || product.kapacita || product.page_yield || "",
    page_yield: product.page_yield || product.yield || product.capacity || product.kapacita || "",
    warranty: product.warranty || product.zaruka || "24 mesiacov",
    zaruka: product.zaruka || product.warranty || "24 mesiacov",
    compatible_printers: Array.isArray(product.compatible_printers) ? product.compatible_printers.slice(0, 80) : [],
    printers: Array.isArray(product.printers) ? product.printers.slice(0, 80) : Array.isArray(product.compatible_printers) ? product.compatible_printers.slice(0, 80) : [],
    categories: Array.isArray(product.categories) ? product.categories : [],
    attributes: Array.isArray(product.attributes) ? product.attributes : [],
    attributes_all: Array.isArray(product.attributes_all) ? product.attributes_all : Array.isArray(product.attributes) ? product.attributes : [],
  };
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const search = cleanParam(url.searchParams.get("search") || url.searchParams.get("s"));
    const brand = cleanParam(url.searchParams.get("brand"));
    const category = cleanParam(url.searchParams.get("category"));
    const type = cleanParam(url.searchParams.get("type"));
    const color = cleanParam(url.searchParams.get("color"));
    const stock = cleanParam(url.searchParams.get("stock"));
    const printer = cleanParam(url.searchParams.get("printer"));
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.min(96, Math.max(1, Number(url.searchParams.get("per_page") || 12)));

    const cacheKey = canonicalCacheKey({ search, brand, category, type, color, stock, printer, page, perPage });
    const cachedBody = getCachedBody(cacheKey);
    if (cachedBody) {
      return new Response(cachedBody, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
          "X-TM-Products-Cache": "hit",
        },
      });
    }

    const productsCache = await getProductsCache();

    // Produktová cache je už pri synchronizácii zoradená podľa pravidla:
    // kompatibilný → originál → renovovaný → ostatné, skladom najskôr.
    // Preto tu znovu netriedime celé pole pri každom requeste.
    const filtered = filterProducts(productsCache.products, { search, brand, category, type, color, stock, printer });
    const start = (page - 1) * perPage;
    const products = filtered.slice(start, start + perPage).map(slimProduct);

    const body = JSON.stringify({
      ok: true,
      source: "local-products-cache",
      cache_generated_at: productsCache.generated_at,
      api_cache_ttl_ms: RESULT_CACHE_TTL_MS,
      page,
      per_page: perPage,
      count: products.length,
      total: filtered.length,
      total_pages: Math.max(1, Math.ceil(filtered.length / perPage)),
      filters: { search, brand, category, type, color, stock, printer },
      sorted_by: "compatible-original-renovated",
      products,
    });

    setCachedBody(cacheKey, body);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
        "X-TM-Products-Cache": "miss",
      },
    });
  } catch (error: any) {
    return jsonResponse({ ok: false, error: error?.message || "Chyba produktovej cache" }, 500, "no-store");
  }
};
