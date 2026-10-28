export type OrderItemAvailability = {
  status: "instock" | "onorder" | "partial" | "unknown";
  quantity: number;
  inStockQuantity: number | null;
  onOrderQuantity: number | null;
  checkedAt: string;
};

export function captureOrderAvailability(product: Record<string, any> | null | undefined, quantity: number, checkedAt = new Date().toISOString()): OrderItemAvailability {
  const qty = Math.max(1, Math.min(99, Math.floor(Number(quantity) || 1)));
  const status = String(product?.stock_status || "").toLowerCase();
  const raw = product?.stock_quantity;
  const hasQuantity = raw !== null && raw !== undefined && String(raw).trim() !== "";
  const stock = Number(raw);
  if (!["instock", "outofstock", "onbackorder"].includes(status) || (hasQuantity && !Number.isFinite(stock))) {
    return { status: "unknown", quantity: qty, inStockQuantity: null, onOrderQuantity: null, checkedAt };
  }
  const available = status !== "instock" ? 0 : hasQuantity ? Math.min(qty, Math.max(0, Math.floor(stock))) : qty;
  return {
    status: available === qty ? "instock" : available > 0 ? "partial" : "onorder",
    quantity: qty,
    inStockQuantity: available,
    onOrderQuantity: qty - available,
    checkedAt,
  };
}

export function itemOrderAvailability(item: { qty?: number; quantity?: number; availability?: OrderItemAvailability }): OrderItemAvailability | null {
  const value = item?.availability;
  const quantity = Number(item?.qty ?? item?.quantity ?? 1);
  if (!value || value.quantity !== quantity) return null;
  if (value.status === "unknown") return value;
  const stock = value.inStockQuantity;
  const ordered = value.onOrderQuantity;
  if (!Number.isInteger(stock) || !Number.isInteger(ordered) || Number(stock) < 0 || Number(ordered) < 0 || Number(stock) + Number(ordered) !== quantity) return null;
  if (value.status === "instock" && stock === quantity) return value;
  if (value.status === "onorder" && ordered === quantity) return value;
  if (value.status === "partial" && Number(stock) > 0 && Number(ordered) > 0) return value;
  return null;
}

export function orderAvailabilityText(item: Parameters<typeof itemOrderAvailability>[0]): string {
  const value = itemOrderAvailability(item);
  if (value?.status === "instock") return "Skladom";
  if (value?.status === "onorder") return "Na objednávku · predpokladané dodanie 3–10 pracovných dní";
  if (value?.status === "partial") return `${value.inStockQuantity} ks skladom · ${value.onOrderQuantity} ks na objednávku · predpokladané dodanie 3–10 pracovných dní`;
  return "Dostupnosť vám potvrdíme";
}

export function orderAvailabilityNotice(items: Parameters<typeof itemOrderAvailability>[0][]): string {
  if (items.some((item) => ["onorder", "partial"].includes(itemOrderAvailability(item)?.status || ""))) {
    return "Objednávka obsahuje tovar na objednávku s predpokladaným dodaním 3–10 pracovných dní. Objednávku odošleme naraz po skompletizovaní. O odoslaní vás budeme informovať e-mailom.";
  }
  if (items.some((item) => !itemOrderAvailability(item) || itemOrderAvailability(item)?.status === "unknown")) {
    return "Dostupnosť niektorých položiek vám potvrdíme. O odoslaní objednávky vás budeme informovať e-mailom.";
  }
  return "";
}
