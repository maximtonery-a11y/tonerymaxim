import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type TmProduct = Record<string, any>;

type CacheFile = {
  ok: true;
  version: number;
  generated_at: string;
  total: number;
  products: TmProduct[];
};

const CACHE_VERSION = 1;
const CACHE_DIR = path.join(process.cwd(), ".tm-cache");
const CACHE_FILE = path.join(CACHE_DIR, "products.json");
const FALLBACK_CACHE_FILES = [
  CACHE_FILE,
  path.join(process.cwd(), "src", "data", "products-cache.json"),
  path.join(process.cwd(), "public", "data", "products-cache.json"),
  path.join(process.cwd(), "dist", "client", "data", "products-cache.json"),
  path.join(process.cwd(), "data", "products-cache.json"),
];
const MIN_SAFE_PRODUCTS = Number(env("WOO_SYNC_MIN_PRODUCTS") || 100);
const WOO_SYNC_PER_PAGE = Math.min(100, Math.max(10, Number(env("WOO_SYNC_PER_PAGE") || 100)));
const WOO_SYNC_TIMEOUT_MS = Math.min(60000, Math.max(8000, Number(env("WOO_SYNC_TIMEOUT_MS") || 25000)));
const WOO_SYNC_MAX_PAGES = Math.min(1000, Math.max(1, Number(env("WOO_SYNC_MAX_PAGES") || 500)));
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WOO_FIELDS = [
  "id",
  "sku",
  "name",
  "slug",
  "price",
  "regular_price",
  "sale_price",
  "stock_quantity",
  "stock_status",
  "images",
  "description",
  "short_description",
  "categories",
  "tags",
  "attributes",
  "meta_data",
].join(",");

const globalStore = globalThis as typeof globalThis & { __TM_PRODUCTS_FILE_CACHE__?: CacheFile };

function env(name: string) {
  return String(import.meta.env[name] || process.env[name] || "").trim();
}

function getAuthHeader() {
  const key = env("WOO_CONSUMER_KEY");
  const secret = env("WOO_CONSUMER_SECRET");
  return `Basic ${Buffer.from(`${key}:${secret}`, "utf8").toString("base64")}`;
}

