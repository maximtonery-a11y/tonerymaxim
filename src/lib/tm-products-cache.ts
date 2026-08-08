import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TM_CACHE_ROOT } from './runtime-paths.ts';
import { analyzeCatalogQuery, exactPrinterModelMatch, findExactPrinterModelMatches, findExactProductIdentityMatches, productPrinterValues } from './catalog-query.ts';
import { normalizedCompletenessRatio, requiredProductCount } from './product-cache-policy.ts';

export type TmProduct = Record<string, any>;

type CacheFile = {
  ok: true;
  version: number;
  generated_at: string;
  total: number;
  woo_reported_total?: number;
  products: TmProduct[];
};

type ProductsSyncResult = {
  cache: CacheFile;
  refreshed: boolean;
  warning?: string;
  sync?: Awaited<ReturnType<typeof fetchAllWooProducts>>;
};

const CACHE_VERSION = 3;
const CACHE_DIR = TM_CACHE_ROOT;
const CACHE_FILE = path.join(CACHE_DIR, "products.json");
const FALLBACK_CACHE_FILES = [
  CACHE_FILE,
  path.join(process.cwd(), "src", "data", "products-cache.json"),
  path.join(process.cwd(), "public", "data", "products-cache.json"),
  path.join(process.cwd(), "dist", "client", "data", "products-cache.json"),
  path.join(process.cwd(), "data", "products-cache.json"),
];
const MIN_SAFE_PRODUCTS = Number(env("WOO_SYNC_MIN_PRODUCTS") || 100);
// Pevný počet produktov nesmie zablokovať prvé načítanie katalógu.
// Ak WooCommerce pošle X-WP-Total, úplnosť kontrolujeme voči tomuto
// reálnemu počtu. Voliteľné minimum sa dá nastaviť v Coolify.
const EXPECTED_MIN_PRODUCTS = Math.max(0, Number(env("WOO_SYNC_EXPECTED_MIN_PRODUCTS") || 0));
const COMPLETENESS_RATIO = normalizedCompletenessRatio(env("WOO_SYNC_COMPLETENESS_RATIO") || 0.99);
const WOO_SYNC_PER_PAGE = Math.min(100, Math.max(10, Number(env("WOO_SYNC_PER_PAGE") || 100)));
const WOO_SYNC_TIMEOUT_MS = Math.min(60000, Math.max(8000, Number(env("WOO_SYNC_TIMEOUT_MS") || 25000)));
const WOO_SYNC_MAX_PAGES = Math.min(1000, Math.max(1, Number(env("WOO_SYNC_MAX_PAGES") || 500)));
const CACHE_TTL_MS = Math.max(5 * 60_000, Number(env("WOO_CACHE_TTL_MS") || 60 * 60_000));
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
  "date_modified",
  "date_modified_gmt",
  "global_unique_id",
  "brands",
  "images",
  "description",
  "short_description",
  "categories",
  "tags",
  "attributes",
  "meta_data",
].join(",");

const globalStore = globalThis as typeof globalThis & {
  __TM_PRODUCTS_FILE_CACHE__?: CacheFile;
  __TM_PRODUCTS_LOOKUP_INDEX__?: {
    generatedAt: string;
    byId: Map<string, TmProduct>;
    bySlug: Map<string, TmProduct>;
  };
  __TM_PRODUCTS_SYNC_PROMISE__?: Promise<ProductsSyncResult>;
  __TM_PRODUCTS_WARM_PROMISE__?: Promise<void>;
  __TM_PRODUCTS_WARM_STARTED_AT__?: number;
};

const TM_PRODUCT_PLACEHOLDER_IMAGE = "/images/tm-product-placeholder-box.jpg";
const TM_INK_PLACEHOLDER_IMAGE = "/images/tm-ink-placeholder-box.jpg";

const TM_TONER_GENERIC_IMAGE_PATTERNS = [
  "toner-coloriq-kompatible",
  "toner-coloriq-renovacie",
  "drum-compatible",
  "remanufactured-drum",
  "image-coming-soon",
  "no-image",
  "image-placeholder",
];

const TM_INK_GENERIC_IMAGE_PATTERNS = [
  "ink-remanufactured",
  "ink-remanufactured.png",
  "compatible-ink-coloriq",
  "compatible-ink-coloriq.png",
];

