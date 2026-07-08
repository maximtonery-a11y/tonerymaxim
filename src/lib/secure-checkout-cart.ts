import type { NormalizedCartItem } from "./checkout-order";
import { getProductsCache, compactKey, type TmProduct } from "./tm-products-cache";

type RawCartItem = {
  id?: string | number;
  productId?: string | number;
  product_id?: string | number;
  sku?: string;
  qty?: number | string;
  quantity?: number | string;
};

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

export async function normalizeSecureCheckoutCart(rawCart: unknown): Promise<NormalizedCartItem[]> {
  const input = Array.isArray(rawCart) ? rawCart : [];
  if (!input.length) return [];

  const cache = await getProductsCache();
  const products = Array.isArray(cache?.products) ? cache.products : [];
  const index = indexProducts(products);
  const result: NormalizedCartItem[] = [];

  for (const raw of input) {
    const item = (raw || {}) as RawCartItem;
    const product = resolveProduct(item, index);
    const requested = skuFromItem(item) || productIdFromItem(item) || "neznámy produkt";

    if (!product) {
      throw new Error(`Produkt sa nenašiel alebo už nie je dostupný: ${requested}`);
    }

    if (!isPurchasable(product)) {
      throw new Error(`Produkt nie je dostupný na objednanie: ${product.name || requested}`);
    }

    result.push({
      id: String(product.id || ""),
      productId: product.id,
      product_id: product.id,
      sku: String(product.sku || ""),
      name: String(product.name || product.sku || product.id || "Produkt").slice(0, 160),
      price: money(product.price),
      qty: normalizeQty(item.qty ?? item.quantity ?? 1),
      product_type_key: String(product.product_type_key || ""),
      product_type_label: String(product.product_type_label || ""),
    });
  }

  return result;
}
