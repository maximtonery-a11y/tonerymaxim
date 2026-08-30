/** WooCommerce vracia cenu riadku bez DPH v `total` a daň zvlášť. */
export function orderLineGrossTotal(item: { total?: unknown; total_tax?: unknown }): number {
  const total = Number(String(item?.total ?? "0").replace(",", "."));
  const tax = Number(String(item?.total_tax ?? "0").replace(",", "."));
  return Math.round(((Number.isFinite(total) ? total : 0) + (Number.isFinite(tax) ? tax : 0)) * 100) / 100;
}
