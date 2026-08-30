import bundledProducts from "../data/calendar-products.json";
import { CALENDAR_SOURCE, calendarDiscountRate, calendarDiscountedUnitPrice } from "./calendar-pricing";
export { CALENDAR_SOURCE, calendarDiscountRate, calendarDiscountedUnitPrice };

export type CalendarProduct = {
  sku: string;
  name: string;
  price: number;
  slug?: string;
  category?: string;
  availability: {
    inStock: boolean;
    raw?: string;
    checkedAt?: string | null;
  };
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 1000;
const MAX_CATALOG_BYTES = 2_000_000;
let cachedProducts: CalendarProduct[] = normalizeProducts(bundledProducts);
const bundledProductSkus = new Set(cachedProducts.map((product) => product.sku));
let cacheExpiresAt = 0;
let refreshPromise: Promise<CalendarProduct[]> | null = null;

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function normalizeProducts(value: unknown): CalendarProduct[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: CalendarProduct[] = [];

  for (const raw of value) {
    const sku = String(raw?.sku || "").trim();
    const name = String(raw?.name || "").trim();
    const price = money(raw?.price);
    if (!sku || !name || price <= 0 || seen.has(sku)) continue;
    seen.add(sku);
    result.push({
      sku,
      name: name.slice(0, 160),
      price,
      slug: String(raw?.slug || "").trim(),
      category: String(raw?.category || "").trim(),
      availability: {
        inStock: raw?.availability?.inStock === true,
        raw: String(raw?.availability?.raw || "").trim(),
        checkedAt: raw?.availability?.checkedAt ? String(raw.availability.checkedAt) : null,
      },
    });
  }

  return result;
}

function catalogUrl() {
  return String(process.env.TM_CALENDAR_CATALOG_URL || "").trim();
}

export function isBundledCalendarSku(value: unknown) {
  return bundledProductSkus.has(String(value || "").trim());
}

function allowedCatalogUrl(value: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && (hostname === "tonerymaxim.sk" || hostname === "www.tonerymaxim.sk")
      && url.pathname === "/kalendare/api/products"
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

async function refreshCalendarProducts(now: number): Promise<CalendarProduct[]> {
  const url = catalogUrl();
  if (!allowedCatalogUrl(url)) {
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedProducts;
  }

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_CATALOG_BYTES) throw new Error("Katalóg kalendárov je príliš veľký.");
    const body = await response.text();
    if (body.length > MAX_CATALOG_BYTES) throw new Error("Katalóg kalendárov je príliš veľký.");
    const products = normalizeProducts(JSON.parse(body));
    const minimumRows = Math.max(1, Math.floor(normalizeProducts(bundledProducts).length * 0.95));
    if (products.length < minimumRows) throw new Error(`Katalóg kalendárov je neúplný (${products.length}/${minimumRows}).`);
    if (products.some((product) => !product.availability.checkedAt)) throw new Error("Katalóg nemá overený stav skladu pri všetkých produktoch.");
    cachedProducts = products;
    cacheExpiresAt = now + CACHE_TTL_MS;
  } catch (error: any) {
    console.error("Calendar catalog refresh failed; using bundled last-known catalog:", error?.message || error);
    cacheExpiresAt = now + FAILURE_CACHE_TTL_MS;
  }
  return cachedProducts;
}

export async function getCalendarProducts(): Promise<CalendarProduct[]> {
  const now = Date.now();
  if (cacheExpiresAt > now && cachedProducts.length) return cachedProducts;

  // Pri súbehu objednávok sa katalóg načíta iba raz. Ostatné požiadavky čakajú
  // na tú istú Promise namiesto vytvorenia desiatok rovnakých externých volaní.
  if (!refreshPromise) {
    refreshPromise = refreshCalendarProducts(now).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
