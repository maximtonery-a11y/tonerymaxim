type CartProduct = Record<string, any>;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function currentProductUrl(product: CartProduct) {
  const direct = text(product?.detail_url || product?.url);
  if (direct) return direct;
  const slug = text(product?.slug);
  return slug ? `/produkt/${encodeURIComponent(slug)}` : '/produkty';
}

/**
 * Polia, ktoré sa môžu vo WooCommerce meniť, vždy preberáme z práve
 * načítaného katalógu. Údaje uložené v localStorage sú iba dočasná kópia.
 */
export function mergeCurrentCartProduct(item: CartProduct, product: CartProduct) {
  const id = text(product?.id || item?.productId || item?.product_id || item?.id);
  return {
    ...item,
    id,
    productId: id,
    product_id: id,
    sku: text(product?.sku) || text(item?.sku),
    name: text(product?.name) || text(item?.name) || 'Produkt',
    price: Number(product?.price ?? item?.price ?? 0),
    image: text(product?.image || product?.images?.[0]?.src) || text(item?.image),
    url: currentProductUrl(product),
    slug: text(product?.slug),
    stock_status: text(product?.stock_status) || 'outofstock',
    stock_quantity: product?.stock_quantity ?? null,
    stock_text: text(product?.stock_text),
    catalog_verified: true,
    catalog_missing: false,
  };
}

export function markMissingCartProduct(item: CartProduct) {
  const sku = text(item?.sku);
  return {
    ...item,
    url: sku ? `/produkty?s=${encodeURIComponent(sku)}` : '/produkty',
    stock_status: 'outofstock',
    stock_quantity: 0,
    stock_text: 'Produkt už nie je dostupný',
    catalog_verified: true,
    catalog_missing: true,
  };
}

export function cartProductUnavailable(item: CartProduct) {
  if (item?.catalog_missing === true) return true;
  const status = text(item?.stock_status).toLowerCase();
  if (status === 'outofstock') return true;
  const quantity = item?.stock_quantity;
  return quantity !== null && quantity !== undefined && text(quantity) !== '' && Number(quantity) <= 0;
}
