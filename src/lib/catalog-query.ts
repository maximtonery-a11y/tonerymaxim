export type CatalogProduct = Record<string, any>;
import { sameConsumablePrinterFamily } from "./printer-model-family.ts";

function normalize(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function compactKey(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

export const CATALOG_BRANDS = [
  "Konica Minolta",
  "Panasonic",
  "Samsung",
  "Lexmark",
  "Kyocera",
  "Toshiba",
  "Brother",
  "Canon",
  "Epson",
  "Xerox",
  "Ricoh",
  "Dell",
  "Utax",
  "OKI",
  "HP",
  "Sharp",
  "Pantum",
  "Philips",
  "IBM",
] as const;

export type CatalogQueryAnalysis = {
  raw: string;
  normalized: string;
  compact: string;
  brands: string[];
  referenceTokens: string[];
  hasReference: boolean;
};

export type ExactCatalogMatch = {
  product: CatalogProduct;
  score: number;
  matchedReferences: string[];
};

export type ExactPrinterCatalogMatch = {
  product: CatalogProduct;
  score: number;
  matchedPrinters: string[];
};

// Memoizácia odvodených search hodnôt. Produktová cache používa počas života
// procesu tie isté objekty, takže drahé parsovanie identity/atribútov/tlačiarní
// nemusíme opakovať pri každom dotaze ani pri negatívnom vyhľadávaní.
const PRODUCT_IDENTITY_ALIASES = new WeakMap<object, Set<string>>();
const PRODUCT_BRAND_CACHE = new WeakMap<object, string>();
const PRODUCT_PRINTER_VALUES = new WeakMap<object, string[]>();
const REFERENCE_ALIASES_CACHE = new Map<string, Set<string>>();
const REFERENCE_ALIASES_CACHE_MAX = 50_000;

const QUERY_FILLER_WORDS = new Set([
  "aky",
  "aka",
  "ake",
  "do",
  "hladam",
  "mate",
  "najdi",
  "najst",
  "napln",
  "naplne",
  "na",
  "pre",
  "prosim",
  "potrebujem",
  "tlaciaren",
  "tlaciarne",
  "toner",
  "tonery",
]);

function alphanumericTokens(value: unknown) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function referenceAliases(value: unknown, includeMixedTokenSegments = true) {
  const rawValue = String(value || "");
  const cacheKey = `${includeMixedTokenSegments ? "1" : "0"}:${rawValue}`;
  const cached = REFERENCE_ALIASES_CACHE.get(cacheKey);
  if (cached) return cached;

  const aliases = new Set<string>();
  const tokens = alphanumericTokens(rawValue);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = compactKey(tokens[index]);
    if (!token) continue;
    aliases.add(token);

    if (includeMixedTokenSegments) {
      const segments = token.match(/[a-z]+|\d+/g) || [];
      const firstNumber = segments.findIndex((segment) => /\d/.test(segment));
      if (firstNumber >= 0) {
        const numericSuffix = segments.slice(firstNumber).join("");
        if (numericSuffix) aliases.add(numericSuffix);
        aliases.add(segments[firstNumber]);
      }
    }

    const next = compactKey(tokens[index + 1] || "");
    // Séria a číslo bývajú oddelené pomlčkou alebo medzerou: CLP-320,
    // FS 1035, SP 3400, e-STUDIO 163. Pre prefixové hľadanie potrebujeme
    // aj spojený alias (clp320, fs1035, sp3400, studio163).
    if (/^[a-z]{1,12}$/.test(token) && /^\d{1,8}[a-z]{0,4}$/.test(next)) {
      aliases.add(`${token}${next}`);
    }
    // Neviažeme vyhľadávanie na žiadny zoznam farieb ani kapacitných koncoviek.
    // Ak je kód rozdelený medzerou/pomlčkou (napr. 247 GY), spojíme ho
    // všeobecne; význam koncovky určuje iba reálny katalógový kód.
    if (/^\d{2,8}$/.test(token) && /^[a-z]{1,12}$/.test(next)) {
      aliases.add(`${token}${next}`);
    }
  }

  REFERENCE_ALIASES_CACHE.set(cacheKey, aliases);
  if (REFERENCE_ALIASES_CACHE.size > REFERENCE_ALIASES_CACHE_MAX) {
    const oldest = REFERENCE_ALIASES_CACHE.keys().next().value;
    if (oldest) REFERENCE_ALIASES_CACHE.delete(oldest);
  }
  return aliases;
}

function detectBrands(value: unknown) {
  const normalized = normalize(value);
  const compact = compactKey(value);

  const detected = CATALOG_BRANDS.filter((brand) => {
    const normalizedBrand = normalize(brand);
    const compactBrand = compactKey(brand);
    if (new RegExp(`(^|[^a-z0-9])${normalizedBrand.replace(/\s+/g, "[\\s-]*")}([^a-z0-9]|$)`, "i").test(normalized)) return true;
    return compact.startsWith(compactBrand) && /\d/.test(compact.slice(compactBrand.length));
  });

  // Zákazníci bežne skracujú Konica Minolta iba na „Konica“.
  if (/(^|[^a-z0-9])konica([^a-z0-9]|$)/.test(normalized) && !detected.includes("Konica Minolta")) {
    detected.push("Konica Minolta");
  }
  return detected;
}

function brandlessQuery(value: string, brands: string[]) {
  let normalized = normalize(value);
  let compact = compactKey(value);

  for (const brand of brands) {
    const normalizedBrand = normalize(brand);
    const compactBrand = compactKey(brand);
    normalized = normalized.replace(new RegExp(`(^|[^a-z0-9])${normalizedBrand.replace(/\s+/g, "[\\s-]*")}([^a-z0-9]|$)`, "gi"), " ");
    if (compact.startsWith(compactBrand)) {
      compact = compact.slice(compactBrand.length);
      // Pri zápise bez medzery (HP973, Canon054) hranicový regulárny výraz
      // značku z normalizovaného textu neodstránil a vznikli dva referenčné
      // tokeny: hp973 aj 973. Značku odstránime aj pred priamo nadväzujúcim
      // číslom; detekcia značky už prebehla vyššie.
      normalized = normalized.replace(new RegExp(`^\\s*${normalizedBrand}(?=\\d)`, "i"), " ");
    }
  }

  return { normalized: normalized.replace(/\s+/g, " ").trim(), compact };
}

function referenceTokensFromQuery(value: string, brands: string[]) {
  const withoutBrand = brandlessQuery(value, brands);
  const aliases = referenceAliases(withoutBrand.normalized, false);

  if (withoutBrand.compact && /\d/.test(withoutBrand.compact)) aliases.add(withoutBrand.compact);

  for (const filler of QUERY_FILLER_WORDS) aliases.delete(filler);
  for (const token of [...aliases]) {
    const xlMatch = token.match(/^(\d{2,6})(?:xl|xxl)$/);
    if (xlMatch) aliases.delete(xlMatch[1]);
  }

  return [...aliases]
    .filter((token) => /\d/.test(token) && token.length >= 2)
    .sort((left, right) => {
      const leftSpecificity = /[a-z]/.test(left) ? 1 : 0;
      const rightSpecificity = /[a-z]/.test(right) ? 1 : 0;
      return rightSpecificity - leftSpecificity || right.length - left.length;
    });
}

export function analyzeCatalogQuery(value: unknown): CatalogQueryAnalysis {
  const raw = String(value || "").trim();
  const brands = detectBrands(raw);
  const referenceTokens = referenceTokensFromQuery(raw, brands);

  return {
    raw,
    normalized: normalize(raw),
    compact: compactKey(raw),
    brands,
    referenceTokens,
    hasReference: referenceTokens.length > 0,
  };
}

export function productIdentityValue(product: CatalogProduct) {
  return `${product.name || ""} ${product.sku || ""} ${product.slug || ""}`;
}

export function productBrand(product: CatalogProduct) {
  if (product && typeof product === "object") {
    const cached = PRODUCT_BRAND_CACHE.get(product);
    if (cached !== undefined) return cached;
  }
  const identity = normalize(productIdentityValue(product));
  const categoryText = Array.isArray(product.categories)
    ? product.categories.map((category: any) => `${category?.name || ""} ${category?.slug || ""}`).join(" ")
    : "";
  const searchable = normalize(`${identity} ${categoryText}`);

  const result = CATALOG_BRANDS.find((brand) => {
    const normalizedBrand = normalize(brand);
    if (normalizedBrand === "hp") return /(^|[^a-z0-9])hp([^a-z0-9]|$)/.test(searchable) || searchable.includes("hewlett packard");
    return searchable.includes(normalizedBrand);
  }) || "";
  if (product && typeof product === "object") PRODUCT_BRAND_CACHE.set(product, result);
  return result;
}

function referenceMatchStrength(reference: string, aliases: Set<string>, allowFamilyPrefix = true) {
  if (aliases.has(reference)) return 3;

  if (/^\d{2,6}$/.test(reference)) {
    // Číselné rodiny atramentov nemajú iba koncovky XL/XXL. Výrobcovia
    // používajú aj X, E a ďalšie písmenové varianty (napr. HP 973X, 924e).
    // Číselnú rodinu rozširujeme iba na alias začínajúci presným číslom a
    // pokračujúci výhradne písmenami. Preto sa 973 nemôže pomýliť s 9730.
    if ([...aliases].some((alias) => alias.startsWith(reference)
      && alias.length > reference.length
      && /^[a-z]{1,4}$/.test(alias.slice(reference.length)))) return 2;
  }

  // Rodina spotrebného materiálu sa rozširuje dátovo, bez zoznamu farieb
  // alebo povolených suffixov. Za prefixom môže byť ľubovoľná alfanumerická
  // koncovka začínajúca písmenom; ďalšia číselná rada sa tým nezachytí.
  if (allowFamilyPrefix && /^(?=.*[a-z])(?=.*\d)[a-z0-9]+\d$/.test(reference)) {
    if ([...aliases].some((alias) => alias.startsWith(reference)
      && alias.length > reference.length
      && /^[a-z][a-z0-9]*$/.test(alias.slice(reference.length)))) return 2;
  }

  return 0;
}

export function exactProductIdentityMatch(product: CatalogProduct, analysis: CatalogQueryAnalysis, allowFamilyPrefix = true) {
  if (!analysis.hasReference) return null;

  const brand = productBrand(product);
  if (analysis.brands.length && !analysis.brands.some((queryBrand) => compactKey(queryBrand) === compactKey(brand))) return null;

  let aliases = product && typeof product === "object" ? PRODUCT_IDENTITY_ALIASES.get(product) : undefined;
  if (!aliases) {
    aliases = referenceAliases(productIdentityValue(product));
    if (product && typeof product === "object") PRODUCT_IDENTITY_ALIASES.set(product, aliases);
  }
  const matchedReferences: string[] = [];
  let score = 0;

  for (const reference of analysis.referenceTokens) {
    const strength = referenceMatchStrength(reference, aliases, allowFamilyPrefix);
    if (!strength) continue;
    matchedReferences.push(reference);
    score = Math.max(score, strength === 3 ? 300 : 255);
  }

  if (!matchedReferences.length) return null;

  const sku = compactKey(product.sku || "");
  if (sku && analysis.referenceTokens.includes(sku)) score += 80;
  if (analysis.brands.length && brand) score += 50;
  if (product.stock_status === "instock") score += 8;

  return { score, matchedReferences };
}

function hasExplicitNumberedCartridgeReference(product: CatalogProduct, analysis: CatalogQueryAnalysis) {
  if (analysis.referenceTokens.length !== 1) return false;
  const reference = analysis.referenceTokens[0];
  if (!/^\d{2,6}$/.test(reference)) return false;

  const identity = normalize(productIdentityValue(product))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const marker = new RegExp(`(?:^|\\s)(?:no|nr)\\s*${reference}(?:\\s*[a-z]{1,4})?(?:\\s|$)`);
  return marker.test(identity);
}

function hasVisibleBrandNumberedFamilyReference(product: CatalogProduct, analysis: CatalogQueryAnalysis) {
  if (analysis.referenceTokens.length !== 1 || !analysis.brands.length) return false;
  const reference = analysis.referenceTokens[0];
  if (!/^\d{2,6}$/.test(reference)) return false;
  const identity = normalize(productIdentityValue(product)).replace(/[^a-z0-9]+/g, " ").trim();
  return analysis.brands.some((brand) => {
    const brandToken = normalize(brand).replace(/[^a-z0-9]+/g, " ").trim();
    return new RegExp(`(?:^|\\s)${brandToken}\\s*${reference}[a-z]{0,4}(?:\\s|$)`, "i").test(identity);
  });
}

export function findExactProductIdentityMatches(products: CatalogProduct[], query: string): ExactCatalogMatch[] {
  const analysis = analyzeCatalogQuery(query);
  if (!analysis.hasReference) return [];

  // Ak je dotaz zároveň presným modelom tlačiarne v katalógu (napr. C301),
  // nesmie sa produktová rodina rozšíriť na C301dn. Pri OEM dotaze (TN247,
  // W1420...) sa naopak prefix rozšíri na všetky reálne suffixy bez znalosti farby.
  const queryIsExactPrinter = products.some((product) =>
    productPrinterValues(product).some((printer) => exactPrinterModelMatch(printer, analysis))
  );

  const matches = products
    .map((product) => {
      const match = exactProductIdentityMatch(product, analysis, !queryIsExactPrinter);
      return match ? { product, ...match } : null;
    })
    .filter(Boolean)
    .sort((left: any, right: any) => {
      const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
      if (scoreDiff) return scoreDiff;
      return String(left.product?.name || "").localeCompare(String(right.product?.name || ""), "sk");
    }) as ExactCatalogMatch[];

  // Číselné atramentové rodiny HP (napr. HP 305, 650, 652) sa môžu
  // prekrývať s označeniami laserových tonerov 305A/305X. Ak katalóg
  // obsahuje explicitný zápis „no. 305“, má pred všeobecným číselným
  // aliasom prednosť a do výsledkov sa nedostanú nesúvisiace tonery.
  const explicitFamilyMatches = matches.filter((match) => hasExplicitNumberedCartridgeReference(match.product, analysis));
  if (!explicitFamilyMatches.length) return matches;
  // Ak existuje presný zápis „no. 924“, zachováme aj reálne označenie
  // „HP 924e“. Naopak HP CD973AE sa pri dotaze HP 973 nevydáva za rodinu
  // 973, pretože medzi značkou a číslom stojí iný katalógový kód.
  return matches.filter((match) => hasExplicitNumberedCartridgeReference(match.product, analysis)
    || hasVisibleBrandNumberedFamilyReference(match.product, analysis));
}

export function printerReferenceMatches(value: unknown, analysis: CatalogQueryAnalysis) {
  if (!analysis.hasReference) return false;
  const aliases = referenceAliases(value);
  return analysis.referenceTokens.some((reference) => referenceMatchStrength(reference, aliases) > 0);
}

function uniqueValues(values: unknown[]) {
  const result = new Map<string, string>();
  values.forEach((value) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const key = compactKey(text);
    if (text && key && !result.has(key)) result.set(key, text);
  });
  return [...result.values()];
}

