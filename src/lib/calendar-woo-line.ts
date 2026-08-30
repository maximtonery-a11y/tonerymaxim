export type CalendarWooLineItem = {
  source?: string;
  sku?: string;
  name?: string;
};

/**
 * WooCommerce vyžaduje pri každom riadku objednávky product_id alebo sku.
 * Kalendáre zámerne nemajú Woo produkt, preto používajú SKU ako bezpečný
 * odkaz pre manuálny objednávkový riadok. Tonerových položiek sa táto
 * funkcia nedotýka.
 */
export function calendarWooLineReference(item: CalendarWooLineItem, calendarSource: string) {
  if (String(item.source || "") !== calendarSource) return null;

  const sku = String(item.sku || "").trim();
  if (!sku) {
    throw new Error(`SKU kalendára je povinné: ${String(item.name || "Kalendár")}`);
  }

  return { sku };
}
