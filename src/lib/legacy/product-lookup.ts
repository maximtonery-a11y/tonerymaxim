import { compactKey, getProductsCache, type TmProduct } from "../tm-products-cache";
import { LEGACY_PRODUCT_REDIRECTS } from "./product-redirect-map";

export interface LegacyProductMatch {
  product: TmProduct;
  location: string;
  confidence: number;
  matchedBy: "verified-redirect-map" | "exact-slug" | "exact-key";
}

function detailUrl(product: TmProduct): string {
  const direct = String(product.detail_url || "").trim();
  if (direct.startsWith("/produkt/")) return direct;

  const slug = String(product.slug || product.id || "").trim();
  return slug ? `/produkt/${encodeURIComponent(slug)}` : "/produkty";
}

export async function findLegacyProduct(legacySlugValue: unknown): Promise<LegacyProductMatch | null> {
  const legacySlug = String(legacySlugValue || "")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.toLowerCase() || "";

  if (!legacySlug) return null;

  const cache = await getProductsCache();

  const mappedSlug = LEGACY_PRODUCT_REDIRECTS[legacySlug];
  if (mappedSlug) {
    const mappedProduct = cache.products.find(
      (product) => String(product.slug || "").toLowerCase() === mappedSlug,
    );

    // Mapa sa použije iba vtedy, keď jej cieľ stále existuje v aktuálnom
    // katalógu. Zastaraný cieľ preto nikdy nevytvorí 301 na chybovú stránku.
    if (mappedProduct) {
      return {
        product: mappedProduct,
        location: detailUrl(mappedProduct),
        confidence: 1,
        matchedBy: "verified-redirect-map",
      };
    }
  }

  const exact = cache.products.find(
    (product) => String(product.slug || "").toLowerCase() === legacySlug
      || String(product.id || "") === legacySlug,
  );

  if (exact) {
    return {
      product: exact,
      location: detailUrl(exact),
      confidence: 1,
      matchedBy: "exact-slug",
    };
  }

  const legacyKey = compactKey(legacySlug);
  const exactKeyMatches = cache.products.filter(
    (product) => compactKey(product.slug || product.name || "") === legacyKey,
  );

  if (exactKeyMatches.length === 1) {
    const product = exactKeyMatches[0];
    return {
      product,
      location: detailUrl(product),
      confidence: 1,
      matchedBy: "exact-key",
    };
  }

  // Nejednoznačné fuzzy zhody sa zámerne nepresmerujú. Nesprávny toner je
  // horší výsledok než riadna 404, ktorú možno neskôr bezpečne domapovať.
  return null;
}