/**
 * Vráti všetky štruktúrované modely tlačiarní priradené k produktu.
 * Search text zámerne nepoužívame: obsahuje názov, popisy aj OEM kódy a
 * pri krátkych modeloch by vytváral falošné zhody.
 */
export function productPrinterValues(product: CatalogProduct) {
  if (product && typeof product === "object") {
    const cached = PRODUCT_PRINTER_VALUES.get(product);
    if (cached) return cached;
  }
  const values: unknown[] = [
    ...(Array.isArray(product.compatible_printers) ? product.compatible_printers : []),
    ...(Array.isArray(product.printers) ? product.printers : []),
  ];

  const attributes = Array.isArray(product.attributes_all)
    ? product.attributes_all
    : Array.isArray(product.attributes)
      ? product.attributes
      : [];

  attributes.forEach((attribute: any) => {
    const name = normalize(`${attribute?.name || ""} ${attribute?.slug || ""}`);
    if (!/kompat|compat|tlaciar|printer|model|zariaden/.test(name)) return;
    values.push(attribute?.value);
    if (Array.isArray(attribute?.values)) values.push(...attribute.values);
    if (Array.isArray(attribute?.options)) values.push(...attribute.options);
  });

  const result = uniqueValues(values.flatMap((value) => Array.isArray(value) ? value : [value]));
  if (product && typeof product === "object") PRODUCT_PRINTER_VALUES.set(product, result);
  return result;
}

