import { filterProducts, getProductsCache } from '../tm-products-cache.ts';
import { findExactPrinterModelMatches, findExactProductIdentityMatches, productPrinterValues } from '../catalog-query.ts';

export type CommerceProduct = {
  id: number | string; sku: string; name: string; price: number; stock_status: string;
  stock_quantity: number | null; type: string; image: string; url: string;
  color: string; capacity: string; compatible_printers: string[]; purchasable: boolean;
};

function textAttribute(p: any, names: string[]) {
  const attrs = Array.isArray(p?.attributes) ? p.attributes : [];
  const hit = attrs.find((a: any) => names.some(n => String(a?.name || '').toLowerCase().includes(n)));
  return hit ? String((hit.options || [])[0] || '') : '';
}

function productColor(p: any) {
  const identity=`${p?.name||''} ${p?.sku||''}`;const ni=identity.toLowerCase();
  if (/(?:\bblack\b|čier|\bcier)/.test(ni) || /(?:^|[-_\s])bk(?:$|[-_\s])/.test(ni)) return 'black';
  if (/(?:\bcyan\b|azúr|\bazur)/.test(ni)) return 'cyan';
  if (/(?:\bmagenta\b|purpur)/.test(ni)) return 'magenta';
  if (/(?:\byellow\b|žlt|\bzlt)/.test(ni)) return 'yellow';
  const raw = `${identity} ${textAttribute(p,['farba','color','colour'])}`; const n=raw.toLowerCase();
  if (/(?:\bblack\b|čier|\bcier)/.test(n) || /(?:^|[-_\s])bk(?:$|[-_\s])/.test(n)) return 'black';
  if (/(?:\bcyan\b|azúr|\bazur)/.test(n) || /[-_\s]c(?:$|[-_\s])/.test(n)) return 'cyan';
  if (/(?:\bmagenta\b|purpur)/.test(n) || /[-_\s]m(?:$|[-_\s])/.test(n)) return 'magenta';
  if (/(?:\byellow\b|žlt|\bzlt)/.test(n) || /[-_\s]y(?:$|[-_\s])/.test(n)) return 'yellow';
  const hp=raw.match(/\b(?:HP\s+)?(?:CF|CE)(\d{2})([0-3])([AX])\b/i);if(hp)return ({'0':'black','1':'cyan','2':'yellow','3':'magenta'} as Record<string,string>)[hp[2]]||'';
  return '';
}

function productType(p: any) {
  const key = String(p.product_type_key || '').toLowerCase();
  if (key) return key;
  const n = String(p.name || '').toLowerCase();
  if (n.includes('origin')) return 'original';
  if (n.includes('renov') || n.includes('repas')) return 'renovated';
  return 'compatible';
}

function asCommerceProduct(p: any): CommerceProduct {
  return {
    id: Number(p.id || 0), sku: String(p.sku || ''), name: String(p.name || 'Produkt'),
    price: Number(p.price || 0), stock_status: String(p.stock_status || ''),
    stock_quantity: Number.isFinite(Number(p.stock_quantity)) ? Number(p.stock_quantity) : null,
    type: productType(p), image: String(p.image || p.images?.[0]?.src || ''),
    url: String(p.detail_url || p.url || (p.slug ? `/produkt/${p.slug}` : '/produkty')),
    color: productColor(p), capacity: textAttribute(p,['kapacita','výťažnosť','vytaznost','yield']),
    compatible_printers: productPrinterValues(p),
    purchasable: purchasable(p),
  };
}

function isValidOffer(p: any) {
  const text = `${p?.name || ''} ${p?.sku || ''} ${p?.slug || ''} ${p?.description || ''} ${p?.short_description || ''}`
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const excluded = /sluzba\s+renovacia|hatona|bez\s+cipu|bezcip|no[\s_-]*chip|without[\s_-]*chip|s\s+oem\s+cipom|oem\s+cip|oem[\s_-]*chip/.test(text);
  return Number(p.price || 0) > 0 && !excluded;
}

function purchasable(p: any) {
  const stock = String(p.stock_status || '').toLowerCase();
  return isValidOffer(p) && stock !== 'outofstock' && Number(p.stock_quantity ?? 1) !== 0;
}

function isPrinterDevice(p: any) {
  const text = `${p?.name || ''} ${p?.product_type_label || ''}`.toLowerCase();
  return (text.includes('tlačiareň') || text.includes('tlaciaren') || /\bprinter\b/.test(text)) && !/\b(toner|cartridge|kazeta|atrament|ink)\b/.test(text);
}

export async function resolveCommerceProducts(query: string) {
  const cache = await getProductsCache();
  // AI musí poznať aj platné produkty, ktoré momentálne nie sú skladom. Iba tak
  // vie podať úplnú ponuku a ponúknuť zistenie dostupnosti. Do košíka sa naďalej
  // smú dostať len skladové produkty (kontroluje UI aj serverová validácia).
  // Rovnaký výber produktov používa stránka /produkty aj API /api/products.
  // AI už nesmie udržiavať vlastný zoznam prefixov (ten napr. nepoznal CL-586),
  // preto zdieľa celý katalógový parser a filter s hlavným vyhľadávaním.
  const products = filterProducts(cache.products || [], { search: query })
    .filter(isValidOffer)
    .filter((product: any) => !isPrinterDevice(product));
  const exact = findExactProductIdentityMatches(products, query).map(m => m.product);
  const printer = exact.length ? [] : findExactPrinterModelMatches(products, query).map(m => m.product);
  const isConsumable = (p:any) => {
    const text=`${p?.name||''} ${p?.product_type_label||''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return !isPrinterDevice(p) && !/\b(valec|optick|drum|fuser|fixac|prenosov.*pas|transfer.*belt|odpadov)/i.test(text);
  };
  const consumables = products.filter(isConsumable);
  const found = consumables.length ? consumables : products;
  const unique = [...new Map(found.map((p: any) => [String(p.id), p])).values()]
    .sort((a: any, b: any) => {
      const order: Record<string, number> = { compatible: 1, original: 2, renovated: 3 };
      return Number(!purchasable(a)) - Number(!purchasable(b)) ||
        (order[productType(a)] || 9) - (order[productType(b)] || 9) || Number(a.price || 0) - Number(b.price || 0);
    })
    .slice(0, 40)
    .map(asCommerceProduct);
  return { products: unique, source: exact.length ? 'product' : printer.length ? 'printer' : unique.length ? 'product' : 'none' };
}
