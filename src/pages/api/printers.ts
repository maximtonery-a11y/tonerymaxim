import type { APIRoute } from "astro";
import { compactKey, getProductsCache, jsonResponse, normalize } from "../../lib/tm-products-cache.ts";
import { productPrinterValues } from "../../lib/catalog-query.ts";
import { consumablePrinterFamilyKey } from "../../lib/printer-model-family.ts";

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

type PrinterItem = { title: string; brand: string; product_count: number; url: string };

const globalStore = globalThis as typeof globalThis & {
  __TM_PRINTERS_INDEX__?: { generatedAt: string; items: PrinterItem[] };
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

type PrinterAccumulator = PrinterItem & { productKeys: Set<string> };

export function buildPrinterIndex(products: any[]) {
  const map = new Map<string, PrinterAccumulator>();
  for (const product of products) {
    const productKey = String(product?.id || product?.sku || product?.slug || product?.name || "");
    for (const printer of productPrinterValues(product)) {
      const title = String(printer || "").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const consumableFamily = consumablePrinterFamilyKey(title);
      const key = consumableFamily ? `consumable-family:${consumableFamily}` : compactKey(title);
      const existing = map.get(key);
      if (existing) {
        existing.productKeys.add(productKey);
        existing.product_count = existing.productKeys.size;

        // Ako názov rodiny ponechaj základný model bez koncovky výbavy.
        // Napr. Phaser 3020 má prednosť pred 3020B a 3020BI.
        if (compactKey(title).length < compactKey(existing.title).length) {
          existing.title = title;
          existing.url = `/produkty?printer=${encodeURIComponent(title)}`;
        }
        continue;
      }
      map.set(key, {
        title,
        brand: printerBrand(title),
        product_count: 1,
        url: `/produkty?printer=${encodeURIComponent(title)}`,
        productKeys: new Set([productKey]),
      });
    }
  }

  return [...map.values()]
    .map(({ productKeys: _productKeys, ...item }) => item)
    .sort((a, b) => a.title.localeCompare(b.title, "sk", { numeric: true, sensitivity: "base" }));
}

function getPrinterIndex(cache: any) {
  const current = globalStore.__TM_PRINTERS_INDEX__;
  if (current && current.generatedAt === cache.generated_at) return current.items;

  const items = buildPrinterIndex(cache.products);
  globalStore.__TM_PRINTERS_INDEX__ = { generatedAt: cache.generated_at, items };
  return items;
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const brand = cleanBrand(url.searchParams.get("brand") || "");
    const q = String(url.searchParams.get("q") || url.searchParams.get("search") || "").trim();
    const limit = Math.min(10_000, Math.max(1, Number(url.searchParams.get("limit") || 1000)));
    const normalizedQ = normalize(q);
    const compactQ = compactKey(q);

    const cache = await getProductsCache();
    const printers = getPrinterIndex(cache)
      .filter((printer) => !brand || normalize(printer.brand || printer.title).includes(normalize(brand)))
      .filter((printer) => !q || normalize(printer.title).includes(normalizedQ) || compactKey(printer.title).includes(compactQ))
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
    }, 200, "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  } catch (error: any) {
    return jsonResponse({ ok: false, error: error?.message || "Nepodarilo sa načítať tlačiarne" }, 500, "no-store");
  }
};
