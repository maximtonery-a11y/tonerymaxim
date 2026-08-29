import type { NormalizedCartItem } from "./checkout-order";
import { getProductsCache, compactKey, type TmProduct } from "./tm-products-cache";
import { wooRequest } from "./woo-client";
import {
  LOYALTY_PAPER_PRICE,
  LOYALTY_PAPER_PRODUCT_SKU,
  LOYALTY_PAPER_REWARD_SKU,
  type getCustomerLoyalty,
} from "./loyalty";
import { CALENDAR_SOURCE, calendarDiscountRate, getCalendarProducts } from "./calendar-catalog";

type RawCartItem = {
  id?: string | number;
  productId?: string | number;
  product_id?: string | number;
  sku?: string;
  qty?: number | string;
  quantity?: number | string;
  loyalty_reward?: boolean;
  name?: string;
  title?: string;
  price?: number | string;
  source?: string;
};

class CheckoutCartError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "CheckoutCartError";
    this.status = status;
  }
}

function money(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function normalizeQty(value: unknown) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number) || number < 1) return 1;
  if (number > 99) return 99;
  return number;
}

function productIdFromItem(item: RawCartItem) {
  const raw = item.product_id ?? item.productId ?? item.id;
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? String(number) : "";
}

function skuFromItem(item: RawCartItem) {
  return String(item.sku || "").trim();
}

function isRequestedPaperReward(item: RawCartItem) {
  if (item?.loyalty_reward === true) return true;
  const name = String(item?.name || item?.title || "").trim().toLowerCase();
  const price = money(item?.price);
  return name.startsWith("vernostná odmena")
    || skuFromItem(item) === LOYALTY_PAPER_REWARD_SKU
    || (skuFromItem(item) === LOYALTY_PAPER_PRODUCT_SKU && price > 0 && price <= LOYALTY_PAPER_PRICE);
}

export function cartRequestsPaperReward(rawCart: unknown) {
  return Array.isArray(rawCart) && rawCart.some((item) => isRequestedPaperReward((item || {}) as RawCartItem));
}

function productKey(product: TmProduct) {
  return {
    id: String(product.id || ""),
    sku: String(product.sku || "").trim(),
  };
}

function indexProducts(products: TmProduct[]) {
  const byId = new Map<string, TmProduct>();
  const bySku = new Map<string, TmProduct>();

  for (const product of products) {
    const key = productKey(product);
    if (key.id) byId.set(key.id, product);
    if (key.sku) bySku.set(compactKey(key.sku), product);
  }

  return { byId, bySku };
}

function resolveProduct(item: RawCartItem, index: ReturnType<typeof indexProducts>) {
  const id = productIdFromItem(item);
  const sku = skuFromItem(item);

  if (id && index.byId.has(id)) return index.byId.get(id) || null;
  if (sku && index.bySku.has(compactKey(sku))) return index.bySku.get(compactKey(sku)) || null;
  return null;
}

function isPurchasable(product: TmProduct) {
  const status = String(product.stock_status || "").toLowerCase();
  const price = money(product.price);
  if (price <= 0) return false;
  if (status === "outofstock") return false;
  return true;
}

export function isCompatibleDiscountItem(item: NormalizedCartItem) {
  const type = String(item.product_type_key || "").toLowerCase();
  const label = String(item.product_type_label || item.name || "").toLowerCase();
  return type === "compatible" || label.includes("kompatibil");
}

export function discountRate(item: NormalizedCartItem) {
  if (String(item.source || "") === CALENDAR_SOURCE) return calendarDiscountRate(item.qty);
  if (!isCompatibleDiscountItem(item)) return 0;
  if (item.qty >= 4) return 0.25;
  if (item.qty >= 2) return 0.10;
  return 0;
}

export function discountedLine(item: NormalizedCartItem) {
  const original = money(item.price * item.qty);
  const discount = Math.round(original * discountRate(item) * 100) / 100;
  return {
    original,
    discount,
    final: Math.max(0, Math.round((original - discount) * 100) / 100),
  };
}

