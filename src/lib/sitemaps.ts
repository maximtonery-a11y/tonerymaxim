import { createHash } from "node:crypto";
import { getProductsCache, type TmProduct } from "./tm-products-cache";
import { brandProducts, oemEntities, printerEntities, SEO_BRANDS, validIndexableProduct } from "./seo-catalog";
import { adviceArticles } from "../data/advice";
import { adviceCategories } from "../data/advice-categories";

export const SITEMAP_ORIGIN = "https://www.tonerymaxim.sk";
export const SITEMAP_MAX_URLS = 50_000;

const MIN_SAFE_SITEMAP_PRODUCTS = 100;
const XML_CACHE_CONTROL = "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400";
const PLACEHOLDER_IMAGE = /placeholder|no-image|image-coming-soon/i;

export type SitemapEntry = {
  path: string;
  lastModified?: string;
  image?: string;
};

type SitemapIndexEntry = {
  path: string;
  lastModified?: string;
};

export const INDEXABLE_STATIC_PATHS = [
  "/",
  "/produkty",
  "/tonery",
  "/kompatibilne-tonery",
  "/originalne-tonery",
  "/renovovane-tonery",
  "/atramentove-naplne",
  "/opticke-valce",
  "/komponenty-do-tlaciarni",
  "/tlaciarne",
  "/o-nas",
  "/kontakt",
  "/doprava-a-platba",
  "/faq",
  "/poradna",
  ...adviceCategories.map((category) => `/poradna/kategoria/${category.slug}`),
  "/autor/roman-babcan",
  "/ako-overujeme-kompatibilitu",
  ...adviceArticles.map((article) => `/poradna/${article.slug}`),
  "/reklamacie",
  "/reklamacia-online",
  "/odstupenie-od-zmluvy",
  "/obchodne-podmienky",
  "/ochrana-osobnych-udajov",
  "/partneri-a-tretie-strany",
  "/cookies",
  "/toner-bez-starosti",
  "/spatny-odber-tonerov",
  "/vernostny-program",
];

function xml(value: unknown): string {
  return String(value ?? "").replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;",
  })[char] || char);
}

function absolute(path: string): string {
  return new URL(path, SITEMAP_ORIGIN).toString();
}

