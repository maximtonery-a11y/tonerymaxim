import {
  compactKey,
  filterProducts,
  getProductsCache,
  normalize,
  sortProducts,
  type TmProduct,
} from "../tm-products-cache";
import {
  findLegacyBrand,
  legacySlugToText,
  type ParsedLegacyRoute,
} from "./parser";

export interface LegacyCollectionMatch {
  title: string;
  description: string;
  brand: string;
  products: TmProduct[];
  totalProducts: number;
  matchedBy: "printer-collection" | "manufacturer";
}

export type LegacyRecoveryResult =
  | {
      action: "redirect";
      location: string;
      status: 301 | 302;
      reason: "exact-product" | "product-search" | "printer-search" | "brand-page" | "article-help" | "static-help";
    }
  | {
      action: "gone";
      status: 410;
      reason: "obsolete-non-toner" | "invalid-legacy";
      title: string;
      description: string;
    }
  | {
      action: "not-found";
      status: 404;
      reason: "unknown";
    };

type ProductCodeIndex = {
  generatedAt: string;
  byCode: Map<string, TmProduct[]>;
};

const globalStore = globalThis as typeof globalThis & {
  __TM_LEGACY_PRODUCT_CODE_INDEX__?: ProductCodeIndex;
};

const TYPE_MARKERS = {
  original: ["original", "originalny", "originalna", "orig"],
  compatible: ["alternativny", "alternativna", "alternativne", "alternativ", "kompatibilny", "kompatibilna", "kompatibilne", "compatible"],
  renovated: ["renovovany", "renovovana", "renovovane", "renov", "repasovany", "repasovana"],
} as const;

const COLOR_MARKERS: Record<string, string[]> = {
  black: ["black", "cierna", "cierny", "bk"],
  cyan: ["cyan", "azurova", "azurovy", "c"],
  magenta: ["magenta", "purpurova", "purpurovy", "m"],
  yellow: ["yellow", "zlta", "zlty", "y"],
  color: ["color", "colour", "farebna", "farebny", "tri-color", "tricolor"],
};

const PRODUCT_NOISE = new Set([
  "toner", "napln", "atramentova", "atramentovy", "cartridge", "kazeta", "valec", "opticky", "drum",
  "alternativny", "alternativna", "alternativne", "kompatibilny", "kompatibilna", "kompatibilne",
  "originalny", "originalna", "original", "renovovany", "renovovana", "renovovane", "repasovany",
  "s", "cipom", "pre", "do", "tlaciarne", "farba", "black", "cierna", "cierny", "cyan", "magenta",
  "yellow", "zlta", "zlty", "color", "colour", "farebna", "farebny", "multipack", "balenie",
]);

const NON_TONER_HINTS = new Set([
  "diar", "kalendar", "taska", "vrecko", "sviecka", "obrusok", "pohladnica", "blahozelanie", "zositos",
  "zosit", "pero", "peracnik", "balonik", "dekoracia", "zaves", "stipec", "papier", "krabicka", "krabica",
  "naramek", "naramok", "folia", "samolepka", "farba-temperova", "lepidlo", "pravítko", "pravítko",
]);

function productDetailUrl(product: TmProduct): string {
  const direct = String(product.detail_url || "").trim();
  if (direct.startsWith("/produkt/")) return direct;
  const slug = String(product.slug || product.id || "").trim();
  return slug ? `/produkt/${encodeURIComponent(slug)}` : "/produkty";
}

function attributeValues(product: TmProduct, wantedSlug: string): string[] {
  const attributes = Array.isArray(product.attributes_all)
    ? product.attributes_all
    : Array.isArray(product.attributes)
      ? product.attributes
      : [];

  return attributes
    .filter((attribute: any) => normalize(attribute?.slug || attribute?.name || "") === normalize(wantedSlug))
    .flatMap((attribute: any) => [
      attribute?.value,
      ...(Array.isArray(attribute?.values) ? attribute.values : []),
      ...(Array.isArray(attribute?.options) ? attribute.options : []),
    ])
    .map((value: unknown) => String(value || "").trim())
    .filter(Boolean);
}

function validCode(value: unknown): string | null {
  const code = compactKey(value);
  if (code.length < 4 || code.length > 24) return null;
  if (!/[a-z]/.test(code) || !/\d/.test(code)) return null;
  if (/^(19|20)\d{2}$/.test(code)) return null;
  return code;
}