/**
 * Presná zhoda modelu používa celé alfanumerické označenie. Preto C301
 * zodpovedá C301, ale nie C301dn/C3010 a dotaz HP 652 sa nezamení za M652.
 * Medzery a pomlčky sa ignorujú (DCP L2532DW = DCP-L2532DW).
 */
export function exactPrinterModelMatch(value: unknown, analysis: CatalogQueryAnalysis) {
  if (!analysis.hasReference) return false;

  const printerBrands = detectBrands(value);
  if (analysis.brands.length && printerBrands.length) {
    const hasSameBrand = analysis.brands.some((queryBrand) => printerBrands.some((printerBrand) => compactKey(queryBrand) === compactKey(printerBrand)));
    if (!hasSameBrand) return false;
  }

  // Pri Xeroxe koncovky B/BI/N/DN/DNI/V označujú výbavu rovnakého modelu,
  // nie inú tonerovú rodinu. Dotaz „Xerox Phaser 3020“ preto musí zahrnúť
  // aj 3020B a 3020BI. Toto pravidlo sa zámerne nevzťahuje na HP/HP+.
  if (sameConsumablePrinterFamily(analysis.raw, value)) return true;

  // Bez rozkladania M652 na všeobecné číslo 652. To je kľúčové, aby sa
  // produktové rodiny a modely tlačiarní navzájom nemiešali.
  const aliases = referenceAliases(value, false);
  return analysis.referenceTokens.some((reference) => aliases.has(reference));
}