export function sitemapDate(value: unknown): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function validPath(path: unknown): path is string {
  const raw = String(path || "").trim();
  if (!raw.startsWith("/") || raw.length > 1_800 || /[\s<>"']/.test(raw)) return false;
  try {
    const url = new URL(raw, SITEMAP_ORIGIN);
    return url.origin === SITEMAP_ORIGIN && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function sitemapImage(value: unknown): string | undefined {
  const raw = String(value || "").trim();
  if (!raw || PLACEHOLDER_IMAGE.test(raw)) return undefined;
  try {
    const url = new URL(raw, SITEMAP_ORIGIN);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function productSitemapDate(product: TmProduct): string | undefined {
  const raw = String(product.date_modified_gmt || product.date_modified || "").trim();
  const dateOnly = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return dateOnly || sitemapDate(raw);
}

function normalizedEntries(entries: SitemapEntry[]): SitemapEntry[] {
  const unique = new Map<string, SitemapEntry>();

  for (const entry of entries) {
    if (!validPath(entry.path)) continue;
    const location = absolute(entry.path);
    if (unique.has(location)) continue;
    unique.set(location, {
      path: entry.path,
      lastModified: sitemapDate(entry.lastModified),
      image: sitemapImage(entry.image),
    });
  }

  const result = [...unique.values()];
  if (result.length > SITEMAP_MAX_URLS) {
    throw new Error(`Sitemap obsahuje ${result.length} URL, maximum je ${SITEMAP_MAX_URLS}.`);
  }
  return result;
}

export function buildUrlSetXml(entries: SitemapEntry[]): string {
  const normalized = normalizedEntries(entries);
  const hasImages = normalized.some((entry) => entry.image);
  const namespace = hasImages
    ? " xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" xmlns:image=\"http://www.google.com/schemas/sitemap-image/1.1\""
    : " xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"";

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<urlset${namespace}>`,
    ...normalized.map((entry) => [
      "  <url>",
      `    <loc>${xml(absolute(entry.path))}</loc>`,
      ...(entry.lastModified ? [`    <lastmod>${xml(entry.lastModified)}</lastmod>`] : []),
      ...(entry.image ? [
        "    <image:image>",
        `      <image:loc>${xml(entry.image)}</image:loc>`,
        "    </image:image>",
      ] : []),
      "  </url>",
    ].join("\n")),
    "</urlset>",
    "",
  ].join("\n");
}

export function buildSitemapIndexXml(entries: SitemapIndexEntry[]): string {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">",
    ...entries.filter((entry) => validPath(entry.path)).map((entry) => [
      "  <sitemap>",
      `    <loc>${xml(absolute(entry.path))}</loc>`,
      ...(sitemapDate(entry.lastModified) ? [`    <lastmod>${xml(sitemapDate(entry.lastModified))}</lastmod>`] : []),
      "  </sitemap>",
    ].join("\n")),
    "</sitemapindex>",
    "",
  ].join("\n");
}

function xmlResponse(body: string, request?: Request, lastModified?: string): Response {
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 24)}"`;
  const normalizedLastModified = sitemapDate(lastModified);
  const headers = new Headers({
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": XML_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    "Vary": "Accept-Encoding",
    "ETag": etag,
  });
  if (normalizedLastModified) headers.set("Last-Modified", new Date(normalizedLastModified).toUTCString());

  const ifNoneMatch = request?.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").map((value) => value.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }

  const ifModifiedSince = request?.headers.get("if-modified-since");
  if (ifModifiedSince && normalizedLastModified) {
    const requestedDate = new Date(ifModifiedSince).getTime();
    const resourceDate = new Date(normalizedLastModified).getTime();
    if (Number.isFinite(requestedDate) && requestedDate >= resourceDate) {
      return new Response(null, { status: 304, headers });
    }
  }

  return new Response(body, { status: 200, headers });
}

function unavailable(error: unknown): Response {
  console.error("[TM sitemap]", (error as any)?.message || error);
  return new Response("Sitemap je dočasne nedostupná. Vyhľadávač ju môže skúsiť načítať neskôr.", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "900",
      "X-Robots-Tag": "noindex",
    },
  });
}

async function catalog(): Promise<{ products: TmProduct[]; lastModified?: string }> {
  const cache = await getProductsCache();
  const products = cache.products.filter(validIndexableProduct);
  if (products.length < MIN_SAFE_SITEMAP_PRODUCTS) {
    throw new Error(`Bezpečnostná kontrola zastavila sitemapu: iba ${products.length} platných produktov.`);
  }
  return { products, lastModified: sitemapDate(cache.generated_at) };
}

export function sitemapIndexResponse(request?: Request): Response {
  const body = buildSitemapIndexXml([
    { path: "/sitemap-pages.xml" },
    { path: "/sitemap-products.xml" },
    { path: "/sitemap-brands.xml" },
    { path: "/sitemap-printers.xml" },
    { path: "/sitemap-oem.xml" },
  ]);
  return xmlResponse(body, request);
}

export function urlSetResponse(entries: SitemapEntry[], request?: Request, lastModified?: string): Response {
  return xmlResponse(buildUrlSetXml(entries), request, lastModified);
}

export function pagesSitemapResponse(request?: Request): Response {
  return urlSetResponse(INDEXABLE_STATIC_PATHS.map((path) => ({ path })), request);
}

export async function productsSitemapResponse(request?: Request): Promise<Response> {
  try {
    const { products, lastModified } = await catalog();
    const entries = products.map((product) => ({
      path: `/produkt/${encodeURIComponent(String(product.slug))}`,
      lastModified: productSitemapDate(product),
      image: product.image || product.images?.[0],
    }));
    return urlSetResponse(entries, request, lastModified);
  } catch (error) {
    return unavailable(error);
  }
}

export async function brandsSitemapResponse(request?: Request): Promise<Response> {
  try {
    const { products, lastModified } = await catalog();
    const entries = SEO_BRANDS
      .filter((brand) => brandProducts(products, brand).length > 0)
      .flatMap((brand) => [
        { path: `/znacky/${brand.slug}`, lastModified },
        { path: `/tlaciarne/${brand.slug}`, lastModified },
      ]);
    return urlSetResponse(entries, request, lastModified);
  } catch (error) {
    return unavailable(error);
  }
}

export async function printersSitemapResponse(request?: Request): Promise<Response> {
  try {
    const { products, lastModified } = await catalog();
    const entries = printerEntities(products)
      .filter((printer) => printer.products.length > 0)
      .map((printer) => ({
        path: `/tlaciarne/${printer.brand.slug}/${printer.slug}`,
        lastModified,
        image: printer.products
          .flatMap((product) => [product.image, ...(Array.isArray(product.images) ? product.images : [])])
          .find((value) => sitemapImage(value)),
      }));
    return urlSetResponse(entries, request, lastModified);
  } catch (error) {
    return unavailable(error);
  }
}

export async function oemSitemapResponse(request?: Request): Promise<Response> {
  try {
    const { products, lastModified } = await catalog();
    const entries = oemEntities(products)
      .filter((oem) => oem.products.length > 0)
      .map((oem) => ({ path: `/oem/${oem.slug}`, lastModified }));
    return urlSetResponse(entries, request, lastModified);
  } catch (error) {
    return unavailable(error);
  }
}
