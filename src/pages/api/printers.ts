import type { APIRoute } from "astro";
import { compactKey, getProductsCache, jsonResponse, normalize } from "../../lib/tm-products-cache";
import { productPrinterValues } from "../../lib/catalog-query";

export const prerender = false;

const BRANDS = [
  "HP",
  "Canon",
  "Brother",
  "Epson",
  "Xerox",
  "Samsung",
  "Lexmark",
  "Kyocera",
  "OKI",
  "Ricoh",
  "Konica Minolta",
  "Utax",
  "Panasonic",
  "Toshiba",
  "Dell",
];

const BRAND_SLUGS: Record<string, string> = {
  hp: "HP",
  canon: "Canon",
  brother: "Brother",
  epson: "Epson",
  xerox: "Xerox",
  samsung: "Samsung",
  lexmark: "Lexmark",
  kyocera: "Kyocera",
  oki: "OKI",
  ricoh: "Ricoh",
  "konica-minolta": "Konica Minolta",
  utax: "Utax",
  panasonic: "Panasonic",
  toshiba: "Toshiba",
  dell: "Dell",
};

function cleanBrand(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const slugMatch = BRAND_SLUGS[raw.toLowerCase()];
  if (slugMatch) return slugMatch;
  const normalized = normalize(raw);
  return BRANDS.find((brand) => normalize(brand) === normalized || compactKey(brand) === compactKey(raw)) || raw;
}

function brandSlug(brand: string) {
  return normalize(brand).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function printerBrand(printer: string) {
  const text = normalize(printer);
  if (/\bhp\b/.test(text) || text.includes("hewlett")) return "HP";
  return BRANDS.find((brand) => text.includes(normalize(brand))) || "";
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const brand = cleanBrand(url.searchParams.get("brand") || "");
    const q = String(url.searchParams.get("q") || url.searchParams.get("search") || "").trim();
    const limit = Math.min(10_000, Math.max(1, Number(url.searchParams.get("limit") || 1000)));
    const normalizedQ = normalize(q);
    const compactQ = compactKey(q);

    const cache = await getProductsCache();
    const map = new Map<string, { title: string; brand: string; product_count: number; url: string }>();

    for (const product of cache.products) {
      const printers = productPrinterValues(product);
      for (const printer of printers) {
        const title = String(printer || "").replace(/\s+/g, " ").trim();
        if (!title) continue;

        const detectedBrand = printerBrand(title);
        if (brand && normalize(detectedBrand || title).indexOf(normalize(brand)) === -1) continue;
        if (q && !normalize(title).includes(normalizedQ) && !compactKey(title).includes(compactQ)) continue;

        const key = compactKey(title);
        const current = map.get(key);
        if (current) {
          current.product_count += 1;
        } else {
          map.set(key, {
            title,
            brand: detectedBrand || brand || "",
            product_count: 1,
            url: `/produkty?printer=${encodeURIComponent(title)}`,
          });
        }
      }
    }

    const printers = [...map.values()]
      .sort((a, b) => a.title.localeCompare(b.title, "sk", { numeric: true, sensitivity: "base" }))
      .slice(0, limit);

    return jsonResponse({
      ok: true,
      source: "local-products-cache",
      cache_generated_at: cache.generated_at,
      brand,
      brand_slug: brand ? brandSlug(brand) : "",
      query: q,
      total: printers.length,
      brands: BRANDS.map((item) => ({ title: item, slug: brandSlug(item), url: `/tlaciarne/${brandSlug(item)}` })),
      printers,
    });
  } catch (error: any) {
    return jsonResponse({ ok: false, error: error?.message || "Nepodarilo sa načítať tlačiarne" }, 500, "no-store");
  }
};
