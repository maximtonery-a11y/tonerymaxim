import {
  compactKey,
  getProductsCache,
  normalize,
  sortProducts,
  type TmProduct,
} from "../tm-products-cache";
import { legacySlugToText, type ParsedLegacyRoute } from "./parser";

export interface LegacyPrinterMatch {
  title: string;
  brand: string;
  products: TmProduct[];
  totalProducts: number;
  confidence: number;
  matchedBy: "exact" | "suffix" | "alias" | "family" | "fuzzy";
}

type PrinterIndexEntry = {
  title: string;
  brand: string;
  key: string;
  normalizedTitle: string;
  tokens: string[];
  products: TmProduct[];
  productIds: Set<string>;
};

type PrinterIndex = {
  generatedAt: string;
  entries: PrinterIndexEntry[];
  byKey: Map<string, PrinterIndexEntry>;
};

const globalStore = globalThis as typeof globalThis & {
  __TM_LEGACY_PRINTER_INDEX__?: PrinterIndex;
};

const SAFE_VARIANT_WORDS = new Set([
  "aio", "mfp", "all", "in", "one", "series", "seria", "plus", "se", "xi",
  "xtra", "fs", "n", "dn", "dtn", "tn", "w", "dw", "nw", "dnw", "d", "i",
  "c", "cn", "cw", "f", "fn", "fw", "p", "ps", "v", "e", "nd", "cdw", "cdn",
  "cxi", "m", "mp", "ml", "mv", "l", "ln", "le", "sl", "xm", "xs", "nf",
  "hnf", "hns",
]);

function cleanPrinterName(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function printerTokens(value: unknown): string[] {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function productKey(product: TmProduct): string {
  return String(product.id || product.slug || product.sku || product.name || "");
}

function detectPrinterBrand(title: string, fallback = ""): string {
  const normalized = normalize(title);
  if (/\bhp\b/.test(normalized) || normalized.includes("hewlett")) return "HP";
  const brands = [
    "Brother", "Canon", "Epson", "Xerox", "Samsung", "Lexmark", "Kyocera",
    "OKI", "Ricoh", "Konica Minolta", "Utax", "Panasonic", "Toshiba", "Dell",
    "Philips", "IBM", "Sharp", "Pantum", "Develop", "Triumph-Adler",
  ];
  return brands.find((brand) => normalized.includes(normalize(brand))) || fallback;
}

function buildPrinterIndex(products: TmProduct[], generatedAt: string): PrinterIndex {
  const byKey = new Map<string, PrinterIndexEntry>();

  for (const product of products) {
    const printers = Array.isArray(product.compatible_printers)
      ? product.compatible_printers
      : Array.isArray(product.printers)
        ? product.printers
        : [];

    for (const rawPrinter of printers) {
      const title = cleanPrinterName(rawPrinter);
      const key = compactKey(title);
      if (!title || key.length < 3) continue;

      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          title,
          brand: detectPrinterBrand(title),
          key,
          normalizedTitle: normalize(title),
          tokens: printerTokens(title),
          products: [],
          productIds: new Set<string>(),
        };
        byKey.set(key, entry);
      }

      const id = productKey(product);
      if (id && !entry.productIds.has(id)) {
        entry.productIds.add(id);
        entry.products.push(product);
      }
    }
  }

  return { generatedAt, entries: [...byKey.values()], byKey };
}

async function getPrinterIndex(): Promise<PrinterIndex> {
  const cache = await getProductsCache();
  const generatedAt = String(cache.generated_at || "");
  const current = globalStore.__TM_LEGACY_PRINTER_INDEX__;
  if (current && current.generatedAt === generatedAt) return current;

  const next = buildPrinterIndex(cache.products, generatedAt);
  globalStore.__TM_LEGACY_PRINTER_INDEX__ = next;
  return next;
}