export function stripHtml(html: unknown) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalize(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function compactKey(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function cleanPrice(value: unknown) {
  const number = Number(String(value || "0").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function uniqueStrings(values: string[], minLength = 3) {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (!clean || clean.length < minLength) return;
    const key = compactKey(clean);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function cleanupPrinterCandidate(value: string) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—\-]+/, "")
    .replace(/^(toner|kazeta|náplň|napln|cartridge|produkt|spotrebný materiál)\s+(je\s+)?(kompatibiln[ýáéy]|vhodn[ýáéy])\s+(s|pre)\s+(tlačiarňami|tlaciarnami|tlačiarne|tlaciarne|printermi|printers?)?\s*/i, "")
    .replace(/^(kompatibiln[éey]|kompatibilne|vhodn[éey]|vhodne|určen[éey]|urcene|pre|modely|tlačiarne|tlaciarne|printers?|models?)\s*:?-?\s*/i, "")
    .replace(/\s*(a\s+ďalšie|a\s+dalsie|a\s+iné|a\s+ine|and\s+other).*$/i, "")
    .replace(/[.。]+$/g, "")
    .trim();
}

function looksLikePrinterModel(value: string) {
  const text = cleanupPrinterCandidate(value);
  if (text.length < 4 || text.length > 90) return false;
  if (!/\d/.test(text)) return false;
  if (/\b(toner|kazeta|náplň|napln|cartridge|produkt|strán|stran|pages|záruka|zaruka|skladom|kompatibiln[ýáéy])\b/i.test(text)) return false;
  return /\b(HP|Brother|Canon|Epson|Xerox|Samsung|Lexmark|Dell|Kyocera|OKI|Ricoh|Konica|Minolta|Utax|Panasonic|Toshiba|LaserJet|OfficeJet|DeskJet|PIXMA|i-SENSYS|DCP|MFC|HL|WorkForce|EcoTank|Expression)\b/i.test(text) || /\b[A-Z]{1,5}[- ]?[A-Z]?\d{2,5}[A-Z0-9-]*\b/.test(text);
}

function extractKnownPrinterModels(value: unknown) {
  const text = cleanupPrinterCandidate(stripHtml(String(value || "")));
  if (!text) return [];
  const matches: string[] = [];
  const patterns = [
    /\bHP\s+(?:Color\s+LaserJet|LaserJet|OfficeJet|DeskJet|PageWide|Photosmart|ENVY|Neverstop|MFP|Pro)\s+[A-Z0-9][A-Z0-9\s\-]*\d[A-Z0-9\s\-]*/gi,
    /\bBrother\s+(?:DCP|MFC|HL|FAX|PT)[\s\-]?[A-Z0-9][A-Z0-9\-]*\d[A-Z0-9\-]*/gi,
    /\bCanon\s+(?:PIXMA|i-SENSYS|MAXIFY|LBP|MF|MG|TS|TR|IP|MP)\s*[A-Z0-9][A-Z0-9\s\-]*\d[A-Z0-9\-]*/gi,
    /\bEpson\s+(?:EcoTank|WorkForce|Expression|Stylus|SureColor|XP|WF|ET|L)\s*[A-Z0-9][A-Z0-9\s\-]*\d[A-Z0-9\-]*/gi,
    /\b(?:Xerox|Samsung|Lexmark|Dell|Kyocera|OKI|Ricoh|Utax|Toshiba|Panasonic)\s+[A-Z0-9][A-Z0-9\s\-]*\d[A-Z0-9\-]*/gi,
  ];
  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) {
      const clean = cleanupPrinterCandidate(match[0]).replace(/\s{2,}/g, " ").replace(/\s*,\s*$/g, "").trim();
      if (clean) matches.push(clean);
    }
  });
  if (matches.length > 0) return matches;
  return text
    .split(/[\n;|]+|,(?=\s*(?:HP|Brother|Canon|Epson|Xerox|Samsung|Lexmark|Dell|Kyocera|OKI|Ricoh|Konica|Minolta|Utax|Panasonic|Toshiba))/i)
    .map(cleanupPrinterCandidate)
    .filter(looksLikePrinterModel);
}

function extractPrinters(product: any) {
  const values: string[] = [];
  const pushFrom = (value: unknown) => values.push(...extractKnownPrinterModels(value));
  const attributes = Array.isArray(product.attributes) ? product.attributes : [];
  attributes.forEach((attribute: any) => {
    const name = normalize(attribute?.name);
    if (!/kompat|compat|tla\w*iar|tlaciar|printer|model|zariaden/.test(name)) return;
    if (Array.isArray(attribute?.options)) attribute.options.forEach(pushFrom);
    else if (attribute?.option) pushFrom(attribute.option);
  });
  const meta = Array.isArray(product.meta_data) ? product.meta_data : [];
  meta.forEach((item: any) => {
    const key = normalize(item?.key);
    if (!/kompat|compat|tla\w*iar|tlaciar|printer|model|zariaden/.test(key)) return;
    if (Array.isArray(item?.value)) {
      item.value.forEach((entry: unknown) => {
        if (typeof entry === "object" && entry !== null) pushFrom((entry as any).name || (entry as any).title || (entry as any).model || JSON.stringify(entry));
        else pushFrom(entry);
      });
    } else pushFrom(item?.value);
  });
  values.push(...extractKnownPrinterModels(`${product.short_description || ""}\n${product.description || ""}`));
  return uniqueStrings(values).slice(0, 80);
}

function detectType(product: any) {
  const categoryText = Array.isArray(product.categories) ? product.categories.map((cat: any) => cat.name || cat.slug || "").join(" ") : "";
  const tagText = Array.isArray(product.tags) ? product.tags.map((tag: any) => tag.name || tag.slug || "").join(" ") : "";
  const text = normalize(`${product.name || ""} ${product.sku || ""} ${categoryText} ${tagText} ${stripHtml(product.short_description || product.description || "")}`);
  if (text.includes("kompatibil") || text.includes("alternat")) return { key: "compatible", label: "KOMPATIBILNÝ", detailLabel: "Kompatibilný spotrebný materiál", note: "Overená alternatíva", icon: "puzzle" };
  if (text.includes("original") || text.includes("originalny") || text.includes("originalna") || text.includes("originalne") || text.includes("originál")) return { key: "original", label: "ORIGINÁL", detailLabel: "Originálny spotrebný materiál", note: "Originálny produkt výrobcu", icon: "shield" };
  if (text.includes("renovovan") || text.includes("repasovan")) return { key: "renovated", label: "RENOVOVANÝ", detailLabel: "Renovovaný spotrebný materiál", note: "Ekologicky renovovaný produkt", icon: "recycle" };
  return { key: "product", label: "PRODUKT", detailLabel: "Spotrebný materiál", note: "Spotrebný materiál", icon: "dot" };
}

