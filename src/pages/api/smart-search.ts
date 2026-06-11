import type { APIRoute } from "astro";
import { compactKey, getProductsCache, jsonResponse, normalize, sortProducts } from "../../lib/tm-products-cache";

export const prerender = false;

const BRANDS = ["HP", "Canon", "Brother", "Epson", "Xerox", "Samsung", "Lexmark", "Kyocera", "OKI", "Ricoh", "Utax", "Toshiba", "Panasonic", "Dell", "Konica Minolta"];
const CATEGORIES = [
  { label: "Tonery", value: "tonery" },
  { label: "Atramentové náplne", value: "atramentove-naplne" },
  { label: "Optické valce", value: "opticke-valce" },
  { label: "Ostatné komponenty", value: "ostatne-komponenty" },
];
const TYPE_ORDER: Record<string, number> = { compatible: 1, original: 2, renovated: 3, product: 4 };
const TYPE_LABEL: Record<string, string> = { compatible: "Kompatibilné", original: "Originálne", renovated: "Renovované", product: "Ostatné" };

const globalStore = globalThis as typeof globalThis & {
  __TM_SMART_SEARCH_INDEX__?: {
    generatedAt: string;
    items: IndexedProduct[];
  };
};

type QueryInfo = {
  raw: string;
  normalized: string;
  compact: string;
  tokens: string[];
  modelTokens: string[];
  brandTokens: string[];
};

type IndexedPrinter = {
  title: string;
  key: string;
  text: string;
  compact: string;
  tokens: string[];
};

type IndexedProduct = {
  product: any;
  brand: string;
  searchValue: string;
  text: string;
  compact: string;
  tokens: string[];
  printers: IndexedPrinter[];
};

function productBrand(product: any) {
  const text = normalize(`${product.name || ""} ${product.sku || ""} ${(product.categories || []).map((cat: any) => `${cat.name || ""} ${cat.slug || ""}`).join(" ")}`);
  return BRANDS.find((brand) => text.includes(normalize(brand))) || "";
}

function words(value: unknown) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
}

function uniqueWords(value: unknown) {
  return [...new Set(words(value))];
}

function queryInfo(query: string): QueryInfo {
  const tokens = uniqueWords(query);
  const brandTokens = BRANDS.map((brand) => normalize(brand)).filter((brand) => tokens.includes(brand));
  return {
    raw: query,
    normalized: normalize(query),
    compact: compactKey(query),
    tokens,
    modelTokens: tokens.filter(isModelToken),
    brandTokens,
  };
}

function levenshtein(a: string, b: string, limit = 2) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }

    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function fuzzyTokenScore(queryToken: string, targetToken: string) {
  if (!queryToken || !targetToken) return 0;
  if (targetToken === queryToken) return 26;
  if (queryToken.length >= 3 && targetToken.startsWith(queryToken)) return 20;
  if (queryToken.length >= 3 && targetToken.includes(queryToken)) return 14;

  const allowedDistance = queryToken.length >= 7 ? 2 : 1;
  if (queryToken.length >= 4 && levenshtein(queryToken, targetToken, allowedDistance) <= allowedDistance) return 10;

  return 0;
}

function isModelToken(token: string) {
  return /\d/.test(token) && token.length >= 2;
}

function modelTokenScore(queryToken: string, targetCompact: string, targetTokens: string[]) {
  if (!isModelToken(queryToken)) return 0;

  const queryCompact = compactKey(queryToken);
  if (!queryCompact) return 0;

  if (targetCompact.includes(queryCompact)) return 90;

  let best = 0;
  for (const token of targetTokens) {
    const tokenCompact = compactKey(token);
    if (!/\d/.test(tokenCompact)) continue;
    if (tokenCompact === queryCompact) best = Math.max(best, 90);
    else if (tokenCompact.includes(queryCompact) || queryCompact.includes(tokenCompact)) best = Math.max(best, 70);
    else if (levenshtein(queryCompact, tokenCompact, queryCompact.length >= 5 ? 2 : 1) <= (queryCompact.length >= 5 ? 2 : 1)) best = Math.max(best, 46);
  }

  return best;
}

