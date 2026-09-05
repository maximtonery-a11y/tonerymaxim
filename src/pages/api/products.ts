import type { APIRoute } from "astro";
import { explicitlyRequestsSpecialChipVariant, filterProducts, getProductsCache, isSpecialChipVariantProduct, jsonResponse, limitedSpecialChipVariants, type TmProduct } from "../../lib/tm-products-cache.ts";

export const prerender = false;

type ProductsApiCacheEntry = {
  expiresAt: number;
  body: string;
};

const buildEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env || {};
const RESULT_CACHE_TTL_MS = Number(process.env.PRODUCTS_API_CACHE_TTL_MS || buildEnv.PRODUCTS_API_CACHE_TTL_MS || 60_000);
const RESULT_CACHE_MAX_ITEMS = Math.min(100, Math.max(20, Number(process.env.PRODUCTS_API_CACHE_MAX_ITEMS || buildEnv.PRODUCTS_API_CACHE_MAX_ITEMS || 80)));

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
    lowest_price_30d: product.lowest_price_30d || "",
    lowest_price_30d_valid: product.lowest_price_30d_valid === true,
    price_reduction_started_at: product.price_reduction_started_at || "",
    stock_quantity: product.stock_quantity ?? null,
    stock_status: product.stock_status || "",
    image: product.image || "",
    images: Array.isArray(product.images) ? product.images.slice(0, 1) : [],
    detail_url: product.detail_url || (product.slug ? `/produkt/${product.slug}` : `/produkt/${product.id}`),
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
    const requestedSkus = [...new Set(cleanParam(url.searchParams.get("skus"))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean))]
      .slice(0, 30);
    if (requestedSkus.length) {
      const productsCache = await getProductsCache();
      const wanted = new Set(requestedSkus.map((value) => value.toLocaleLowerCase("sk-SK")));
      const products = productsCache.products
        .filter((product) => wanted.has(String(product?.sku || "").trim().toLocaleLowerCase("sk-SK")))
        .map(slimProduct);
      return jsonResponse({
        ok: true,
        source: "local-products-cache-exact-skus",
        cache_generated_at: productsCache.generated_at,
        requested_skus: requestedSkus,
        count: products.length,
        products,
      }, 200, "no-store");
    }
    const rawSearch = cleanParam(url.searchParams.get("search") || url.searchParams.get("s"));
    const requestedBrand = cleanParam(url.searchParams.get("brand"));
    const requestedCategory = cleanParam(url.searchParams.get("category"));
    const legacyComponentSearch = ["ostatné komponenty", "ostatne komponenty", "komponent"].includes(rawSearch.toLowerCase());
    const search = requestedCategory === "ostatne-komponenty" && legacyComponentSearch ? "" : rawSearch;
    // Nový textový dotaz je globálny a nesmie zdediť staré filtre. Klient ich
    // pri novom hľadaní vyčistí. Typ však po následnom vedomom kliknutí musí
    // zostať aktívny aj nad výsledkami hľadania (napr. CE285 + Originálne).
    const brand = search ? "" : requestedBrand;
    const category = search ? "" : requestedCategory;
    const type = cleanParam(url.searchParams.get("type"));
    const color = search ? "" : cleanParam(url.searchParams.get("color"));
    const stock = search ? "" : cleanParam(url.searchParams.get("stock"));
    const printer = search ? "" : cleanParam(url.searchParams.get("printer"));
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.min(96, Math.max(1, Number(url.searchParams.get("per_page") || 12)));

    // Najprv načítame generáciu katalógu. Inak by starý výsledok z pamäte mohol
    // byť vrátený ešte pred zistením novej products.json po dennom syncu.
    const productsCache = await getProductsCache();
    const cacheKey = canonicalCacheKey({ generation: productsCache.generated_at, search, brand, category, type, color, stock, printer, page, perPage });
    const cachedBody = getCachedBody(cacheKey);
    if (cachedBody) {
      return new Response(cachedBody, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-TM-Products-Cache": "hit",
        },
      });
    }

    // Produktová cache je už pri synchronizácii zoradená podľa pravidla:
    // kompatibilný → originál → renovovaný → ostatné, skladom najskôr.
    // Preto tu znovu netriedime celé pole pri každom requeste.
    const filtered = filterProducts(productsCache.products, { search, brand, category, type, color, stock, printer });
    const explicitSpecial = explicitlyRequestsSpecialChipVariant(search);
    const specialVariants = explicitSpecial ? [] : filtered.filter(isSpecialChipVariantProduct);
    const mainFiltered = explicitSpecial ? filtered : filtered.filter((product) => !isSpecialChipVariantProduct(product));
    const start = (page - 1) * perPage;
    const products = mainFiltered.slice(start, start + perPage).map(slimProduct);

    const body = JSON.stringify({
      ok: true,
      source: "local-products-cache",
      cache_generated_at: productsCache.generated_at,
      api_cache_ttl_ms: RESULT_CACHE_TTL_MS,
      page,
      per_page: perPage,
      count: products.length,
      total: mainFiltered.length,
      total_pages: Math.max(1, Math.ceil(mainFiltered.length / perPage)),
      special_variants: limitedSpecialChipVariants(specialVariants, 8).map(slimProduct),
      filters: { search, brand, category, type, color, stock, printer },
      sorted_by: "compatible-original-renovated",
      products,
    });

    setCachedBody(cacheKey, body);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-TM-Products-Cache": "miss",
      },
    });
  } catch (error: any) {
    return jsonResponse({ ok: false, error: error?.message || "Chyba produktovej cache" }, 500, "no-store");
  }
};