function detectColor(product: any) {
  const text = normalize(`${product.name || ""} ${stripHtml(product.short_description || product.description || "")}`);
  if (text.includes("black") || text.includes("cierna") || text.includes("čierna")) return "Čierna";
  if (text.includes("cyan") || text.includes("azurov") || text.includes("azúrov")) return "Azúrová";
  if (text.includes("magenta") || text.includes("purpurov")) return "Purpurová";
  if (text.includes("yellow") || text.includes("zlt") || text.includes("žlt")) return "Žltá";
  if (text.includes("cmyk") || text.includes("multipack")) return "CMYK";
  return "";
}

function detectYield(product: any) {
  const text = `${product.name || ""} ${stripHtml(product.short_description || product.description || "")}`;
  const match = text.match(/(\d[\d\s]{2,})\s*(strán|stran|pages|page)/i);
  return match ? `${match[1].replace(/\s+/g, " ").trim()} strán` : "";
}

function typeRank(key: string) {
  if (key === "compatible") return 0;
  if (key === "original") return 1;
  if (key === "renovated") return 2;
  return 3;
}

export function sortProducts(products: TmProduct[]) {
  return [...products].sort((a, b) => {
    const rank = typeRank(a.product_type_key) - typeRank(b.product_type_key);
    if (rank !== 0) return rank;
    const stockA = a.stock_status === "instock" ? 0 : 1;
    const stockB = b.stock_status === "instock" ? 0 : 1;
    if (stockA !== stockB) return stockA - stockB;
    return String(a.name || "").localeCompare(String(b.name || ""), "sk");
  });
}

export function mapProduct(product: any): TmProduct {
  const type = detectType(product);
  const description = product.description || "";
  const shortDescription = product.short_description || "";
  const compatiblePrinters = extractPrinters(product);
  const categories = Array.isArray(product.categories) ? product.categories.map((cat: any) => ({ id: cat.id, name: cat.name, slug: cat.slug })) : [];
  const tagText = Array.isArray(product.tags) ? product.tags.map((tag: any) => `${tag.name || ""} ${tag.slug || ""}`).join(" ") : "";
  const categoryText = categories.map((cat: any) => `${cat.name || ""} ${cat.slug || ""}`).join(" ");
  const plainText = stripHtml(`${shortDescription}\n${description}`);
  const searchableText = normalize(`${product.name || ""} ${product.sku || ""} ${categoryText} ${tagText} ${plainText} ${compatiblePrinters.join(" ")}`);
  return {
    id: product.id,
    sku: product.sku || "",
    name: product.name || "",
    slug: product.slug || "",
    price: cleanPrice(product.price),
    regular_price: cleanPrice(product.regular_price),
    sale_price: cleanPrice(product.sale_price),
    stock_quantity: product.stock_quantity ?? null,
    stock_status: product.stock_status || "",
    image: product.images?.[0]?.src || "",
    images: Array.isArray(product.images) ? product.images.map((img: any) => img.src).filter(Boolean) : [],
    detail_url: `/produkt/${product.slug || product.id}`,
    description_html: description,
    short_description_html: shortDescription,
    description: stripHtml(shortDescription || description || ""),
    product_type_key: type.key,
    product_type_label: type.label,
    product_type_detail_label: type.detailLabel,
    product_type_note: type.note,
    product_type_icon: type.icon,
    color: detectColor(product),
    yield: detectYield(product),
    compatible_printers: compatiblePrinters,
    printers: compatiblePrinters,
    categories,
    search_text: searchableText,
  };
}

function isFresh(cache: CacheFile) {
  const generated = new Date(cache.generated_at).getTime();
  return Number.isFinite(generated) && Date.now() - generated < CACHE_TTL_MS;
}

