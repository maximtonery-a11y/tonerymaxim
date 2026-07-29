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

export function findExactProductIdentityMatches(products: CatalogProduct[], query: string): ExactCatalogMatch[] {
  const analysis = analyzeCatalogQuery(query);
  if (!analysis.hasReference) return [];

  return products
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
}

export function printerReferenceMatches(value: unknown, analysis: CatalogQueryAnalysis) {
  if (!analysis.hasReference) return false;
  const aliases = referenceAliases(value);
  return analysis.referenceTokens.some((reference) => referenceMatchStrength(reference, aliases) > 0);
}