function routeCandidateTexts(route: ParsedLegacyRoute): string[] {
  const brand = route.brandName || "";
  const tail = route.segments.slice(1).map(legacySlugToText).filter(Boolean);
  const last = tail.at(-1) || "";
  const lastTwo = tail.slice(-2).join(" ");

  return [
    last,
    brand && last ? `${brand} ${last}` : "",
    lastTwo,
    brand && lastTwo ? `${brand} ${lastTwo}` : "",
  ].map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function brandMatches(entry: PrinterIndexEntry, route: ParsedLegacyRoute): boolean {
  if (!route.brandName) return true;
  const routeBrand = compactKey(route.brandName);
  const entryBrand = compactKey(entry.brand || entry.title);
  return entryBrand.includes(routeBrand) || compactKey(entry.title).startsWith(routeBrand);
}

function significantTokens(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !["laserova", "atramentova", "tlaciaren", "printer"].includes(token));
}

function tokenScore(candidate: string, entry: PrinterIndexEntry): number {
  const tokens = significantTokens(candidate);
  if (!tokens.length) return 0;
  const title = entry.normalizedTitle;
  const matched = tokens.filter((token) => title.includes(token)).length;
  return matched / tokens.length;
}

function toMatch(entry: PrinterIndexEntry, confidence: number, matchedBy: LegacyPrinterMatch["matchedBy"]): LegacyPrinterMatch {
  const products = sortProducts(entry.products);
  return {
    title: entry.title,
    brand: entry.brand,
    products,
    totalProducts: products.length,
    confidence,
    matchedBy,
  };
}

function mergedMatch(
  entries: PrinterIndexEntry[],
  title: string,
  fallbackBrand: string,
  confidence: number,
  matchedBy: LegacyPrinterMatch["matchedBy"],
): LegacyPrinterMatch | null {
  if (!entries.length) return null;
  const productsById = new Map<string, TmProduct>();
  for (const entry of entries) {
    for (const product of entry.products) productsById.set(productKey(product), product);
  }
  const products = sortProducts([...productsById.values()]);
  if (!products.length) return null;
  return {
    title: title || entries[0].title,
    brand: entries[0].brand || fallbackBrand,
    products,
    totalProducts: products.length,
    confidence,
    matchedBy,
  };
}

function routeDisplayTitle(route: ParsedLegacyRoute, tokens: string[]): string {
  const brand = route.brandName || "";
  const brandTokens = printerTokens(brand);
  const remaining = [...tokens];
  if (brandTokens.length && brandTokens.every((token, index) => remaining[index] === token)) {
    remaining.splice(0, brandTokens.length);
  }
  const special: Record<string, string> = {
    laserjet: "LaserJet", officejet: "OfficeJet", deskjet: "DeskJet", workforce: "WorkForce",
    pixma: "PIXMA", imageclass: "imageCLASS", color: "Color", pro: "Pro", enterprise: "Enterprise",
    mfp: "MFP", aio: "AIO", series: "Series",
  };
  const body = remaining.map((token) => {
    if (special[token]) return special[token];
    if (/\d/.test(token)) return token.toUpperCase();
    return token.length <= 3 ? token.toUpperCase() : `${token[0]?.toUpperCase() || ""}${token.slice(1)}`;
  }).join(" ");
  return `${brand}${body ? ` ${body}` : ""}`.trim();
}