/**
 * Rozpozná neúplný alfanumerický model tlačiarne (M28 -> M28w,
 * C301 -> C301dn). Čisto číselné označenia zámerne nepovažujeme za prefix:
 * dotaz HP 652 je produktová rodina a nesmie sa zameniť za DeskJet 6520.
 */
export function partialPrinterModelMatch(value: unknown, analysis: CatalogQueryAnalysis) {
  if (!analysis.hasReference) return false;

  const printerBrands = detectBrands(value);
  if (analysis.brands.length && printerBrands.length) {
    const hasSameBrand = analysis.brands.some((queryBrand) => printerBrands.some((printerBrand) => compactKey(queryBrand) === compactKey(printerBrand)));
    if (!hasSameBrand) return false;
  }

  const aliases = referenceAliases(value, false);
  return analysis.referenceTokens.some((reference) => {
    if (reference.length < 3 || !/\d/.test(reference)) return false;
    if (/[a-z]/.test(reference)) return [...aliases].some((alias) => alias.length > reference.length && alias.startsWith(reference));
    // Pri uvedenej značke je bezpečné doplniť iba písmenovú výbavovú
    // koncovku modelu: Dell 3110 -> Dell 3110CN. Číselný model bez značky
    // naďalej nerozširujeme a 301 sa nikdy nesmie zameniť za 3010.
    if (!analysis.brands.length || !/^\d{3,6}$/.test(reference)) return false;
    return [...aliases].some((alias) => new RegExp(`^${reference}[a-z]{1,4}$`,'i').test(alias));
  });
}

export function findExactPrinterModelMatches(products: CatalogProduct[], query: string): ExactPrinterCatalogMatch[] {
  const analysis = analyzeCatalogQuery(query);
  if (!analysis.hasReference) return [];

  return products
    .map((product) => {
      const matchedPrinters = productPrinterValues(product).filter((printer) => exactPrinterModelMatch(printer, analysis));
      if (!matchedPrinters.length) return null;
      const exactPhrase = matchedPrinters.some((printer) => compactKey(printer) === analysis.compact);
      return {
        product,
        matchedPrinters,
        score: (exactPhrase ? 400 : 340) + (product.stock_status === "instock" ? 8 : 0),
      };
    })
    .filter(Boolean)
    .sort((left: any, right: any) => Number(right.score || 0) - Number(left.score || 0)
      || String(left.product?.name || "").localeCompare(String(right.product?.name || ""), "sk")) as ExactPrinterCatalogMatch[];
}
