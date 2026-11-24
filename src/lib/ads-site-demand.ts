import { findExactProductIdentityMatches, findExactPrinterModelMatches, type CatalogProduct } from "./catalog-query.ts";
import type { TMAnalyticsEvent } from "./tm-analytics.ts";

const windowMs = 60 * 60 * 1000;
const searchTitle = /^(.*?)\s+[–—]\s+tonery a náplne\s*\|\s*ToneryMaxim\.sk$/i;

export function isDemandProduct(product: CatalogProduct) {
  return product.product_type_key === "compatible" ||
    (product.product_type_key === "renovated" && /^Canon\s+PFI[\s-]*\d/i.test(product.name || ""));
}

export function siteDemand(products: CatalogProduct[], events: TMAnalyticsEvent[], now: number) {
  const catalog = products.filter(isDemandProduct);
  const aliases = new Map<string, Set<CatalogProduct>>();
  for (const product of products) {
    for (const key of new Set([String(product.id), String(product.sku || "")])) {
      if (!key) continue;
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key)!.add(product);
    }
  }
  const memo = new Map<string, CatalogProduct[]>();
  const signals = new Map<CatalogProduct, { searches: Set<string>; carts: Set<string>; bulkCarts: Set<string> }>();
  function signal(product: CatalogProduct) {
    if (!signals.has(product)) signals.set(product, { searches: new Set(), carts: new Set(), bulkCarts: new Set() });
    return signals.get(product)!;
  }
  for (const event of events) {
    const stamp = Date.parse(event.ts);
    if (event.owner || !event.sessionId || !Number.isFinite(stamp) || stamp <= now - windowMs || stamp > now) continue;
    if (event.type === "add_to_cart") {
      for (const entry of String(event.meta?.item_ids || "").split("|")) {
        const part = entry.match(/^(.+):([1-9]\d*)$/);
        if (!part) continue;
        const matches = aliases.get(part[1]);
        if (matches?.size !== 1) continue;
        const product = [...matches][0];
        if (!isDemandProduct(product)) continue;
        signal(product).carts.add(event.sessionId);
        if (Number(part[2]) >= 4) signal(product).bulkCarts.add(event.sessionId);
      }
      continue;
    }
    const submitted = event.type === "search" ? event.search :
      event.type === "pageview" && event.path === "/produkty" ? event.title?.match(searchTitle)?.[1] : "";
    // Only exact catalogue references become output. Never publish free-form search or visit identifiers.
    if (!submitted || submitted.length > 100 || /[@<>:]|\/\//.test(submitted)) continue;
    const query = submitted.replace(/\bPI[ -]?570(?=\b|XL)/ig, "PGI-570").trim();
    if (!memo.has(query)) {
      const hits = findExactProductIdentityMatches(catalog, query);
      const matches = hits.length ? hits : findExactPrinterModelMatches(catalog, query);
      memo.set(query, matches.map(match => match.product));
    }
    for (const product of memo.get(query)!) signal(product).searches.add(event.sessionId);
  }
  return [...signals].map(([product, data]) => ({
    offer_id: String(product.id), sku: String(product.sku || ""), product_name: product.name,
    product_type: product.product_type_key, stock_status: product.stock_status || null,
    search_sessions_matching_product: data.searches.size,
    add_sessions: data.carts.size, four_or_more_same_item_sessions: data.bulkCarts.size,
  })).sort((a,b) => b.four_or_more_same_item_sessions-a.four_or_more_same_item_sessions ||
    b.add_sessions-a.add_sessions || b.search_sessions_matching_product-a.search_sessions_matching_product ||
    a.offer_id.localeCompare(b.offer_id));
}

export type OfferState = { price_eur: number | null; stock_status: string | null; stock_quantity: number | null };
export function demandOffers(products: CatalogProduct[]): Record<string, OfferState> {
  function amount(value: unknown, price: boolean) {
    if (value == null || String(value).trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && (price ? n > 0 : Number.isInteger(n) && n >= 0) ? n : null;
  }
  return Object.fromEntries(products.filter(isDemandProduct).map(p => [
    String(p.id), {price_eur:amount(p.price,true),stock_status:p.stock_status || null,stock_quantity:amount(p.stock_quantity,false)}
  ]));
}
export function changedOffers(previous: Record<string,OfferState>, current: Record<string,OfferState>, at: string) {
  return [...new Set([...Object.keys(previous),...Object.keys(current)])].flatMap(offer_id => {
    const before = previous[offer_id] ?? null, after = current[offer_id] ?? null;
    return before?.price_eur === after?.price_eur && before?.stock_status === after?.stock_status &&
      before?.stock_quantity === after?.stock_quantity ? [] : [{offer_id,at,before,after}];
  });
}