function parseCacheFile(text: string): CacheFile | null {
  try {
    const data = JSON.parse(text) as CacheFile;
    if (!data || data.version !== CACHE_VERSION || !Array.isArray(data.products)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function readProductsCache(): Promise<CacheFile | null> {
  if (globalStore.__TM_PRODUCTS_FILE_CACHE__) return globalStore.__TM_PRODUCTS_FILE_CACHE__;

  for (const file of FALLBACK_CACHE_FILES) {
    try {
      const text = await readFile(file, "utf8");
      const data = parseCacheFile(text);
      if (!data) continue;
      globalStore.__TM_PRODUCTS_FILE_CACHE__ = data;
      return data;
    } catch {
      // skús ďalší fallback
    }
  }

  return null;
}

function parseWooPayload(text: string) {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`WooCommerce nevrátil JSON: ${text.slice(0, 300)}`);
  }

  // Niektoré hostingy/proxy vrátia JSON zabalený ešte raz ako string: "[{...}]".
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error(`WooCommerce vrátil JSON string, ale nie pole produktov: ${data.slice(0, 300)}`);
    }
  }

  return data;
}

async function fetchWithTimeout(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WOO_SYNC_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWooProductsPage(wooUrl: string, page: number) {
  const params = new URLSearchParams({
    per_page: String(WOO_SYNC_PER_PAGE),
    page: String(page),
    status: "publish",
    orderby: "menu_order",
    order: "asc",
    _fields: WOO_FIELDS,
  });

  const url = `${wooUrl}/wp-json/wc/v3/products?${params.toString()}`;
  const headers = {
    Authorization: getAuthHeader(),
    Accept: "application/json",
    "User-Agent": "ToneryMaxim-Sync/1.0",
  };

  let lastError: any;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, headers);
      const text = await response.text();
      const data = parseWooPayload(text);

      if (!response.ok) {
        throw new Error(`WooCommerce API chyba ${response.status} na strane ${page}: ${JSON.stringify(data).slice(0, 300)}`);
      }

      if (!Array.isArray(data)) {
        throw new Error(`WooCommerce nevrátil pole produktov na strane ${page}: ${JSON.stringify(data).slice(0, 300)}`);
      }

      return {
        products: data,
        totalPages: Number(response.headers.get("x-wp-totalpages") || 0),
        total: Number(response.headers.get("x-wp-total") || 0),
      };
    } catch (error: any) {
      lastError = error;
      const message = String(error?.message || "");
      const retryable = /503|502|504|429|timeout|AbortError/i.test(message);
      if (!retryable || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }

  throw lastError || new Error(`WooCommerce stránka ${page} zlyhala.`);
}

async function fetchAllWooProducts() {
  const wooUrl = env("WOO_URL").replace(/\/$/, "");
  const key = env("WOO_CONSUMER_KEY");
  const secret = env("WOO_CONSUMER_SECRET");
  if (!wooUrl || !key || !secret) throw new Error("Chýba WOO_URL, WOO_CONSUMER_KEY alebo WOO_CONSUMER_SECRET v .env");

  const all: any[] = [];
  let page = 1;
  let reportedTotalPages = 0;
  let reportedTotal = 0;

  while (page <= WOO_SYNC_MAX_PAGES) {
    const result = await fetchWooProductsPage(wooUrl, page);
    reportedTotalPages = result.totalPages || reportedTotalPages;
    reportedTotal = result.total || reportedTotal;

    if (!result.products.length) break;
    all.push(...result.products);

    if (reportedTotalPages && page >= reportedTotalPages) break;
    if (!reportedTotalPages && result.products.length < WOO_SYNC_PER_PAGE) break;

    page += 1;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return { products: all, pages: page, reportedTotalPages, reportedTotal };
}

export async function syncProductsCache(options: { force?: boolean } = {}) {
  const current = await readProductsCache();
  if (!options.force && current && isFresh(current)) return { cache: current, refreshed: false };

  let raw: Awaited<ReturnType<typeof fetchAllWooProducts>>;
  try {
    raw = await fetchAllWooProducts();
  } catch (error: any) {
    if (current?.products?.length) {
      return {
        cache: current,
        refreshed: false,
        warning: `Woo sync zlyhal, ponechaná posledná funkčná cache: ${error?.message || String(error)}`,
      };
    }
    throw error;
  }

  if (raw.products.length < MIN_SAFE_PRODUCTS) {
    const message = `Woo sync vrátil iba ${raw.products.length} produktov. Očakávam minimálne ${MIN_SAFE_PRODUCTS}. Cache sa neprepísala.`;
    if (current?.products?.length) return { cache: current, refreshed: false, warning: message };
    throw new Error(message);
  }

  const products = sortProducts(raw.products.map(mapProduct));
  const next: CacheFile = { ok: true, version: CACHE_VERSION, generated_at: new Date().toISOString(), total: products.length, products };

  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, CACHE_FILE);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }

  globalStore.__TM_PRODUCTS_FILE_CACHE__ = next;
  return { cache: next, refreshed: true, sync: raw };
}

