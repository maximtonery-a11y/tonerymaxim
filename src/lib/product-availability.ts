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

export function orderFulfilmentText(product: ProductLike, requestedQuantity: unknown) {
  const requested = Math.max(1, Math.min(99, Number.parseInt(String(requestedQuantity ?? 1), 10) || 1));
  const rawStock = product?.stock_quantity;
  const parsedStock = Number(rawStock);
  const stock = String(product?.stock_status || "").toLowerCase() === "instock"
    && rawStock !== null
    && rawStock !== undefined
    && String(rawStock).trim() !== ""
    && Number.isFinite(parsedStock)
      ? Math.max(0, Math.floor(parsedStock))
      : 0;

  if (stock <= 0) return `${requested} ks na objednávku · dodanie 3–10 pracovných dní`;
  if (requested <= stock) return `Skladom ${stock} ks`;
  return `${stock} ks skladom · zostávajúce ${requested - stock} ks dodáme do 3–10 pracovných dní`;
}