function extractCodeCandidates(value: unknown): Set<string> {
  const result = new Set<string>();
  const text = normalize(value).replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = text.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const code = validCode(token);
    if (code) result.add(code);
  }

  // Kódy zapisované s medzerou/pomlčkou: CRG-069H, TN-2421, CLI-526.
  // Nekombinujeme ľubovoľné slová, aby nevznikali falošné kódy ako
  // 405magentaoriginal alebo hpw2033a415a.
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const first = tokens[index];
    const second = tokens[index + 1];
    if (/^[a-z]{1,6}$/.test(first) && /\d/.test(second) && second.length <= 10) {
      const code = validCode(`${first}${second}`);
      if (code) result.add(code);
    }
  }

  return result;
}

function codesForProduct(product: TmProduct): Set<string> {
  const values = new Set<string>();
  // Automatický 301 povoľujeme iba podľa štruktúrovaného OEM atribútu.
  // Kódy nájdené iba v názve môžu byť modely tlačiarní, a preto sa na ne
  // nesmie robiť trvalé presmerovanie bez explicitnej mapy.
  const rawValues = [
    ...attributeValues(product, "oem"),
  ];

  for (const raw of rawValues) {
    for (const code of extractCodeCandidates(raw)) values.add(code);
  }

  return values;
}

async function getProductCodeIndex(): Promise<ProductCodeIndex> {
  const cache = await getProductsCache();
  const generatedAt = String(cache.generated_at || "");
  const current = globalStore.__TM_LEGACY_PRODUCT_CODE_INDEX__;
  if (current && current.generatedAt === generatedAt) return current;

  const byCode = new Map<string, TmProduct[]>();
  for (const product of cache.products) {
    for (const code of codesForProduct(product)) {
      const products = byCode.get(code) || [];
      products.push(product);
      byCode.set(code, products);
    }
  }

  const next = { generatedAt, byCode };
  globalStore.__TM_LEGACY_PRODUCT_CODE_INDEX__ = next;
  return next;
}

function oldProductCodes(slug: string): string[] {
  const codes = [...extractCodeCandidates(slug)];
  const brandCompact = compactKey(findLegacyBrand(slug)?.name || "");
  return codes.sort((a, b) => {
    const aBrandPenalty = brandCompact && a.startsWith(brandCompact) ? 1 : 0;
    const bBrandPenalty = brandCompact && b.startsWith(brandCompact) ? 1 : 0;
    if (aBrandPenalty !== bBrandPenalty) return aBrandPenalty - bBrandPenalty;
    const aLengthPenalty = a.length > 12 ? a.length - 12 : 0;
    const bLengthPenalty = b.length > 12 ? b.length - 12 : 0;
    if (aLengthPenalty !== bLengthPenalty) return aLengthPenalty - bLengthPenalty;
    return b.length - a.length;
  });
}

function detectExplicitType(slug: string): TmProduct["product_type_key"] | "" {
  const normalized = normalize(slug);
  for (const [type, markers] of Object.entries(TYPE_MARKERS)) {
    if (markers.some((marker) => normalized.includes(marker))) return type as TmProduct["product_type_key"];
  }
  return "";
}

function detectColor(slug: string): string {
  const tokens = normalize(slug).replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  for (const [color, markers] of Object.entries(COLOR_MARKERS)) {
    if (markers.some((marker) => tokens.includes(marker))) return color;
  }
  return "";
}

function productColorKey(product: TmProduct): string {
  const value = normalize(`${product.color || ""} ${product.farba || ""} ${product.name || ""}`);
  if (/black|cier/.test(value)) return "black";
  if (/cyan|azur/.test(value)) return "cyan";
  if (/magenta|purp/.test(value)) return "magenta";
  if (/yellow|zlt/.test(value)) return "yellow";
  if (/multipack|cmyk|multi pack/.test(value)) return "multipack";
  if (/color|colour|fareb|tri.?color/.test(value)) return "color";
  return "";
}

function productBrandMatches(product: TmProduct, brandName: string): boolean {
  if (!brandName) return true;
  const text = normalize(product.search_text || `${product.name || ""} ${product.slug || ""}`);
  const brand = normalize(brandName);
  if (brand === "hp") return /\bhp\b/.test(text) || text.includes("hewlett packard");
  return text.includes(brand);
}

