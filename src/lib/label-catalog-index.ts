import { productMaterial } from './product-alternatives.ts';
import { productOemIdentityValue, productPrinterValues } from './catalog-query.ts';
import { validIndexableProduct, entitySlug, printerBrandForName } from './seo-catalog.ts';
import { resolvedPublicationBrand } from './product-publication-policy.ts';
import { isSpecialChipVariantProduct, type TmProduct } from './tm-products-cache.ts';
import { markId, markKey, type CatalogMark } from './label-catalog-match.ts';
import { preferCompatibleOffers, type CatalogLink } from './label-search.ts';

function references(text: string) {
  return (
    text
      .toUpperCase()
      .replace(/\b([A-Z]{1,4})\s+(?=\d{2,6}[A-Z]*\b)/g, '$1-')
      .match(/[A-Z0-9]+(?:[-‐‑][A-Z0-9]+)*/g) || []
  ).filter(
    (word) =>
      /\d/.test(word) && (/[A-Z]/.test(word) || /^\d{3,10}$/.test(word)) && markKey(word).length >= 3,
  );
}
type Group = { mark: CatalogMark; offers: CatalogLink[] };
export async function buildLabelCatalog(products: TmProduct[]) {
  const groups = new Map<string, Group>();
  const printers = new Set<string>();
  // The scanner's first request after an import must leave the event loop available for checkout.
  let processed = 0;
  const yieldToRequests = () => new Promise<void>((resolve) => setImmediate(resolve));
  for (const p of products) {
    if (++processed % 64 === 0) await yieldToRequests();
    if (!validIndexableProduct(p) || isSpecialChipVariantProduct(p)) continue;
    for (const name of productPrinterValues(p)) printers.add(name);
    const title = String(p.name);
    if (/\b(?:sada|multipack|twin|dual pack|bez čipu)\b/i.test(title)) continue;
    const kind = {
      toner: 'Toner',
      ink: 'Atramentová náplň',
      drum: 'Optický valec',
      waste: 'Odpadová nádoba alebo údržbová kazeta',
      belt: 'Prenosový pás',
      fuser: 'Zapekacia jednotka',
      '': 'Diel',
    }[productMaterial(p)];
    const brand = resolvedPublicationBrand(p);
    // Cut descriptive text before yields, warranty and quantities enter the index.
    const lead = title.split(
      /\b(?:čiern|azúrov|purpurov|žlt|kompatibil|originál|renovov|optick|toner\b|atrament|strán)/iu,
    )[0];
    const printed = references(
      lead.toUpperCase().startsWith(brand.toUpperCase() + ' ') ? lead.slice(brand.length) : lead,
    );
    const oem = references(productOemIdentityValue(p));
    const primary = printed[0] || oem[0];
    if (!primary || !brand) continue;
    const color = String(p.color || p.farba || '').trim();
    // A model name may be shared by different cartridges. Preserve additional part numbers.
    const name = [...new Set(printed.length ? printed : [primary])].join(' ');
    const id = markId(brand, name, kind, color);
    let group = groups.get(id);
    if (!group) {
      group = { mark: { id, brand, name, kind, color, refs: [] }, offers: [] };
      groups.set(id, group);
    }
    for (const key of [...printed, ...oem].map(markKey))
      if (!group.mark.refs.includes(key)) group.mark.refs.push(key);
    group.offers.push({
      title,
      url: '/produkt/' + p.slug,
      price: Number(p.price),
      brand,
      type: p.product_type_key,
    });
  }
  for (const name of printers) {
    if (++processed % 256 === 0) await yieldToRequests();
    const brand = printerBrandForName(name);
    if (!brand) continue;
    const id = 'P|' + name,
      refs = references(name.slice(brand.name.length)).map(markKey);
    if (!refs.length) continue;
    groups.set(id, {
      mark: { id, brand: brand.name, name, kind: 'Tlačiareň', color: '', refs },
      offers: [{ title: name, url: '/tlaciarne/' + brand.slug + '/' + entitySlug(name) }],
    });
  }
  for (const group of groups.values()) preferCompatibleOffers(group.offers);
  return groups;
}