export async function getProductsCache() {
  const current = await readProductsCache();
  if (current) return current;
  return (await syncProductsCache({ force: true })).cache;
}

function matchesCategory(product: TmProduct, category: string) {
  if (!category) return true;
  const text = product.search_text || "";
  if (category === "tonery") return text.includes("toner") && !text.includes("valec") && !text.includes("drum") && !text.includes("optick");
  if (category === "atramentove-naplne") return text.includes("atrament") || text.includes("ink") || text.includes("napln") || text.includes("nápln") || text.includes("naplne") || text.includes("cartridge");
  if (category === "opticke-valce") return text.includes("optick") || text.includes("valec") || text.includes("drum") || text.includes("opc");
  if (category === "ostatne-komponenty") return text.includes("fuser") || text.includes("zapek") || text.includes("odpad") || text.includes("waste") || text.includes("unit") || text.includes("komponent") || text.includes("maintenance");
  return text.includes(normalize(category));
}

export function filterProducts(products: TmProduct[], filters: { search?: string; brand?: string; category?: string; type?: string; printer?: string; color?: string; stock?: string }) {
  const search = normalize(filters.search || "");
  const compactSearch = compactKey(filters.search || "");
  const brand = normalize(filters.brand || "");
  const printer = normalize(filters.printer || "");
  const color = normalize(filters.color || "");
  const stock = normalize(filters.stock || "");

  return products.filter((product) => {
    const text = product.search_text || normalize(`${product.name || ""} ${product.sku || ""}`);
    if (filters.type && product.product_type_key !== filters.type) return false;
    if (stock === "instock" && product.stock_status !== "instock") return false;
    if (stock === "expedujeme-dnes" && product.stock_status !== "instock") return false;
    if (stock === "10plus" && Number(product.stock_quantity || 0) < 10) return false;
    if (color) {
      const productColor = normalize(product.color || "");
      const textForColor = product.search_text || normalize(`${product.name || ""} ${product.sku || ""}`);
      const isBlack = color === "cierna" && (productColor.includes("cier") || productColor.includes("black") || textForColor.includes("black"));
      const isCyan = color === "cyan" && (productColor.includes("cyan") || productColor.includes("azur") || textForColor.includes("cyan"));
      const isMagenta = color === "purpurova" && (productColor.includes("purp") || productColor.includes("magenta") || textForColor.includes("magenta"));
      const isYellow = color === "yellow" && (productColor.includes("yellow") || productColor.includes("zlt") || textForColor.includes("yellow"));
      const isMultipack = color === "multipack" && (productColor.includes("cmyk") || productColor.includes("multi") || textForColor.includes("multipack") || textForColor.includes("cmyk"));
      if (!(isBlack || isCyan || isMagenta || isYellow || isMultipack)) return false;
    }
    if (brand) {
      if (brand === "hp") { if (!/\bhp\b/.test(text) && !text.includes("hewlett packard")) return false; }
      else if (!text.includes(brand)) return false;
    }
    if (filters.category && !matchesCategory(product, filters.category)) return false;
    if (printer && !text.includes(printer)) return false;
    if (search && !text.includes(search) && !compactKey(text).includes(compactSearch)) return false;
    return true;
  });
}

export function jsonResponse(body: unknown, status = 200, cacheHeader = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400") {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheHeader } });
}
