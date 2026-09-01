import { filterProducts, getProductsCache } from '../tm-products-cache.ts';
import { findExactPrinterModelMatches, findExactProductIdentityMatches, productPrinterValues } from '../catalog-query.ts';
import { consumablePrinterFamilyKey } from '../printer-model-family.ts';

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

function normalizedColor(value: unknown) {
  const raw = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/(?:\bblack\b|cier)/.test(raw) || /(?:^|[-_\s])bk(?:$|[-_\s])/.test(raw)) return 'black';
  if (/(?:\bcyan\b|azur)/.test(raw)) return 'cyan';
  if (/(?:\bmagenta\b|purpur)/.test(raw)) return 'magenta';
  if (/(?:\byellow\b|zlt)/.test(raw)) return 'yellow';
  return '';
}

export function productColor(p: any) {
  // Kompaktná runtime cache zámerne neobsahuje celé Woo atribúty. Farba je
  // už normalizovaná v priamom poli produktu, preto ju musíme použiť ako
  // prvý a autoritatívny zdroj. Inak sa farebná tlačiareň vydávala za mono.
  const direct = normalizedColor(p?.color || p?.farba || p?.colour);
  if (direct) return direct;
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

export function productCapacity(p: any) {
  // Rovnako ako farba zostáva kapacita v kompaktnej cache v priamom poli.
  // Atribúty sú iba záložný zdroj pre staršiu alebo nekompaktnú cache.
  return String(
    p?.capacity || p?.kapacita || p?.yield || p?.page_yield
    || textAttribute(p,['kapacita','výťažnosť','vytaznost','yield']) || ''
  ).trim();
}

function stockQuantity(p: any) {
  const value = p?.stock_quantity;
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    stock_quantity: stockQuantity(p),
    type: productType(p), image: String(p.image || p.images?.[0]?.src || ''),
    url: String(p.detail_url || p.url || (p.slug ? `/produkt/${p.slug}` : '/produkty')),
    color: productColor(p), capacity: productCapacity(p),
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

type AiPrinterIndex = { exact: Map<string, any[]>; family: Map<string, any[]> };
const AI_PRINTER_ASSIGNMENT_INDEX = new WeakMap<any[], AiPrinterIndex>();
function compactPrinterKey(value: unknown) {
  return String(value || '').toLocaleLowerCase('sk-SK').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
function printerAssignmentIndex(products: any[]) {
  const cached = AI_PRINTER_ASSIGNMENT_INDEX.get(products);
  if (cached) return cached;
  const index: AiPrinterIndex = { exact: new Map(), family: new Map() };
  for (const product of products) for (const printer of productPrinterValues(product)) {
    const key = compactPrinterKey(printer);
    if (key) {
      const entries = index.exact.get(key) || [];
      entries.push(product);
      index.exact.set(key, entries);
    }
    const family = consumablePrinterFamilyKey(printer);
    if (family) {
      const entries = index.family.get(family) || [];
      entries.push(product);
      index.family.set(family, entries);
    }
  }
  AI_PRINTER_ASSIGNMENT_INDEX.set(products, index);
  return index;
}

export async function resolveCommerceProducts(query: string) {
  const cache = await getProductsCache();
  // AI musí poznať aj platné produkty, ktoré momentálne nie sú skladom. Iba tak
  // vie podať úplnú ponuku a ponúknuť zistenie dostupnosti. Do košíka sa naďalej
  // smú dostať len skladové produkty (kontroluje UI aj serverová validácia).
  // Rovnaký výber produktov používa stránka /produkty aj API /api/products.
  // AI už nesmie udržiavať vlastný zoznam prefixov (ten napr. nepoznal CL-586),
  // preto zdieľa celý katalógový parser a filter s hlavným vyhľadávaním.
  const allProducts = cache.products || [];
  const normalizedQuery = compactPrinterKey(query);
  // Úplné interné SKU je jednoznačnejšie než rodina OEM alebo číslo modelu.
  // Napr. DR-1050-KOM-13968 sa nesmie rozšíriť na produkty, ktoré iba
  // obsahujú 1050 alebo 13968, a optický valec sa nesmie odfiltrovať ako
  // vedľajší diel, keď ho zákazník hľadá presným SKU.
  const exactSku = allProducts.filter((product: any) => compactPrinterKey(product?.sku) === normalizedQuery)
    .filter(isValidOffer)
    .filter((product: any) => !isPrinterDevice(product));
  if (exactSku.length) {
    const products = exactSku.sort((a: any, b: any) => Number(!purchasable(a)) - Number(!purchasable(b)))
      .map(asCommerceProduct);
    return { products, source: 'product' };
  }
  // Textový index slúži iba ako rýchly predvýber pre skrátené používateľské
  // zápisy. Presný model zároveň vyberieme z izolovaného AI indexu všetkých
  // štruktúrovaných priradení, takže produkt nemôže vypadnúť iba preto, že
  // jeho skrátený search_text neobsahuje celý model.
  const loose = filterProducts(allProducts, { search: query });
  const assignmentIndex = printerAssignmentIndex(allProducts);
  const directlyAssigned = assignmentIndex.exact.get(normalizedQuery) || [];
  const familyAssigned = assignmentIndex.family.get(consumablePrinterFamilyKey(query)) || [];
  const structuredLoose = findExactPrinterModelMatches(loose, query).map(m => m.product);
  const printer = [...new Map([...directlyAssigned, ...familyAssigned, ...structuredLoose].map((p: any) => [String(p.id), p])).values()]
    .filter(isValidOffer)
    .filter((product: any) => !isPrinterDevice(product));
  // Presné štruktúrované priradenie tlačiarne je autoritatívne. Predošlá
  // implementácia ho síce vypočítala, ale následne omylom zobrazila širší
  // výsledok textového vyhľadávania. To pridávalo produkty pre podobné modely
  // a pri veľkých rodinách časť správnych produktov vynechalo.
  const exact = printer.length ? [] : findExactProductIdentityMatches(loose, query).map(m => m.product)
    .filter(isValidOffer).filter((product: any) => !isPrinterDevice(product));
  const fallback = !printer.length && !exact.length
    ? loose.filter(isValidOffer).filter((product: any) => !isPrinterDevice(product))
    : [];
  const isConsumable = (p:any) => {
    const text=`${p?.name||''} ${p?.product_type_label||''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return !isPrinterDevice(p) && !/\b(valec|optick|drum|fuser|fixac|prenosov.*pas|transfer.*belt|odpadov)/i.test(text);
  };
  const matched = printer.length ? printer : exact.length ? exact : fallback;
  const consumables = matched.filter(isConsumable);
  // Pri modeli tlačiarne odpovedáme na otázku o náplniach, preto optický
  // valec ani servisný diel nesmie byť náhradou za prázdny zoznam tonerov.
  // Pri explicitnom produktovom kóde však nechávame aj valec/fuser, aby Tomáš
  // vedel nájsť každý samostatne hľadaný produkt.
  const found = printer.length ? consumables : consumables.length ? consumables : matched;
  const unique = [...new Map(found.map((p: any) => [String(p.id), p])).values()]
    .sort((a: any, b: any) => {
      const order: Record<string, number> = { compatible: 1, original: 2, renovated: 3 };
      return Number(!purchasable(a)) - Number(!purchasable(b)) ||
        (order[productType(a)] || 9) - (order[productType(b)] || 9) || Number(a.price || 0) - Number(b.price || 0);
    })
    // API musí poznať celú priradenú rodinu. UI si môže výsledok dávkovať,
    // ale typový výber a následný nákup nesmú produkt potichu stratiť.
    .slice(0, 120)
    .map(asCommerceProduct);
  return { products: unique, source: printer.length ? 'printer' : exact.length ? 'product' : unique.length ? 'product' : 'none' };
}