function searchableValue(product: any) {
  const printers = Array.isArray(product.printers) ? product.printers.join(" ") : "";
  const compatiblePrinters = Array.isArray(product.compatible_printers) ? product.compatible_printers.join(" ") : "";
  const categories = Array.isArray(product.categories) ? product.categories.map((cat: any) => `${cat.name || ""} ${cat.slug || ""}`).join(" ") : "";
  return `${product.name || ""} ${product.sku || ""} ${categories} ${printers} ${compatiblePrinters} ${product.search_text || ""}`;
}

function makeIndexedProduct(product: any): IndexedProduct {
  const searchValue = searchableValue(product);
  const printerNames = [...new Set([...(Array.isArray(product.printers) ? product.printers : []), ...(Array.isArray(product.compatible_printers) ? product.compatible_printers : [])])];
  const printers = printerNames
    .map((printer: any) => {
      const title = String(printer || "").trim();
      return {
        title,
        key: compactKey(title),
        text: normalize(title),
        compact: compactKey(title),
        tokens: uniqueWords(title),
      };
    })
    .filter((printer) => printer.title);

  return {
    product,
    brand: productBrand(product),
    searchValue,
    text: normalize(searchValue),
    compact: compactKey(searchValue),
    tokens: uniqueWords(searchValue),
    printers,
  };
}

function getSearchIndex(cache: any) {
  if (globalStore.__TM_SMART_SEARCH_INDEX__?.generatedAt === cache.generated_at) return globalStore.__TM_SMART_SEARCH_INDEX__.items;

  const items = sortProducts(cache.products).map(makeIndexedProduct);
  globalStore.__TM_SMART_SEARCH_INDEX__ = { generatedAt: cache.generated_at, items };
  return items;
}

function hasTokenPrefixMatch(query: QueryInfo, tokens: string[]) {
  return query.tokens.some((queryToken) => {
    if (queryToken.length < 3 && !isModelToken(queryToken)) return false;
    return tokens.some((targetToken) => targetToken.startsWith(queryToken) || targetToken.includes(queryToken));
  });
}

function isLikelyCandidate(item: IndexedProduct, query: QueryInfo) {
  if (query.compact.length >= 4 && item.compact.includes(query.compact)) return true;
  if (query.normalized.length >= 3 && item.text.includes(query.normalized)) return true;

  if (query.modelTokens.length) {
    const hasModel = query.modelTokens.some((token) => item.compact.includes(compactKey(token)) || item.printers.some((printer) => printer.compact.includes(compactKey(token))));
    if (!hasModel) return false;

    const hasBrand = !query.brandTokens.length || query.brandTokens.some((brand) => item.text.includes(brand) || item.printers.some((printer) => printer.text.includes(brand)));
    if (hasBrand) return true;

    return hasTokenPrefixMatch(query, item.tokens) || item.printers.some((printer) => hasTokenPrefixMatch(query, printer.tokens));
  }

  return hasTokenPrefixMatch(query, item.tokens) || item.printers.some((printer) => hasTokenPrefixMatch(query, printer.tokens));
}

function relevanceScore(item: IndexedProduct, query: QueryInfo) {
  const product = item.product;
  const title = normalize(product.name || "");
  const sku = normalize(product.sku || "");

  let score = 0;

  if (sku && sku === query.normalized) score += 160;
  if (sku && compactKey(sku) === query.compact) score += 150;
  if (title.includes(query.normalized)) score += 120;
  if (item.text.includes(query.normalized)) score += 100;
  if (query.compact.length >= 4 && item.compact.includes(query.compact)) score += 95;
  if (title.startsWith(query.normalized)) score += 30;

  if (item.brand && query.tokens.includes(normalize(item.brand))) score += 35;

  for (const token of query.modelTokens) score += modelTokenScore(token, item.compact, item.tokens);

  for (const queryToken of query.tokens) {
    let best = 0;
    for (const targetToken of item.tokens) {
      best = Math.max(best, fuzzyTokenScore(queryToken, targetToken));
      if (best >= 26) break;
    }
    score += best;
  }

  const matchedTokens = query.tokens.filter((queryToken) => {
    if (isModelToken(queryToken)) return modelTokenScore(queryToken, item.compact, item.tokens) >= 46;
    return item.tokens.some((targetToken) => fuzzyTokenScore(queryToken, targetToken) >= 10);
  }).length;

  if (query.tokens.length > 0) {
    const ratio = matchedTokens / query.tokens.length;
    if (ratio >= 0.75) score += 45;
    else if (ratio >= 0.5 && query.modelTokens.length) score += 30;
    else if (ratio < 0.34) score -= 60;
  }

  if (query.modelTokens.length && !query.modelTokens.some((token) => modelTokenScore(token, item.compact, item.tokens) >= 46)) score -= 120;

  return score;
}

