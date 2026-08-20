import { getProductsCache, compactKey } from '../tm-products-cache.ts';
import { analyzeCatalogQuery, findExactPrinterModelMatches, findExactProductIdentityMatches, partialPrinterModelMatch, productPrinterValues } from '../catalog-query.ts';

export type CommerceProduct = {
  id: number; sku: string; name: string; price: number; stock_status: string;
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
  const products = (cache.products || []).filter(isValidOffer);
  const looksLikeConsumableName=/\b(?:toner|napln|náplň|atrament|cartridge|kazeta)\b/i.test(query);
  const looksLikePrinterQuery=!looksLikeConsumableName&&/\b(?:hp|brother|canon|epson|samsung|oki|xerox|kyocera|lexmark|ricoh|sharp|toshiba|pantum|dell|utax|konica|minolta)\b/i.test(query)&&/\d{3,}/.test(query)&&!/\b(?:CF|CE|CRG|TN|DR|CLT|MLT|TK|PGI|CLI|LC)[- ]?\d/i.test(query);
  const exact = looksLikePrinterQuery ? [] : findExactProductIdentityMatches(products, query).map(m => m.product).filter(p => !isPrinterDevice(p));
  let printer = exact.length ? [] : findExactPrinterModelMatches(products, query).map(m => m.product);
  const isConsumable = (p:any) => {
    const text=`${p?.name||''} ${p?.product_type_label||''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return !isPrinterDevice(p) && !/\b(valec|optick|drum|fuser|fixac|prenosov.*pas|transfer.*belt|odpadov)/i.test(text);
  };
  // Zákazníci bežne vynechajú koncovku modelu (napr. Kyocera P2040
  // namiesto P2040dn/P2040dw). Presné hľadanie zostáva prvé; bezpečný
  // alfanumerický prefix použijeme iba vtedy, keď presná zhoda neexistuje.
  if (!exact.length) {
    const analysis = analyzeCatalogQuery(query);
    let partial = products.filter((product: any) => productPrinterValues(product).some((model) => partialPrinterModelMatch(model, analysis)));
    const minoltaModel=query.match(/(?:konica\s+minolta|minolta)\D{0,30}(\d{3,5})/i)?.[1];
    if(minoltaModel){
      const byInflectedMinolta=products.filter((product:any)=>productPrinterValues(product).some(model=>/\b(?:konica\s+)?minolta\b/i.test(model)&&new RegExp(`\\b${minoltaModel}(?:[a-z]{0,3})?\\b`,'i').test(model)));
      partial=[...new Map([...partial,...byInflectedMinolta].map((p:any)=>[String(p.id),p])).values()];
    }
    if (partial.some(isConsumable)) {
      // Scórované presné hľadanie môže vrátiť iba časť produktovej rodiny.
      // Bezpečné zhody rovnakého modelu preto doplníme, aby AI videla všetky
      // typy a farby vrátane momentálne nedostupných variantov.
      printer = [...new Map([...printer,...partial].map((p:any)=>[String(p.id),p])).values()];
    }
  }
  let found = exact.length ? exact : printer;
  if (!exact.length && printer.length) {
    const consumables = printer.filter(isConsumable);
    if (consumables.length) found = consumables;
  }
  const code = String(query).match(/\b(?:CF|CE|CRG|TN|DR|W|Q|CLT|MLT|TK|PGI|CLI|LC)[- ]?\d{2,}[A-Z0-9-]*\b/i)?.[0];
  if (code) {
    const wanted = compactKey(code);
    const family = products.filter((p: any) => compactKey(`${p.sku || ''} ${p.name || ''}`).includes(wanted));
    if (family.length) found = family;
  }
  const unique = [...new Map(found.map((p: any) => [String(p.id), p])).values()]
    .sort((a: any, b: any) => {
      const order: Record<string, number> = { compatible: 1, original: 2, renovated: 3 };
      return Number(!purchasable(a)) - Number(!purchasable(b)) ||
        (order[productType(a)] || 9) - (order[productType(b)] || 9) || Number(a.price || 0) - Number(b.price || 0);
    })
    .slice(0, 40)
    .map(asCommerceProduct);
  return { products: unique, source: exact.length ? 'product' : printer.length ? 'printer' : 'none' };
}
