export const ORDER_DELIVERY_LABEL = "Predpokladané dodanie 3–10 pracovných dní";

type ProductLike = Record<string, any> | null | undefined;

export function isAvailableNow(product: ProductLike) {
  if (String(product?.stock_status || "").toLowerCase() !== "instock") return false;
  const quantity = product?.stock_quantity;
  if (quantity === null || quantity === undefined || String(quantity).trim() === "") return true;
  const parsed = Number(quantity);
  return Number.isFinite(parsed) && parsed > 0;
}

export function storefrontStockText(product: ProductLike) {
  if (!isAvailableNow(product)) return "Na objednávku";
  const quantity = product?.stock_quantity;
  return quantity !== null && quantity !== undefined && String(quantity).trim() !== ""
    ? `Skladom ${quantity} ks`
    : "Skladom";
}

export function storefrontStockClass(product: ProductLike) {
  return isAvailableNow(product) ? "is-instock" : "is-backorder";
}
