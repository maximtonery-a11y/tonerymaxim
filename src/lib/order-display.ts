type OrderMeta = { key?: string; value?: unknown };
export const TM_ORDER_NUMBER_META = ['tm_order_number', 'gopay_order_number', 'tm_order_snapshot'] as const;

/** These are the checkout's own references. Woo's number and ID identify its record. */
export function tmOrderNumber(order?: { meta_data?: OrderMeta[] } | null): string {
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : [];
  for (const key of TM_ORDER_NUMBER_META) {
    for (const entry of meta) {
      if (entry?.key !== key) continue;
      let value = entry.value;
      if (key === 'tm_order_snapshot') {
        try {
          const snapshot = typeof value === 'string' ? JSON.parse(value) : value;
          value = snapshot?.orderNumber;
        } catch { continue; }
      }
      const number = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
      if (/^(?:TM[-/]?)?\d+(?:[./-]\d+)*$/i.test(number) && number.length <= 80) return number;
    }
  }
  return '';
}

/** WooCommerce vracia cenu riadku bez DPH v `total` a daň zvlášť. */
export function orderLineGrossTotal(item: { total?: unknown; total_tax?: unknown }): number {
  const total = Number(String(item?.total ?? "0").replace(",", "."));
  const tax = Number(String(item?.total_tax ?? "0").replace(",", "."));
  return Math.round(((Number.isFinite(total) ? total : 0) + (Number.isFinite(tax) ? tax : 0)) * 100) / 100;
}