function printerScore(printer: IndexedPrinter, query: QueryInfo) {
  let score = 0;

  if (printer.text.includes(query.normalized)) score += 150;
  if (query.compact.length >= 4 && printer.compact.includes(query.compact)) score += 130;

  for (const token of query.modelTokens) score += modelTokenScore(token, printer.compact, printer.tokens);

  for (const queryToken of query.tokens) {
    let best = 0;
    for (const printerToken of printer.tokens) {
      best = Math.max(best, fuzzyTokenScore(queryToken, printerToken));
      if (best >= 26) break;
    }
    score += best;
  }

  const matchedTokens = query.tokens.filter((queryToken) => {
    if (isModelToken(queryToken)) return modelTokenScore(queryToken, printer.compact, printer.tokens) >= 46;
    return printer.tokens.some((printerToken) => fuzzyTokenScore(queryToken, printerToken) >= 10);
  }).length;

  if (query.tokens.length) {
    const ratio = matchedTokens / query.tokens.length;
    if (ratio >= 0.75) score += 55;
    else if (ratio >= 0.5 && query.modelTokens.length) score += 35;
    else if (ratio < 0.34) score -= 80;
  }

  if (query.modelTokens.length && !query.modelTokens.some((token) => modelTokenScore(token, printer.compact, printer.tokens) >= 46)) score -= 150;

  return score;
}

function productItem(item: IndexedProduct, relevance: number) {
  const product = item.product;
  const categoryText = Array.isArray(product.categories) ? product.categories.map((cat: any) => cat.name || cat.slug || "").filter(Boolean).join(", ") : "";
  return {
    id: product.id,
    sku: product.sku || "",
    title: product.name || "Produkt",
    subtitle: [item.brand, categoryText, product.product_type_label].filter(Boolean).join(" · "),
    url: `/produkt/${product.slug || product.id}`,
    image: product.image || "",
    price: Number(product.price || 0),
    type: product.product_type_key || "product",
    typeLabel: product.product_type_label || "PRODUKT",
    relevance,
    printers: product.printers || [],
    brand: item.brand,
    categories: Array.isArray(product.categories) ? product.categories.map((cat: any) => ({ label: cat.name || cat.slug || "", value: cat.slug || cat.name || "" })).filter((cat: any) => cat.label) : [],
  };
}

function filteredStaticSuggestions(query: QueryInfo) {
  const brands = BRANDS.filter((brand) => {
    const normalizedBrand = normalize(brand);
    return normalizedBrand.includes(query.normalized) || compactKey(brand).includes(query.compact) || query.tokens.some((token) => fuzzyTokenScore(token, normalizedBrand) >= 10);
  }).slice(0, 8).map((brand) => ({ title: brand, subtitle: "Značka", url: `/produkty?brand=${encodeURIComponent(brand)}` }));

  const categories = CATEGORIES.filter((category) => normalize(category.label).includes(query.normalized) || normalize(category.value).includes(query.normalized) || compactKey(category.label).includes(query.compact)).slice(0, 6).map((category) => ({ title: category.label, subtitle: "Kategória", url: `/produkty?category=${encodeURIComponent(category.value)}` }));
  return { brands, categories };
}

function sortSuggestionProducts(items: any[]) {
  return [...items].sort((a, b) => {
    const relevanceDiff = Number(b.relevance || 0) - Number(a.relevance || 0);
    if (relevanceDiff) return relevanceDiff;
    const typeDiff = (TYPE_ORDER[a.type] || 99) - (TYPE_ORDER[b.type] || 99);
    if (typeDiff) return typeDiff;
    return String(a.title || "").localeCompare(String(b.title || ""), "sk");
  });
}