function normalizeImageName(value: unknown) {
  const raw = String(value || "").trim();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  const fileName = decoded
    .split(/[?#]/)[0]
    .split(/[\/]/)
    .pop() || decoded;

  return fileName
    .toLowerCase()
    .replace(/\.(webp|avif|jpe?g|png)$/i, "")
    .replace(/-\d+x\d+$/i, "")
    .replace(/[_\s]+/g, "-")
    .trim();
}

function imageMatchesPattern(imageUrl: string, patterns: string[]) {
  const imageName = normalizeImageName(imageUrl);
  const normalizedUrl = normalizeImageName(String(imageUrl || "").toLowerCase());

  return patterns.some((pattern) => {
    const key = normalizeImageName(pattern);
    return imageName === key || imageName.includes(key) || normalizedUrl.includes(key);
  });
}

function isInkProduct(product: any) {
  const categoryText = Array.isArray(product?.categories)
    ? product.categories.map((cat: any) => `${cat?.name || ""} ${cat?.slug || ""}`).join(" ")
    : "";
  const attrText = Array.isArray(product?.attributes)
    ? product.attributes.map((attr: any) => `${attr?.name || ""} ${attr?.slug || ""} ${Array.isArray(attr?.options) ? attr.options.join(" ") : ""}`).join(" ")
    : "";
  const text = normalize(`${product?.name || ""} ${product?.slug || ""} ${product?.sku || ""} ${categoryText} ${attrText}`);
  return text.includes("atrament") || text.includes("ink") || text.includes("napln") || text.includes("naplne") || text.includes("kazeta") || text.includes("cartridge");
}

function normalizeProductImageUrl(value: unknown, product?: any) {
  const url = String(value || "").trim();
  const inkProduct = isInkProduct(product);
  if (!url) return inkProduct ? TM_INK_PLACEHOLDER_IMAGE : TM_PRODUCT_PLACEHOLDER_IMAGE;

  const normalizedUrl = normalizeImageName(url);
  const normalizedFull = String(url || "").toLowerCase();

  // Už nahradené lokálne obrázky nikdy neposielame späť cez generické pravidlá.
  if (normalizedUrl.includes("tm-ink-placeholder-box") || normalizedFull.includes("tm-ink-placeholder-box")) return TM_INK_PLACEHOLDER_IMAGE;
  if ((normalizedUrl.includes("tm-product-placeholder-box") || normalizedFull.includes("tm-product-placeholder-box")) && inkProduct) return TM_INK_PLACEHOLDER_IMAGE;
  if (normalizedUrl.includes("tm-product-placeholder-box") || normalizedFull.includes("tm-product-placeholder-box")) return TM_PRODUCT_PLACEHOLDER_IMAGE;

  // Atramentové ColorIQ placeholdery: stačí slovné spojenie kdekoľvek v URL/názve.
  if (
    normalizedUrl.includes("ink-remanufactured") ||
    normalizedFull.includes("ink-remanufactured") ||
    normalizedUrl.includes("compatible-ink-coloriq") ||
    normalizedFull.includes("compatible-ink-coloriq")
  ) {
    return TM_INK_PLACEHOLDER_IMAGE;
  }

  if (imageMatchesPattern(url, TM_INK_GENERIC_IMAGE_PATTERNS)) return TM_INK_PLACEHOLDER_IMAGE;
  if (imageMatchesPattern(url, TM_TONER_GENERIC_IMAGE_PATTERNS)) return TM_PRODUCT_PLACEHOLDER_IMAGE;
  return url;
}

function normalizeProductImages(images: unknown, product?: any) {
  const values = Array.isArray(images)
    ? images.map((img: any) => normalizeProductImageUrl(img?.src || img?.url || img, product)).filter(Boolean)
    : [];
  const unique = uniqueStrings(values, 1).filter(Boolean);
  if (unique.length) return unique;
  return [isInkProduct(product) ? TM_INK_PLACEHOLDER_IMAGE : TM_PRODUCT_PLACEHOLDER_IMAGE];
}


function env(name: string) {
  const buildEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  return String(process.env[name] || buildEnv?.[name] || "").trim();
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


function cleanAttributeName(value: unknown) {
  return String(value || "")
    .replace(/^pa[_-]/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAttributeValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const obj = value as any;
    return cleanAttributeValue(obj.name ?? obj.label ?? obj.value ?? obj.option ?? obj.title ?? "");
  }
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWooAttributeName(value: unknown) {
  return compactKey(cleanAttributeName(value));
}

function normalizeAttributeValues(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map(cleanAttributeValue).filter(Boolean), 1);
  const clean = cleanAttributeValue(value);
  if (!clean) return [];
  return uniqueStrings(clean.split(/\s*[,;|]\s*/).map(cleanAttributeValue).filter(Boolean), 1);
}

function extractWooAttributes(product: any) {
  const out: Array<{
    id?: number;
    name: string;
    slug: string;
    values: string[];
    value: string;
    options?: string[];
    visible?: boolean;
    variation?: boolean;
  }> = [];
  const seen = new Set<string>();
  const attributes = Array.isArray(product?.attributes) ? product.attributes : [];

  attributes.forEach((attribute: any) => {
    const name = cleanAttributeName(attribute?.name || attribute?.slug || "");
    if (!name) return;
    const values = normalizeAttributeValues(attribute?.options ?? attribute?.option ?? attribute?.value);
    if (!values.length) return;
    const slug = normalizeWooAttributeName(attribute?.slug || name);
    const key = `${slug}:${values.map(compactKey).join('|')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: attribute?.id,
      name,
      slug,
      values,
      value: values.join(", "),
      options: values,
      visible: attribute?.visible,
      variation: attribute?.variation,
    });
  });

  return out;
}

function attributeNameMatches(attribute: { name: string; slug: string }, aliases: string[]) {
  const name = normalizeWooAttributeName(attribute.name);
  const slug = normalizeWooAttributeName(attribute.slug);
  return aliases.some((alias) => {
    const key = compactKey(alias);
    return name === key || slug === key || name.includes(key) || slug.includes(key);
  });
}

function getWooAttributeValue(attributes: ReturnType<typeof extractWooAttributes>, aliases: string[]) {
  const found = attributes.find((attribute) => attributeNameMatches(attribute, aliases));
  return found?.value || "";
}

function getExactWooAttributeValue(attributes: ReturnType<typeof extractWooAttributes>, aliases: string[]) {
  const keys = new Set(aliases.map(compactKey));
  const found = attributes.find((attribute) => (
    keys.has(normalizeWooAttributeName(attribute.name))
    || keys.has(normalizeWooAttributeName(attribute.slug))
  ));
  return found?.value || "";
}

function getWooMetaValue(product: any, aliases: string[]) {
  const keys = new Set(aliases.map(compactKey));
  const meta = Array.isArray(product?.meta_data) ? product.meta_data : [];
  const found = meta.find((item: any) => keys.has(compactKey(item?.key || "")));
  return cleanAttributeValue(found?.value);
}

function normalizeWooColor(value: string) {
  const text = normalize(value);
  const compact = compactKey(value);
  if (!text) return "";
  if (compact === "k" || text.includes("black") || text.includes("cierna") || text.includes("čierna")) return "Čierna";
  if (compact === "c" || text.includes("cyan") || text.includes("azurov") || text.includes("azúrov")) return "Azúrová";
  if (compact === "m" || text.includes("magenta") || text.includes("purpurov")) return "Purpurová";
  if (compact === "y" || text.includes("yellow") || text.includes("zlta") || text.includes("žlta") || text.includes("zlt") || text.includes("žlt")) return "Žltá";
  if (text.includes("cmyk") || text.includes("multipack") || /^(c|m|y|k){2,}$/i.test(compact)) return value.toUpperCase();
  return value;
}

function normalizeWooCapacity(value: string) {
  const clean = cleanAttributeValue(value);
  if (!clean) return "";
  const lower = normalize(clean);
  if (/\b(stran|strán|pages?|ml)\b/i.test(clean)) return clean;
  if (/^\d[\d\s.,]*$/.test(clean)) return `${clean.replace(/\s+/g, " ").trim()} strán`;
  if (lower.includes("stran") || lower.includes("page")) return clean;
  return clean;
}

const DEFAULT_WARRANTY = "24 mesiacov";

function isMissingValue(value: unknown) {
  const normalized = normalize(String(value || ""));
  return !normalized || normalized === "neuvedene" || normalized === "neuvedena" || normalized === "n/a" || normalized === "na" || normalized === "nezname" || normalized === "neznamy" || normalized === "null" || normalized === "undefined";
}

function normalizeWooWarranty(value: string) {
  const clean = cleanAttributeValue(value);
  if (isMissingValue(clean)) return DEFAULT_WARRANTY;
  return clean;
}

function ensureDefaultWarrantyAttribute(attributes: ReturnType<typeof extractWooAttributes>) {
  const result = attributes.map((attribute) => ({ ...attribute }));
  const warranty = result.find((attribute) => normalize(attribute.name).replace(/[^a-z0-9]+/g, "") === "zaruka" || normalize(attribute.name).replace(/[^a-z0-9]+/g, "") === "warranty");

  if (warranty) {
    if (isMissingValue(warranty.value)) warranty.value = DEFAULT_WARRANTY;
    if (Array.isArray(warranty.options)) {
      warranty.options = warranty.options.length ? warranty.options.map((option: unknown) => isMissingValue(option) ? DEFAULT_WARRANTY : String(option)) : [DEFAULT_WARRANTY];
    }
    return result;
  }

  result.push({
    id: 0,
    name: "Záruka",
    slug: "zaruka",
    values: [DEFAULT_WARRANTY],
    value: DEFAULT_WARRANTY,
    options: [DEFAULT_WARRANTY],
  });
  return result;
}

function wooAttributeText(attributes: ReturnType<typeof extractWooAttributes>) {
  return attributes.map((attribute) => `${attribute.name} ${attribute.value}`).join(" ");
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

function isMissingAttribute(value: unknown) {
  const text = normalize(value);
  return !text || text === "neuvedene" || text === "neuvedena" || text === "n/a" || text === "nezname" || text === "neznamy";
}

function normalizeStrictOemCode(raw: string) {
  let code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 4) return "";

  // Slovné farby v názvoch typu "TN-426 Black" nepatria do OEM.
  code = code.replace(/(BLACK|CYAN|MAGENTA|YELLOW|CIERNA|AZUROVA|PURPUROVA|ZLTA)$/i, "");

  // Jednopísmenové farebné koncovky pri toneroch/kazetách sa považujú za rovnakú OEM sériu:
  // TN-426K / TN-426C / TN-426M / TN-426Y -> TN426.
  // Dôležité: XL/XXL sa NESMIE odstraňovať, aby sa TN-426 a TN-426XL nemiešali.
  if (/^(TN|DR|LC|CLI|PGI|PG|CL|CRG|CF|CE|W|Q|TK|MLT|CLT|T)\d{2,6}[KCMY]$/.test(code)) {
    code = code.slice(0, -1);
  }

  return code.length >= 4 ? code.toLowerCase() : "";
}

function extractStrictOemKeys(value: unknown) {
  const source = String(value || "").toUpperCase();
  const keys: string[] = [];

  // Iba reálne OEM kódy, nie názvy tlačiarní/modely typu HL-L8360CDW.
  const patterns = [
    /\b(?:TN|DR|LC|CLI|PGI|PG|CL|CRG|CF|CE|W|Q|TK|MLT|CLT|T)[\s-]*\d{2,6}(?:[\s-]*(?:[A-Z]{1,3}|BLACK|CYAN|MAGENTA|YELLOW|CIERNA|AZUROVA|PURPUROVA|ZLTA))?\b/g,
    /\b(?:C13T|C13S)\d{4,12}\b/g,
  ];

  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      const key = normalizeStrictOemCode(match[0]);
      if (key) keys.push(key);
    }
  });

  return uniqueStrings(keys, 4).slice(0, 6);
}

function productOemKeys(product: TmProduct) {
  // Prísne len názov + SKU. Nepoužívame search_text ani kompatibilné tlačiarne,
  // lebo tam sú často modely tlačiarní a texty, ktoré by spojili nesúvisiace produkty.
  return extractStrictOemKeys(`${product.name || ""} ${product.sku || ""}`);
}

function mergeSearchText(product: TmProduct) {
  product.search_text = normalize(`${product.search_text || ""} ${product.color || ""} ${product.capacity || ""} ${product.yield || ""} ${(product.compatible_printers || []).join(" ")}`);
}

function selectRelatedProducts(product: TmProduct, byOem: Map<string, TmProduct[]>) {
  const related = new Map<string, TmProduct>();
  productOemKeys(product).forEach((key) => {
    (byOem.get(key) || []).forEach((item) => {
      if (item.id !== product.id) related.set(String(item.id || item.slug || item.name), item);
    });
  });
  return [...related.values()];
}

function bestRelatedValue(product: TmProduct, related: TmProduct[], field: "capacity" | "yield" | "page_yield") {
  const productColor = normalize(product.color || product.farba || "");
  const productType = product.product_type_key || "";
  const candidates = related
    .map((item) => {
      const value = item[field] || item.capacity || item.yield || item.page_yield || "";
      if (isMissingAttribute(value)) return null;
      let score = 0;
      const itemColor = normalize(item.color || item.farba || "");
      if (productColor && itemColor === productColor) score += 1000;
      if (productType && item.product_type_key === productType) score += 200;
      const printerCount = Array.isArray(item.compatible_printers) ? item.compatible_printers.length : 0;
      if (printerCount > 0 && printerCount <= 20) score += 50;
      if (printerCount > 20) score -= 200;
      return { value: String(value), score };
    })
    .filter(Boolean) as Array<{ value: string; score: number }>;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value || "";
}

function bestRelatedPrinters(product: TmProduct, related: TmProduct[]) {
  const productColor = normalize(product.color || product.farba || "");
  const productType = product.product_type_key || "";
  const candidates = related
    .map((item) => {
      const printers = Array.isArray(item.compatible_printers) ? item.compatible_printers : Array.isArray(item.printers) ? item.printers : [];
      const cleanPrinters = uniqueStrings(printers.map(String).filter(Boolean)).slice(0, 30);
      if (!cleanPrinters.length || cleanPrinters.length > 20) return null;

      let score = 0;
      const itemColor = normalize(item.color || item.farba || "");
      if (productColor && itemColor === productColor) score += 1000;
      if (productType && item.product_type_key === productType) score += 200;
      // Uprednostni konkrétny zdroj s menším počtom modelov, nie spájanie všetkého dokopy.
      if (cleanPrinters.length <= 10) score += 100;
      if (cleanPrinters.length > 20) score -= 500;
      score -= cleanPrinters.length;

      return { printers: cleanPrinters, score };
    })
    .filter(Boolean) as Array<{ printers: string[]; score: number }>;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.printers || [];
}


function enrichProductsFromRelated(products: TmProduct[]) {
  const byOem = new Map<string, TmProduct[]>();

  products.forEach((product) => {
    productOemKeys(product).forEach((key) => {
      const list = byOem.get(key) || [];
      list.push(product);
      byOem.set(key, list);
    });
  });

  products.forEach((product) => {
    if (isMissingAttribute(product.color || product.farba)) {
      const color = detectColor(product);
      if (color) {
        product.color = color;
        product.farba = color;
      }
    }

    const related = selectRelatedProducts(product, byOem);
    if (!related.length) {
      mergeSearchText(product);
      return;
    }

    if (isMissingAttribute(product.capacity || product.kapacita || product.yield || product.page_yield)) {
      const capacity = bestRelatedValue(product, related, "capacity");
      if (capacity) {
        product.capacity = capacity;
        product.kapacita = capacity;
        product.yield = capacity;
        product.page_yield = capacity;
      }
    }

    const currentPrinters = Array.isArray(product.compatible_printers) ? product.compatible_printers : [];
    if (!currentPrinters.length) {
      const printers = bestRelatedPrinters(product, related);
      if (printers.length) {
        product.compatible_printers = printers;
        product.printers = printers;
      }
    }

    mergeSearchText(product);
  });

  return products;
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
  const wooAttributes = ensureDefaultWarrantyAttribute(extractWooAttributes(product));
  const warrantyValue = normalizeWooWarranty(getWooAttributeValue(wooAttributes, ["Záruka", "Zaruka", "Warranty"]));
  const compatiblePrinters = extractPrinters(product);
  const categories = Array.isArray(product.categories) ? product.categories.map((cat: any) => ({ id: cat.id, name: cat.name, slug: cat.slug })) : [];
  const tagText = Array.isArray(product.tags) ? product.tags.map((tag: any) => `${tag.name || ""} ${tag.slug || ""}`).join(" ") : "";
  const categoryText = categories.map((cat: any) => `${cat.name || ""} ${cat.slug || ""}`).join(" ");
  const plainText = stripHtml(`${shortDescription}\n${description}`);
  const searchableText = normalize(`${product.name || ""} ${product.sku || ""} ${categoryText} ${tagText} ${wooAttributeText(wooAttributes)} ${plainText} ${compatiblePrinters.join(" ")}`);
  const normalizedImages = normalizeProductImages(product.images, product);
  const primaryImage = normalizedImages[0] || TM_PRODUCT_PLACEHOLDER_IMAGE;
  const taxonomyBrand = Array.isArray(product.brands)
    ? cleanAttributeValue(product.brands.find((brand: any) => brand?.name)?.name)
    : "";
  const productBrand = taxonomyBrand
    || getExactWooAttributeValue(wooAttributes, [
      "Značka produktu",
      "Znacka produktu",
      "Výrobca produktu",
      "Vyrobca produktu",
      "Product brand",
      "Product manufacturer",
    ])
    || getWooMetaValue(product, ["product_brand", "_product_brand", "manufacturer_brand"]);
  const gtin = cleanAttributeValue(product.global_unique_id)
    || getExactWooAttributeValue(wooAttributes, ["GTIN", "EAN", "UPC"])
    || getWooMetaValue(product, [
      "gtin",
      "_gtin",
      "ean",
      "_ean",
      "_alg_ean",
      "_wpm_gtin_code",
      "_wc_gla_gtin",
      "_global_unique_id",
    ]);
  const mpn = getExactWooAttributeValue(wooAttributes, [
    "MPN",
    "Manufacturer Part Number",
    "Kód výrobcu produktu",
    "Kod vyrobcu produktu",
  ]) || getWooMetaValue(product, ["mpn", "_mpn", "manufacturer_part_number"]);
  // GPSR údaje musia pochádzať z katalógu. Neodvodzujeme ich zo značky
  // tlačiarne ani ich nenahrádzame všeobecným textom výrobcu tonerov.
  const manufacturerName = getExactWooAttributeValue(wooAttributes, [
    "Výrobca produktu",
    "Product manufacturer",
    "GPSR výrobca",
    "GPSR manufacturer",
  ]) || getWooMetaValue(product, [
    "gpsr_manufacturer_name",
    "product_manufacturer_name",
    "manufacturer_name",
  ]);
  const manufacturerAddress = getExactWooAttributeValue(wooAttributes, [
    "Adresa výrobcu",
    "Manufacturer address",
    "GPSR adresa výrobcu",
  ]) || getWooMetaValue(product, [
    "gpsr_manufacturer_address",
    "product_manufacturer_address",
    "manufacturer_address",
  ]);
  const manufacturerContact = getExactWooAttributeValue(wooAttributes, [
    "Kontakt výrobcu",
    "E-mail výrobcu",
    "Manufacturer contact",
    "Manufacturer email",
  ]) || getWooMetaValue(product, [
    "gpsr_manufacturer_contact",
    "gpsr_manufacturer_email",
    "manufacturer_contact",
    "manufacturer_email",
  ]);
  const euResponsiblePerson = getExactWooAttributeValue(wooAttributes, [
    "Zodpovedná osoba EÚ",
    "Zodpovedný hospodársky subjekt EÚ",
    "EU responsible person",
    "EU responsible economic operator",
  ]) || getWooMetaValue(product, [
    "gpsr_eu_responsible_person",
    "eu_responsible_person",
    "responsible_person_eu",
  ]);
  const safetyInformation = getExactWooAttributeValue(wooAttributes, [
    "Bezpečnostné informácie",
    "Bezpečnostné upozornenie",
    "Safety information",
    "Safety warning",
    "Upozornenie",
  ]) || getWooMetaValue(product, [
    "gpsr_safety_information",
    "product_safety_information",
    "safety_information",
    "safety_warning",
  ]);
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
    date_modified: product.date_modified || "",
    date_modified_gmt: product.date_modified_gmt || "",
    gtin,
    mpn,
    product_brand: productBrand,
    manufacturer_name: manufacturerName,
    manufacturer_address: manufacturerAddress,
    manufacturer_contact: manufacturerContact,
    eu_responsible_person: euResponsiblePerson,
    safety_information: safetyInformation,
    image: primaryImage,
    images: normalizedImages.length ? normalizedImages : [TM_PRODUCT_PLACEHOLDER_IMAGE],
    detail_url: `/produkt/${product.slug || product.id}`,
    description_html: description,
    short_description_html: shortDescription,
    description: stripHtml(shortDescription || description || ""),
    product_type_key: type.key,
    product_type_label: type.label,
    product_type_detail_label: type.detailLabel,
    product_type_note: type.note,
    product_type_icon: type.icon,
    attributes: wooAttributes,
    attributes_all: wooAttributes,
    color: normalizeWooColor(getWooAttributeValue(wooAttributes, ["Farba", "Color", "Colour", "Barva"])) || detectColor(product),
    farba: normalizeWooColor(getWooAttributeValue(wooAttributes, ["Farba", "Color", "Colour", "Barva"])) || detectColor(product),
    capacity: normalizeWooCapacity(getWooAttributeValue(wooAttributes, ["Kapacita", "Výťažnosť", "Vytaznost", "Počet strán", "Pocet stran", "Page yield", "Yield", "Pages", "Objem", "ML"])),
    kapacita: normalizeWooCapacity(getWooAttributeValue(wooAttributes, ["Kapacita", "Výťažnosť", "Vytaznost", "Počet strán", "Pocet stran", "Page yield", "Yield", "Pages", "Objem", "ML"])),
    yield: normalizeWooCapacity(getWooAttributeValue(wooAttributes, ["Kapacita", "Výťažnosť", "Vytaznost", "Počet strán", "Pocet stran", "Page yield", "Yield", "Pages", "Objem", "ML"])),
    page_yield: normalizeWooCapacity(getWooAttributeValue(wooAttributes, ["Kapacita", "Výťažnosť", "Vytaznost", "Počet strán", "Pocet stran", "Page yield", "Yield", "Pages"])),
    warranty: warrantyValue,
    zaruka: warrantyValue,
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
    if (
      !data
      || data.version !== CACHE_VERSION
      || !Array.isArray(data.products)
      || data.products.length < 1
      || Number(data.total || 0) !== data.products.length
    ) return null;
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

export function normalizeWooSiteUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("WOO_URL nie je platná absolútna URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("WOO_URL musí začínať http:// alebo https://.");
  }

  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname
    .replace(/\/wp-json\/wc\/v3\/products\/?$/i, "")
    .replace(/\/wp-json\/wc\/v3\/?$/i, "")
    .replace(/\/wp-json\/?$/i, "")
    .replace(/\/+$/, "");

  return parsed.toString().replace(/\/+$/, "");
}

function retryDelayMs(response: Response | null, attempt: number) {
  const retryAfter = Number(response?.headers.get("retry-after") || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(30_000, retryAfter * 1000);
  }
  return Math.min(12_000, 750 * (2 ** Math.max(0, attempt - 1)));
}

function retryableWooStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function safeWooErrorPayload(text: string) {
  try {
    return JSON.stringify(JSON.parse(text)).slice(0, 300);
  } catch {
    return text.replace(/\s+/g, " ").trim().slice(0, 300);
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

  const url = `${normalizeWooSiteUrl(wooUrl)}/wp-json/wc/v3/products?${params.toString()}`;
  const headers = {
    Authorization: getAuthHeader(),
    Accept: "application/json",
    "User-Agent": "ToneryMaxim-Sync/1.0",
  };

  let lastError: any;

  for (let attempt = 1; attempt <= 7; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetchWithTimeout(url, headers);
      const text = await response.text();

      if (!response.ok) {
        const error = new Error(
          `WooCommerce API chyba ${response.status} na strane ${page}: ${safeWooErrorPayload(text)}`
        ) as Error & { retryable?: boolean };
        error.retryable = retryableWooStatus(response.status);
        throw error;
      }

      const data = parseWooPayload(text);
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
      const retryable = error?.retryable === true
        || error?.name === "AbortError"
        || /fetch failed|socket|ECONNRESET|ETIMEDOUT|timeout/i.test(message);
      if (!retryable || attempt === 7) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
    }
  }

  throw lastError || new Error(`WooCommerce stránka ${page} zlyhala.`);
}

async function fetchAllWooProducts() {
  const wooUrl = normalizeWooSiteUrl(env("WOO_URL"));
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

  if (reportedTotalPages > WOO_SYNC_MAX_PAGES) {
    throw new Error(
      `WooCommerce hlási ${reportedTotalPages} strán produktov, ale WOO_SYNC_MAX_PAGES povoľuje iba ${WOO_SYNC_MAX_PAGES}.`
    );
  }

  const deduplicated = [...new Map(
    all.map((product) => [String(product?.id || product?.sku || product?.slug || ""), product])
  ).values()].filter((product) => product && (product.id || product.sku || product.slug));

  return { products: deduplicated, pages: page, reportedTotalPages, reportedTotal };
}

async function syncProductsCacheInternal(options: { force?: boolean } = {}): Promise<ProductsSyncResult> {
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

  const requiredProducts = requiredProductCount({
    reportedTotal: raw.reportedTotal,
    configuredMinimum: EXPECTED_MIN_PRODUCTS,
    safeMinimum: MIN_SAFE_PRODUCTS,
    completenessRatio: COMPLETENESS_RATIO,
  });
  if (raw.products.length < requiredProducts) {
    const message = `Woo sync vrátil iba ${raw.products.length} produktov z ${raw.reportedTotal || "nezisteného počtu"}. Očakávam minimálne ${requiredProducts}. Cache sa neprepísala.`;
    if (current?.products?.length) return { cache: current, refreshed: false, warning: message };
    throw new Error(message);
  }

  const products = sortProducts(enrichProductsFromRelated(raw.products.map(mapProduct)));
  const next: CacheFile = {
    ok: true,
    version: CACHE_VERSION,
    generated_at: new Date().toISOString(),
    total: products.length,
    woo_reported_total: raw.reportedTotal || products.length,
    products,
  };

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

export async function syncProductsCache(options: { force?: boolean } = {}): Promise<ProductsSyncResult> {
  const activeSync = globalStore.__TM_PRODUCTS_SYNC_PROMISE__;
  if (activeSync) return activeSync;

  const operation = syncProductsCacheInternal(options);
  globalStore.__TM_PRODUCTS_SYNC_PROMISE__ = operation;

  try {
    return await operation;
  } finally {
    if (globalStore.__TM_PRODUCTS_SYNC_PROMISE__ === operation) {
      delete globalStore.__TM_PRODUCTS_SYNC_PROMISE__;
    }
  }
}

export async function getProductsCache() {
  const current = await readProductsCache();
  if (current) return current;
  return (await syncProductsCache({ force: true })).cache;
}

function getProductLookupIndex(cache: CacheFile) {
  const current = globalStore.__TM_PRODUCTS_LOOKUP_INDEX__;
  if (current?.generatedAt === cache.generated_at) return current;

  const byId = new Map<string, TmProduct>();
  const bySlug = new Map<string, TmProduct>();
  for (const product of cache.products) {
    const id = String(product?.id || "").trim();
    const slug = String(product?.slug || "").trim();
    if (id) byId.set(id, product);
    if (slug) bySlug.set(slug, product);
  }

  const next = { generatedAt: cache.generated_at, byId, bySlug };
  globalStore.__TM_PRODUCTS_LOOKUP_INDEX__ = next;
  return next;
}

export async function getProductFromCache(input: { id?: unknown; slug?: unknown }) {
  const cache = await getProductsCache();
  const index = getProductLookupIndex(cache);
  const id = String(input.id || "").trim();
  const slug = String(input.slug || "").trim();
  const product = (id ? index.byId.get(id) : undefined) || (slug ? index.bySlug.get(slug) : undefined) || null;
  return { cache, product };
}

export function ensureProductsCacheWarmStarted(): void {
  const now = Date.now();
  const lastStarted = globalStore.__TM_PRODUCTS_WARM_STARTED_AT__ || 0;
  if (globalStore.__TM_PRODUCTS_WARM_PROMISE__ || now - lastStarted < 5 * 60_000) return;

  globalStore.__TM_PRODUCTS_WARM_STARTED_AT__ = now;
  const operation = syncProductsCache()
    .then((result) => {
      if (result.warning) console.warn(`[TM product cache] ${result.warning}`);
    })
    .catch((error) => {
      console.error('[TM product cache] Background warmup failed:', error?.message || error);
    })
    .finally(() => {
      if (globalStore.__TM_PRODUCTS_WARM_PROMISE__ === operation) {
        delete globalStore.__TM_PRODUCTS_WARM_PROMISE__;
      }
    });

  globalStore.__TM_PRODUCTS_WARM_PROMISE__ = operation;
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

function searchTokens(value: unknown) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function matchesPrinterFilter(product: TmProduct, query: string) {
  const normalizedQuery = normalize(query);
  const compactQuery = compactKey(query);
  if (!normalizedQuery || !compactQuery) return true;

  const printers = productPrinterValues(product);

  const analysis = analyzeCatalogQuery(query);
  if (analysis.hasReference) return printers.some((item) => exactPrinterModelMatch(item, analysis));

  // Pri kliknutí na konkrétnu sériu/model musí zostať zachovaný aj znak za pomlčkou
  // (napr. Brother DCP-L nesmie spadnúť na všeobecné Brother DCP).
  if (printers.some((item) => compactKey(item).includes(compactQuery))) return true;

  const attributeValues = (Array.isArray(product.attributes_all) ? product.attributes_all : Array.isArray(product.attributes) ? product.attributes : [])
    .flatMap((attribute: any) => [attribute?.value, ...(Array.isArray(attribute?.values) ? attribute.values : [])])
    .filter(Boolean);
  if (attributeValues.some((item: unknown) => compactKey(item).includes(compactQuery))) return true;

  // Fallback pre výrobcu (HP, Brother, Canon...), keď produkt nemá zoznam modelov.
  const brandOnly = /^[a-z0-9]+$/i.test(normalizedQuery) && !/[\s-]/.test(String(query));
  return brandOnly && compactKey(product.search_text || `${product.name || ""} ${product.sku || ""}`).includes(compactQuery);
}

function matchesLooseSearch(text: string, query: string) {
  const search = normalize(query);
  if (!search) return true;

  const compactText = compactKey(text);
  const compactSearch = compactKey(query);

  if (text.includes(search)) return true;
  if (compactSearch && compactText.includes(compactSearch)) return true;

  const tokens = searchTokens(query);
  if (!tokens.length) return true;

  // Dôležité pre dotazy typu „hp 652xl“, „canon 054“, „brother 2421“:
  // v názve produktu býva medzi značkou a modelom OEM kód, preto presná fráza nemusí existovať.
  // Stačí, aby sa našli všetky zadané tokeny nezávisle od poradia.
  return tokens.every((token) => {
    const compactToken = compactKey(token);
    if (text.includes(token)) return true;
    if (compactToken && compactText.includes(compactToken)) return true;
    return false;
  });
}

export function filterProducts(products: TmProduct[], filters: { search?: string; brand?: string; category?: string; type?: string; printer?: string; color?: string; stock?: string }) {
  const search = normalize(filters.search || "");
  const brand = normalize(filters.brand || "");
  const printer = normalize(filters.printer || "");
  const color = normalize(filters.color || "");
  const stock = normalize(filters.stock || "");
  const exactSearchProducts = search
    ? new Set(findExactProductIdentityMatches(products, filters.search || "").map((match) => match.product))
    : new Set<TmProduct>();
  const exactPrinterProducts = search
    ? new Set(findExactPrinterModelMatches(products, filters.search || "").map((match) => match.product))
    : new Set<TmProduct>();

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
    if (printer && !matchesPrinterFilter(product, filters.printer || "")) return false;
    if (search) {
      const hasStructuredMatches = exactSearchProducts.size > 0 || exactPrinterProducts.size > 0;
      if (hasStructuredMatches && !exactSearchProducts.has(product) && !exactPrinterProducts.has(product)) return false;
      if (!hasStructuredMatches && !matchesLooseSearch(text, search)) return false;
    }
    return true;
  });
}

export function jsonResponse(body: unknown, status = 200, cacheHeader = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400") {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheHeader } });
}