export async function normalizeSecureCheckoutCart(rawCart: unknown, options: {
  customerId?: number;
  loyalty?: Awaited<ReturnType<typeof getCustomerLoyalty>> | null;
} = {}): Promise<NormalizedCartItem[]> {
  const input = Array.isArray(rawCart) ? rawCart : [];
  if (!input.length) return [];
  if (input.length > 30) throw new CheckoutCartError("Košík obsahuje príliš veľa rôznych položiek.", 400);

  const requestedReward = cartRequestsPaperReward(input);
  const regularInput = input.filter((raw: any) => !isRequestedPaperReward(raw));
  const rewardPacks = requestedReward && options.customerId
    ? Math.max(0, Math.floor(Number(options.loyalty?.paperReward?.availablePacks || 0)))
    : 0;
  if (!regularInput.length) return [];
  const secureInput: RawCartItem[] = [...regularInput];
  if (rewardPacks > 0) secureInput.push({ sku: LOYALTY_PAPER_PRODUCT_SKU, qty: rewardPacks, loyalty_reward: true });
  const calendarProducts = secureInput.some((item) => String(item?.source || "") === CALENDAR_SOURCE)
    ? await getCalendarProducts()
    : [];
  const calendarBySku = new Map(calendarProducts.map((product) => [product.sku, product]));
  const wooInput = secureInput.filter((item) => String(item?.source || "") !== CALENDAR_SOURCE);
  const cache = wooInput.length ? await getProductsCache() : null;
  const products = Array.isArray(cache?.products) ? cache.products : [];
  const index = indexProducts(products);
  const resolved = wooInput.map((raw) => {
    const item = (raw || {}) as RawCartItem;
    const product = resolveProduct(item, index);
    const requested = skuFromItem(item) || productIdFromItem(item) || "neznámy produkt";
    if (!product) throw new CheckoutCartError(`Produkt sa nenašiel alebo už nie je dostupný: ${requested}`);
    return { item, cached: product, requested };
  });
  const ids = [...new Set(resolved.map(({ cached }) => Number(cached.id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length !== new Set(resolved.map(({ cached }) => String(cached.id))).size) {
    throw new CheckoutCartError("Niektorý produkt nemá platné ID a nemožno overiť jeho dostupnosť.");
  }
  const liveProducts = ids.length
    ? await wooRequest<any[]>("/products", {
      query: { include: ids.join(","), per_page: Math.min(100, ids.length), status: "publish" },
    })
    : [];
  const liveById = new Map((Array.isArray(liveProducts) ? liveProducts : []).map((product) => [String(product.id), product]));
  const requestedById = new Map<string, number>();
  const result: NormalizedCartItem[] = [];

  for (const item of secureInput.filter((raw) => String(raw?.source || "") === CALENDAR_SOURCE)) {
    const sku = skuFromItem(item);
    const product = calendarBySku.get(sku);
    if (!product) throw new CheckoutCartError(`Kalendár sa nenašiel alebo už nie je dostupný: ${sku || "neznámy produkt"}`);
    if (!product.availability.inStock) {
      throw new CheckoutCartError(`Kalendár je momentálne vypredaný. Dostupnosť môžete overiť pri produkte: ${product.name}`);
    }
    const qty = normalizeQty(item.qty ?? item.quantity ?? 1);
    result.push({
      id: `calendar:${product.sku}`,
      sku: product.sku,
      name: product.name,
      price: product.price,
      qty,
      product_type_key: "calendar",
      product_type_label: product.category || "Kalendár 2027",
      source: CALENDAR_SOURCE,
    });
  }

  for (const { item, cached, requested } of resolved) {
    const live = liveById.get(String(cached.id));
    if (!live) throw new CheckoutCartError(`Produkt už nie je publikovaný alebo dostupný: ${cached.name || requested}`);
    const product = { ...cached, ...live };
    const isReward = item.loyalty_reward === true && String(product.sku || "").trim() === LOYALTY_PAPER_PRODUCT_SKU;
    if (!isPurchasable(product)) {
      throw new CheckoutCartError(`Produkt nie je dostupný na objednanie: ${product.name || requested}`);
    }
    const qty = normalizeQty(item.qty ?? item.quantity ?? 1);
    const totalRequested = (requestedById.get(String(product.id)) || 0) + qty;
    requestedById.set(String(product.id), totalRequested);
    const stockQuantity = Number(product.stock_quantity);
    if (product.manage_stock === true && Number.isFinite(stockQuantity) && stockQuantity >= 0 && totalRequested > stockQuantity) {
      throw new CheckoutCartError(`Na sklade nie je požadované množstvo produktu ${product.name || requested}. Dostupné množstvo: ${stockQuantity} ks.`);
    }

    result.push({
      id: String(product.id || ""),
      productId: product.id,
      product_id: product.id,
      sku: isReward ? LOYALTY_PAPER_REWARD_SKU : String(product.sku || ""),
      name: String(isReward ? options.loyalty?.paperReward?.name : (product.name || product.sku || product.id || "Produkt")).slice(0, 160),
      price: isReward ? LOYALTY_PAPER_PRICE : money(product.price),
      qty,
      product_type_key: String(product.product_type_key || ""),
      product_type_label: String(product.product_type_label || ""),
      loyalty_reward: isReward,
    });
  }

  return result;
}
