import { compactKey, getProductsCache, type TmProduct } from "../tm-products-cache";

export interface LegacyProductMatch {
  product: TmProduct;
  location: string;
  confidence: number;
  matchedBy: "exact-slug" | "exact-key";
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