function makeProductGroups(items: any[], query: string) {
  return ["compatible", "original", "renovated", "product"].map((type) => {
    const count = items.filter((item) => item.type === type).length;
    if (!count) return null;
    const label = TYPE_LABEL[type] || "Ostatné";
    return { title: `${label} (${count})`, subtitle: `${count} produkt${count === 1 ? "" : count < 5 ? "y" : "ov"} · zobraziť`, url: `/produkty?s=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`, type, count };
  }).filter(Boolean);
}

function findPrinterSuggestions(items: IndexedProduct[], query: QueryInfo) {
  const bestByPrinter = new Map<string, { title: string; score: number }>();

  const candidateItems = items.filter((item) => isLikelyCandidate(item, query)).slice(0, 900);

  for (const item of candidateItems) {
    for (const printer of item.printers) {
      if (query.modelTokens.length && !query.modelTokens.some((token) => printer.compact.includes(compactKey(token)))) continue;
      if (query.brandTokens.length && !query.brandTokens.some((brand) => printer.text.includes(brand))) continue;

      const score = printerScore(printer, query);
      if (score < 55) continue;
      const current = bestByPrinter.get(printer.key);
      if (!current || score > current.score) bestByPrinter.set(printer.key, { title: printer.title, score });
    }
  }

  return [...bestByPrinter.values()]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "sk"))
    .slice(0, 10)
    .map((item) => ({ title: item.title, subtitle: "Tlačiareň · zobraziť kompatibilné produkty", url: `/produkty?s=${encodeURIComponent(item.title)}&printer=${encodeURIComponent(item.title)}`, relevance: item.score }));
}

function findProductSuggestions(items: IndexedProduct[], query: QueryInfo) {
  const candidates = items.filter((item) => isLikelyCandidate(item, query)).slice(0, 900);
  return sortSuggestionProducts(
    candidates
      .map((item) => productItem(item, relevanceScore(item, query)))
      .filter((item) => item.relevance >= 65),
  ).slice(0, 80);
}

export const GET: APIRoute = async ({ url }) => {
  const q = String(url.searchParams.get("q") || url.searchParams.get("search") || "").trim();

  if (q.length < 2) return jsonResponse({ ok: true, query: q, printers: [], productGroups: [], products: [], brands: [], categories: [] });

  try {
    const cache = await getProductsCache();
    const index = getSearchIndex(cache);
    const query = queryInfo(q);
    const products = findProductSuggestions(index, query);
    const staticResults = filteredStaticSuggestions(query);
    const printerItems = findPrinterSuggestions(index, query);

    const brandMap = new Map<string, { title: string; subtitle: string; url: string }>();
    staticResults.brands.forEach((brand) => brandMap.set(compactKey(brand.title), brand));
    products.forEach((product: any) => {
      if (!product.brand || brandMap.has(compactKey(product.brand))) return;
      brandMap.set(compactKey(product.brand), { title: product.brand, subtitle: "Značka", url: `/produkty?brand=${encodeURIComponent(product.brand)}` });
    });

    const categoryMap = new Map<string, { title: string; subtitle: string; url: string }>();
    staticResults.categories.forEach((category) => categoryMap.set(compactKey(category.title), category));
    products.forEach((product: any) => {
      (product.categories || []).forEach((category: any) => {
        const title = category.label;
        const value = category.value;
        if (!title || categoryMap.has(compactKey(title))) return;
        categoryMap.set(compactKey(title), { title, subtitle: "Kategória", url: `/produkty?category=${encodeURIComponent(value)}` });
      });
    });

    return jsonResponse({
      ok: true,
      source: "local-products-cache-fast-fuzzy",
      cache_generated_at: cache.generated_at,
      query: q,
      printers: printerItems,
      productGroups: makeProductGroups(products, q),
      products: products.slice(0, 12),
      brands: [...brandMap.values()].slice(0, 8),
      categories: [...categoryMap.values()].slice(0, 8),
    }, 200, "private, max-age=30");
  } catch (error: any) {
    const fallback = filteredStaticSuggestions(queryInfo(q));
    return jsonResponse({ ok: true, query: q, printers: [], productGroups: [], products: [], brands: fallback.brands, categories: fallback.categories, warning: error?.message || "Smart search fallback" }, 200, "no-store");
  }
};
