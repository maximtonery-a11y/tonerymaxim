type SitemapSource = {
  products?: unknown[];
  printers?: unknown[];
  oems?: unknown[];
  brands?: unknown[];
  guides?: unknown[];
};

export function buildSitemaps(data: SitemapSource | null | undefined) {
 const source = data || {};
 return {
  products:source.products||[],
  printers:source.printers||[],
  oems:source.oems||[],
  brands:source.brands||[],
  guides:source.guides||[]
 };
}