function safeExactProduct(slug: string, productsByCode: Map<string, TmProduct[]>): TmProduct | null {
  const brand = findLegacyBrand(slug)?.name || "";
  const explicitType = detectExplicitType(slug);
  const color = detectColor(slug);
  const codes = oldProductCodes(slug);
  const candidates = new Map<string, { product: TmProduct; score: number; code: string }>();

  for (const code of codes) {
    for (const product of productsByCode.get(code) || []) {
      if (brand && !productBrandMatches(product, brand)) continue;
      if (explicitType && product.product_type_key && product.product_type_key !== explicitType) continue;
      const productColor = productColorKey(product);
      if (color && productColor !== color) continue;

      const key = String(product.id || product.slug || product.sku || product.name || "");
      const typeBonus = explicitType && product.product_type_key === explicitType ? 25 : 0;
      const colorBonus = color && productColor === color ? 18 : 0;
      const brandBonus = brand ? 12 : 0;
      const score = 100 + Math.min(30, code.length) + typeBonus + colorBonus + brandBonus;
      const current = candidates.get(key);
      if (!current || score > current.score) candidates.set(key, { product, score, code });
    }
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  if (ranked.length === 1) return ranked[0].product;

  const first = ranked[0];
  const second = ranked[1];
  if (first.score - second.score >= 18) return first.product;

  // Pri rovnakom OEM kóde nesmieme náhodne vybrať inú kapacitu/farbu/typ.
  return null;
}


function correctLegacyTypos(value: string): string {
  return String(value || "")
    .replace(/(?:^|-)espon(?:-|$)/g, (match) => match.replace("espon", "epson"))
    .replace(/(?:^|-)cannon(?:-|$)/g, (match) => match.replace("cannon", "canon"));
}
function meaningfulProductQuery(slug: string, preferredCode = ""): string {
  const correctedSlug = correctLegacyTypos(slug);
  const brand = findLegacyBrand(correctedSlug)?.name || "";
  const code = preferredCode || oldProductCodes(correctedSlug)[0] || "";
  const color = detectColor(slug);
  if (code) return [brand, code, color && color !== "color" ? color : ""].filter(Boolean).join(" ");

  const tokens = normalize(legacySlugToText(correctedSlug))
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !PRODUCT_NOISE.has(token))
    .filter((token) => !/^\d{6,}$/.test(token))
    .slice(0, 6);

  return [brand, ...tokens.filter((token) => normalize(brand) !== token)].filter(Boolean).join(" ").trim();
}

function looksLikePrintProduct(slug: string, hasKnownCode = false): boolean {
  const normalized = normalize(slug);
  if (/\b(toner|tonery|napln|naplne|cartridge|atrament|valec|valce|drum|fuser|zobrazovacia|odpadov|kazeta|kazety)\b/.test(normalized.replace(/-/g, " "))) return true;
  if (hasKnownCode || findLegacyBrand(slug)) return true;
  const segments = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return !segments.some((segment) => NON_TONER_HINTS.has(segment)) && false;
}

function searchUrl(query: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (query) params.set("s", query);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `/produkty?${text}` : "/produkty";
}

function printerQuery(route: ParsedLegacyRoute): string {
  const last = legacySlugToText(route.segments.at(-1) || "");
  const brand = route.brandName || "";
  const lastNormalized = normalize(last);
  return lastNormalized.startsWith(normalize(brand)) ? last : `${brand} ${last}`.trim();
}

function isModelLike(route: ParsedLegacyRoute): boolean {
  return /\d/.test(route.segments.at(-1) || "");
}

export async function findLegacyCollection(route: ParsedLegacyRoute): Promise<LegacyCollectionMatch | null> {
  const cache = await getProductsCache();

  if (route.kind === "brand-tree" && !isModelLike(route)) {
    const brand = route.brandName || "";
    if (!brand) return null;

    const last = legacySlugToText(route.segments.at(-1) || "");
    const generic = /^(laserova tlaciaren|atramentova tlaciaren|multifunkcne zariadenie|tlaciaren)$/i.test(last);
    const query = generic ? brand : `${brand} ${last}`.trim();
    let products = filterProducts(cache.products, { search: query });
    if (!products.length) products = filterProducts(cache.products, { brand });
    products = sortProducts(products);
    if (!products.length) return null;

    const label = generic ? brand : `${brand} ${last}`.trim();
    return {
      title: `Tonery a náplne pre ${label}`,
      description: `Prehľad kompatibilných, originálnych a renovovaných náplní pre tlačiarne ${label}.`,
      brand,
      products,
      totalProducts: products.length,
      matchedBy: "printer-collection",
    };
  }

  if (route.kind === "manufacturer" && route.legacySlug) {
    const brand = route.brandName || findLegacyBrand(route.legacySlug)?.name || "";
    const normalized = normalize(route.legacySlug);
    const type = /(?:^|-)(?:alt|alternativ|kompatibil)/.test(normalized) ? "compatible"
      : /(?:^|-)(?:orig|original)/.test(normalized) ? "original"
        : /(?:^|-)(?:renov|repas)/.test(normalized) ? "renovated"
          : "";
    const category = /(?:drum|valec)/.test(normalized) ? "opticke-valce" : "";
    const search = brand || legacySlugToText(route.legacySlug);
    let products = filterProducts(cache.products, {
      brand,
      search: brand ? "" : search,
      type,
      category,
    });
    products = sortProducts(products);
    if (!products.length) return null;

    const suffix = type === "compatible" ? " kompatibilné"
      : type === "original" ? " originálne"
        : type === "renovated" ? " renovované"
          : "";
    const categoryText = category ? " optické valce" : " tonery a náplne";
    const title = `${brand || legacySlugToText(route.legacySlug)}${suffix}${categoryText}`.replace(/\s+/g, " ").trim();

    return {
      title: title[0]?.toUpperCase() + title.slice(1),
      description: `Produkty značky ${brand || legacySlugToText(route.legacySlug)} dostupné v novom e-shope ToneryMaxim.`,
      brand,
      products,
      totalProducts: products.length,
      matchedBy: "manufacturer",
    };
  }

  return null;
}