function exactAliasMatch(route: ParsedLegacyRoute, index: PrinterIndex): LegacyPrinterMatch | null {
  const lastText = legacySlugToText(route.segments.at(-1) || "");
  const originalTokens = printerTokens(lastText);
  if (originalTokens.length < 2 || !originalTokens.some((token) => /\d/.test(token))) return null;

  const tokenVariants: string[][] = [];
  let current = [...originalTokens];

  // Staré URL často pridávali AIO/MFP/Series alebo variant zariadenia za základný model.
  // Variant odstránime iba vtedy, keď po odstránení existuje presný model v produktovej cache.
  while (current.length > 2) {
    const last = current.at(-1) || "";
    const before = current.slice(0, -1);
    const hasModelNumber = before.some((token) => /\d/.test(token));
    const shortVariant = /^[a-z]{1,6}$/.test(last) && hasModelNumber;
    if (!SAFE_VARIANT_WORDS.has(last) && !shortVariant) break;
    current = before;
    tokenVariants.push([...current]);
  }

  const last = originalTokens.at(-1) || "";
  const embedded = last.match(/^([a-z]{0,5}\d{2,7})([a-z]{1,6})$/);
  if (embedded) {
    tokenVariants.push([...originalTokens.slice(0, -1), embedded[1]]);
  }

  for (const tokens of tokenVariants) {
    const entry = index.byKey.get(compactKey(tokens.join(" ")));
    if (entry && brandMatches(entry, route)) return toMatch(entry, 0.97, "alias");
  }
  return null;
}

function seriesFamilyMatch(route: ParsedLegacyRoute, index: PrinterIndex): LegacyPrinterMatch | null {
  const lastText = legacySlugToText(route.segments.at(-1) || "");
  const tokens = printerTokens(lastText);
  if (!tokens.some((token) => token === "series" || token === "seria")) return null;

  const baseTokens = tokens.filter((token) => token !== "series" && token !== "seria");
  if (!baseTokens.some((token) => /\d/.test(token))) return null;

  const exactBase = index.byKey.get(compactKey(baseTokens.join(" ")));
  if (exactBase && brandMatches(exactBase, route)) return toMatch(exactBase, 0.98, "family");

  const modelStem = [...baseTokens].reverse().find((token) => /\d/.test(token)) || "";
  if (modelStem.length < 3) return null;
  const baseKey = compactKey(baseTokens.join(" "));
  const family = index.entries.filter((entry) => {
    if (!brandMatches(entry, route)) return false;
    if (!entry.key.startsWith(baseKey)) return false;
    const entryModel = [...entry.tokens].reverse().find((token) => /\d/.test(token)) || "";
    return entryModel.startsWith(modelStem);
  });

  return mergedMatch(family, routeDisplayTitle(route, [...baseTokens, "series"]), route.brandName || "", 0.95, "family");
}

export async function findLegacyPrinter(route: ParsedLegacyRoute): Promise<LegacyPrinterMatch | null> {
  if (route.kind !== "brand-tree" || route.segments.length < 3) return null;

  const index = await getPrinterIndex();
  const candidates = routeCandidateTexts(route);
  const candidateKeys = [...new Set(candidates.map(compactKey).filter((key) => key.length >= 3))];

  for (const key of candidateKeys) {
    const exact = index.byKey.get(key);
    if (exact && brandMatches(exact, route)) return toMatch(exact, 1, "exact");
  }

  const alias = exactAliasMatch(route, index);
  if (alias) return alias;

  const family = seriesFamilyMatch(route, index);
  if (family) return family;

  const lastKey = compactKey(legacySlugToText(route.segments.at(-1) || ""));
  if (lastKey.length >= 5) {
    const suffixMatches = index.entries
      .filter((entry) => brandMatches(entry, route))
      .filter((entry) => entry.key.endsWith(lastKey) || entry.key.includes(lastKey))
      .sort((a, b) => a.key.length - b.key.length);

    if (suffixMatches.length === 1) return toMatch(suffixMatches[0], 0.94, "suffix");
  }

  let best: { entry: PrinterIndexEntry; score: number } | null = null;
  let secondScore = 0;

  for (const entry of index.entries) {
    if (!brandMatches(entry, route)) continue;
    const score = Math.max(...candidates.map((candidate) => tokenScore(candidate, entry)));
    if (!best || score > best.score) {
      secondScore = best?.score || 0;
      best = { entry, score };
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (!best || best.score < 0.86 || best.score - secondScore < 0.08) return null;
  return toMatch(best.entry, Math.min(0.92, best.score), "fuzzy");
}
