export type CatalogProduct = Record<string, any>;

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
  const aliases = new Set<string>();
  const tokens = alphanumericTokens(value);

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
    if (/^\d{2,6}$/.test(token) && /^(?:xl|xxl|bk|k|c|m|y)$/.test(next)) {
      aliases.add(`${token}${next}`);
    }
  }

  return aliases;
}

function detectBrands(value: unknown) {
  const normalized = normalize(value);
  const compact = compactKey(value);

  return CATALOG_BRANDS.filter((brand) => {
    const normalizedBrand = normalize(brand);
    const compactBrand = compactKey(brand);
    if (new RegExp(`(^|[^a-z0-9])${normalizedBrand.replace(/\s+/g, "[\\s-]*")}([^a-z0-9]|$)`, "i").test(normalized)) return true;
    return compact.startsWith(compactBrand) && /\d/.test(compact.slice(compactBrand.length));
  });
}

function brandlessQuery(value: string, brands: string[]) {
  let normalized = normalize(value);
  let compact = compactKey(value);

  for (const brand of brands) {
    const normalizedBrand = normalize(brand);
    const compactBrand = compactKey(brand);
    normalized = normalized.replace(new RegExp(`(^|[^a-z0-9])${normalizedBrand.replace(/\s+/g, "[\\s-]*")}([^a-z0-9]|$)`, "gi"), " ");
    if (compact.startsWith(compactBrand)) compact = compact.slice(compactBrand.length);
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
  const identity = normalize(productIdentityValue(product));
  const categoryText = Array.isArray(product.categories)
    ? product.categories.map((category: any) => `${category?.name || ""} ${category?.slug || ""}`).join(" ")
    : "";
  const searchable = normalize(`${identity} ${categoryText}`);

  return CATALOG_BRANDS.find((brand) => {
    const normalizedBrand = normalize(brand);
    if (normalizedBrand === "hp") return /(^|[^a-z0-9])hp([^a-z0-9]|$)/.test(searchable) || searchable.includes("hewlett packard");
    return searchable.includes(normalizedBrand);
  }) || "";
}

function referenceMatchStrength(reference: string, aliases: Set<string>) {
  if (aliases.has(reference)) return 3;

  if (/^\d{2,6}$/.test(reference)) {
    if (aliases.has(`${reference}xl`) || aliases.has(`${reference}xxl`)) return 2;
  }

  return 0;
}

export function exactProductIdentityMatch(product: CatalogProduct, analysis: CatalogQueryAnalysis) {
  if (!analysis.hasReference) return null;

  const brand = productBrand(product);
  if (analysis.brands.length && !analysis.brands.some((queryBrand) => compactKey(queryBrand) === compactKey(brand))) return null;

  const aliases = referenceAliases(productIdentityValue(product));
  const matchedReferences: string[] = [];
  let score = 0;

  for (const reference of analysis.referenceTokens) {
    const strength = referenceMatchStrength(reference, aliases);
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
  const marker = new RegExp(`(?:^|\\s)(?:no|nr)\\s*${reference}(?:\\s*(?:xl|xxl))?(?:\\s|$)`);
  return marker.test(identity);
}

export function findExactProductIdentityMatches(products: CatalogProduct[], query: string): ExactCatalogMatch[] {
  const analysis = analyzeCatalogQuery(query);
  if (!analysis.hasReference) return [];

  const matches = products
    .map((product) => {
      const match = exactProductIdentityMatch(product, analysis);
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
  return explicitFamilyMatches.length ? explicitFamilyMatches : matches;
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

  return uniqueValues(values.flatMap((value) => Array.isArray(value) ? value : [value]));
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

  // Bez rozkladania M652 na všeobecné číslo 652. To je kľúčové, aby sa
  // produktové rodiny a modely tlačiarní navzájom nemiešali.
  const aliases = referenceAliases(value, false);
  return analysis.referenceTokens.some((reference) => aliases.has(reference));
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
