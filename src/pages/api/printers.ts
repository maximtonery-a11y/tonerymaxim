import type { APIRoute } from "astro";
import { compactKey, getProductsCache, jsonResponse, normalize } from "../../lib/tm-products-cache.ts";
import { productPrinterValues } from "../../lib/catalog-query.ts";
import { consumablePrinterFamilyKey } from "../../lib/printer-model-family.ts";
import { entitySlug } from "../../lib/seo-catalog.ts";
import { matchingPrinterName } from "../../lib/printer-name-search.ts";

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

type PrinterNames = { title: string; aliases?: string[] };
type PrinterItem = PrinterNames & { brand: string; product_count: number; url: string };

function addAlias(printer: PrinterNames, title: string) {
  const key = compactKey(title);
  if (key === compactKey(printer.title) || printer.aliases?.some(alias => compactKey(alias) === key)) return;
  (printer.aliases ||= []).push(title);
}

function mergeNames(printer: PrinterNames, incoming: PrinterNames) {
  for (const title of [incoming.title, ...(incoming.aliases || [])]) {
    if (compactKey(title).length < compactKey(printer.title).length) {
      const previous = printer.title;
      printer.title = title;
      printer.aliases = printer.aliases?.filter(alias => compactKey(alias) !== compactKey(title));
      addAlias(printer, previous);
    } else addAlias(printer, title);
  }
}

const globalStore = globalThis as typeof globalThis & {
  __TM_PRINTERS_INDEX__?: Map<string, { generatedAt: string; items: PrinterItem[] }>;
  __TM_PRINTERS_INDEX_GENERATION__?: string;
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

function printerPageUrl(title: string, detectedBrand = "") {
  const brand = detectedBrand || printerBrand(title);
  const slug = brandSlug(brand);
  const model = entitySlug(title);
  return slug && model && /\d/.test(title)
    ? `/tlaciarne/${slug}/${model}`
    : `/produkty?printer=${encodeURIComponent(title)}`;
}

export function buildPrinterIndex(products: any[], selectedBrand = "") {
  const map = new Map<string, PrinterItem>();
  for (const product of products) {
    // Jeden produkt môže mať rovnaký model zapísaný vo viacerých poliach alebo
    // vo viacerých variantoch. Deduplikujeme ho iba počas spracovania daného
    // produktu; množiny ID pre tisíce modelov nesmieme držať trvalo v RAM.
    const productFamilies = new Map<string, PrinterNames & { brand: string }>();
    for (const printer of productPrinterValues(product)) {
      const title = String(printer || "").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const detectedBrand = printerBrand(title);
      if (selectedBrand && detectedBrand !== selectedBrand) continue;
      const consumableFamily = consumablePrinterFamilyKey(title);
      const key = consumableFamily ? `consumable-family:${consumableFamily}` : compactKey(title);
      const current = productFamilies.get(key);
      if (current) mergeNames(current, { title });
      else productFamilies.set(key, { title, brand: detectedBrand });
    }

    for (const [key, printer] of productFamilies) {
      const existing = map.get(key);
      if (existing) {
        existing.product_count += 1;

        // Ako názov rodiny ponechaj základný model bez koncovky výbavy.
        // Napr. Phaser 3020 má prednosť pred 3020B a 3020BI.
        mergeNames(existing, printer);
        existing.url = printerPageUrl(existing.title, existing.brand);
        continue;
      }
      map.set(key, {
        title: printer.title,
        ...(printer.aliases?.length ? { aliases: printer.aliases } : {}),
        brand: printer.brand,
        product_count: 1,
        url: printerPageUrl(printer.title, printer.brand),
      });
    }
  }

  return [...map.values()]
    .sort((a, b) => a.title.localeCompare(b.title, "sk", { numeric: true, sensitivity: "base" }));
}

function getPrinterIndex(cache: any, brand = ""): PrinterItem[] {
  const indexes = globalStore.__TM_PRINTERS_INDEX__ || new Map();
  globalStore.__TM_PRINTERS_INDEX__ = indexes;
  if (globalStore.__TM_PRINTERS_INDEX_GENERATION__ !== cache.generated_at) {
    indexes.clear();
    globalStore.__TM_PRINTERS_INDEX_GENERATION__ = cache.generated_at;
  }
  // buildPrinterIndex only emits BRANDS. Unknown values have always produced
  // empty results, but previously accumulated an unbounded Map of URL inputs.
  if (brand && !BRANDS.includes(brand)) return [];
  const indexKey = brand || "__all__";
  const current = indexes.get(indexKey);
  if (current && current.generatedAt === cache.generated_at) return current.items;

  const items = buildPrinterIndex(cache.products, brand);
  indexes.set(indexKey, { generatedAt: cache.generated_at, items });
  return items;
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const brand = cleanBrand(url.searchParams.get("brand") || "");
    const q = String(url.searchParams.get("q") || url.searchParams.get("search") || "").trim();
    const limit = Math.min(10_000, Math.max(1, Number(url.searchParams.get("limit") || 1000)));

    const cache = await getProductsCache();
    const printers = getPrinterIndex(cache, brand)
      .filter((printer) => !brand || normalize(printer.brand || printer.title).includes(normalize(brand)))
      .filter((printer) => !q || matchingPrinterName(printer, q) !== null)
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