export async function resolveLegacyRecovery(route: ParsedLegacyRoute): Promise<LegacyRecoveryResult> {
  if (route.kind === "product" && route.productSlug) {
    const index = await getProductCodeIndex();
    const exact = safeExactProduct(route.productSlug, index.byCode);
    if (exact) {
      return {
        action: "redirect",
        location: productDetailUrl(exact),
        status: 301,
        reason: "exact-product",
      };
    }

    const knownCodes = oldProductCodes(route.productSlug).filter((code) => index.byCode.has(code));
    const query = meaningfulProductQuery(route.productSlug, knownCodes[0] || "");
    if (query && looksLikePrintProduct(route.productSlug, knownCodes.length > 0)) {
      return {
        action: "redirect",
        location: searchUrl(query),
        status: 302,
        reason: "product-search",
      };

    }

    return {
      action: "gone",
      status: 410,
      reason: "obsolete-non-toner",
      title: "Tento produkt už nie je v ponuke",
      description: "Pôvodný e-shop obsahoval aj kancelársky a darčekový sortiment. Nový ToneryMaxim sa špecializuje na tonery, náplne a spotrebný materiál do tlačiarní.",
    };
  }

  if (route.kind === "brand-tree") {
    const query = printerQuery(route);
    if (query) {
      return {
        action: "redirect",
        location: searchUrl(query),
        status: 302,
        reason: "printer-search",
      };
    }

    if (route.brandSlug) {
      return {
        action: "redirect",
        location: `/tlaciarne/${route.brandSlug}`,
        status: 302,
        reason: "brand-page",
      };
    }
  }

  if (route.kind === "manufacturer") {
    if (route.brandSlug && route.legacySlug === route.brandSlug) {
      return {
        action: "redirect",
        location: `/tlaciarne/${route.brandSlug}`,
        status: 301,
        reason: "brand-page",
      };
    }

    const query = legacySlugToText(route.legacySlug || "");
    return {
      action: "redirect",
      location: searchUrl(query),
      status: 302,
      reason: "product-search",
    };
  }

  if (route.kind === "article") {
    return {
      action: "redirect",
      location: "/faq",
      status: 302,
      reason: "article-help",
    };
  }

  if (route.kind === "category") {
    return {
      action: "gone",
      status: 410,
      reason: "obsolete-non-toner",
      title: "Táto kategória už nie je v ponuke",
      description: "Pôvodná kategória patrila k sortimentu, ktorý nový e-shop ToneryMaxim už nepredáva. Pokračujte na tonery a náplne alebo vyberte model tlačiarne.",
    };
  }

  if (route.kind === "other") {
    return {
      action: "gone",
      status: 410,
      reason: "invalid-legacy",
      title: "Táto stará stránka bola odstránená",
      description: "Stránka neobsahovala aktuálnu ponuku nového e-shopu. Použite vyhľadávanie tonerov alebo výber podľa tlačiarne.",
    };
  }

  if (route.kind === "static") {
    if (route.normalizedPath === "/zlavovy-kupon-napoveda" || route.normalizedPath === "/nase-clanky") {
      return {
        action: "redirect",
        location: "/faq",
        status: 302,
        reason: "static-help",
      };
    }
    if (route.normalizedPath === "/koleso-zliav") {
      return {
        action: "gone",
        status: 410,
        reason: "invalid-legacy",
        title: "Táto akcia už skončila",
        description: "Koleso zliav už nie je aktívne. Aktuálne ceny a dostupné produkty nájdete v novom e-shope.",
      };
    }
  }

  return { action: "not-found", status: 404, reason: "unknown" };
}
