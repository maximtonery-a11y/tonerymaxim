import { parsePageYieldValue } from './ai-page-yield.ts';
import { isAvailableNow } from './product-availability.ts';
import { resolvedPublicationBrand } from './product-publication-policy.ts';
import { specialChipVariantKey, type TmProduct } from './tm-products-cache.ts';

const fold = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const types = ['compatible', 'original', 'renovated'];

function material(product: TmProduct) {
  const text = fold([product.name, product.product_type_detail_label, ...(Array.isArray(product.categories) ? product.categories.map((c: any) => c?.name) : [])].join(' '));
  if (/odpadov|waste|maintenance|udrzb/.test(text)) return 'waste';
  if (/prenosov|transfer|belt/.test(text)) return 'belt';
  if (/zapekac|fuser/.test(text)) return 'fuser';
  if (/optick|fotovalec|\bvalce?\b|\bvalec\b|drum|zobrazovac/.test(text)) return 'drum';
  if (/atrament|inkjet|\bink\b/.test(text)) return 'ink';
  if (/toner/.test(text)) return 'toner';
  return '';
}

// Keep the full cartridge designation, including the colour slot, capacity suffix and
// compound references on sets. A supplier SKU or a printer model is not a cartridge code.
function cartridgeCode(product: TmProduct, brand: string) {
  const name = fold(product.name);
  const marker = fold(brand) + ' ';
  if (!name.startsWith(marker)) return '';
  const title = name.slice(marker.length).replace(/^([a-z]{1,4})\s+(?=\d)/, '$1').replace(/\s*\/\s*/g, '/');
  const match = title.match(/^([a-z\d]+(?:[-/][a-z\d]+)*)(?:\s+(xxl|xl)\b)?/);
  if (!match || !/\d/.test(match[1])) return '';
  return (match[1] + (match[2] || '')).replaceAll('-', '');
}

function capacityFamily(code: string, brand: string) {
  // Brother lists these two yields together in the Slovak HL-L2352DW / MFC-L2712DW manuals.
  if (brand === 'Brother' && /^(tn2411|tn2421)$/.test(code)) return 'tn2411/tn2421';
  if (brand === 'Canon') return code.replace(/^(crg\d+)h(?=bk|[cmyk]$|$)/, '$1').replace(/x{1,2}l/g, '');
  if (brand === 'HP') return code.replace(/^((?:cf|ce|cc|cb|w|q)\d+)[ax]$/, '$1').replace(/xl$/, '');
  return code.replace(/x{1,2}l$/, '');
}

const extraCartridge = /\+\s*[a-z]{1,5}[- ]?\d[a-z\d-]*/g;
const packWords = /\b(?:sada|sady|set|suprava|multipack|multi[ -]pack|dual[ -]?pack|duopack|twin(?:pack)?|troj[ -]?pack|cmyk|cmy)\b/;
function packSize(product: TmProduct) {
  const name = fold(product.name);
  const count = name.match(/\b(\d+)\s*(?:ks|kus(?:y|ov)?)\b/);
  if (count) return Number(count[1]);
  if (/\b(?:duopack|dual[ -]?pack|twin(?:pack)?)\b/.test(name)) return 2;
  if (name.match(extraCartridge) || packWords.test(name + ' ' + fold(product.color)) || /\d\s*[x×*]\s*\d/.test(fold(product.capacity || product.page_yield)) || /\b(?:ce|cf|cb|w|q)\d{3,4}(?:ad|xd)\b/.test(name)) return 0;
  return 1;
}

function profile(product: TmProduct) {
  const brand = resolvedPublicationBrand(product);
  const code = cartridgeCode(product, brand);
  const name = fold(product.name);
  const capacity = String(product.capacity || product.kapacita || product.page_yield || product.yield || '').trim();
  const volumes = [...capacity.matchAll(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*ml\b/gi)];
  const hasVolume = /\bml\b|\dml\b/i.test(capacity);
  const ml = volumes.length === 1 && !/\d\s*[-–—+]\s*\d/.test(capacity) ? Number(volumes[0][1].replace(',', '.')) : null;
  const size = packSize(product);
  // Mixed and unverified packs may have separate yields per colour. Never turn
  // these into a single page cost or use them to advertise a price difference.
  const pages = size === 1 ? (parsePageYieldValue(product.page_yield) || parsePageYieldValue(product.yield_pages) || parsePageYieldValue(capacity)) : null;
  const color = fold(product.color || product.farba);
  const slot = name.match(/\b(foto|photo|light|svetl|matn|pigment)\w*/)?.[1] || '';
  const printers = product.compatible_printers || product.printers;
  return { product, brand, code, family: capacityFamily(code, brand), kind: material(product), size,
    color: /^(?:neuveden[eay]|n\/a|[-–])$/.test(color) ? '' : color, slot,
    capacity, pages, ml, hasVolume, extras: (name.match(extraCartridge) || []).join('/').replace(/[ -]/g, ''),
    models: new Set<string>((Array.isArray(printers) ? printers : []).map((name: string) => fold(name).replace(/[^a-z0-9]/g, '')).filter((name: string) => /\d/.test(name))),
  };
}

type Profile = ReturnType<typeof profile>;
function match(current: Profile, candidate: Profile) {
  if (!current.code || !candidate.code || !current.kind || current.brand !== candidate.brand || current.kind !== candidate.kind
    || current.family !== candidate.family || !current.size || current.size !== candidate.size || current.slot !== candidate.slot || current.extras !== candidate.extras) return null;
  if (current.color !== candidate.color || (!current.color && ['toner', 'ink'].includes(current.kind))) return null;
  const exact = current.code === candidate.code;
  if (current.size !== 1 && !exact) return null;
  const shared = [...candidate.models].filter(model => current.models.has(model)).length;
  if (!shared) return null;
  const partial = shared < current.models.size;
  const sameVolume = !current.hasVolume && !candidate.hasVolume || current.ml !== null && current.ml > 0 && current.ml === candidate.ml;
  const sameYield = current.pages !== null && current.pages === candidate.pages;
  const comparable = exact && current.size === 1 && !partial && shared === candidate.models.size && sameVolume && (sameYield || (current.ml !== null && !current.pages && !candidate.pages));
  const basis = current.pages && candidate.pages ? 'pages' : current.ml && candidate.ml ? 'ml' : null;
  const difference = basis ? candidate[basis]! - current[basis]! : 0;
  return { exact, shared, partial, comparable, basis, difference };
}

export function selectProductAlternatives(current: TmProduct, candidates: Iterable<TmProduct>) {
  const baseline = profile(current);
  const seen = new Set([String(current.id)]);
  const matches = [];
  for (const product of candidates) {
    const id = String(product.id || '');
    if (!id || seen.has(id) || !product.slug || !product.sku || !types.includes(product.product_type_key)
      || !(Number.isFinite(Number(product.price)) && Number(product.price) > 0) || specialChipVariantKey(product)) continue;
    seen.add(id);
    const variant = profile(product);
    const comparison = match(baseline, variant);
    if (comparison) matches.push({ variant, ...comparison });
  }
  const ranked = matches.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.comparable) - Number(a.comparable)
    || Number(a.partial) - Number(b.partial) || Number(isAvailableNow(b.variant.product)) - Number(isAvailableNow(a.variant.product))
    || b.shared - a.shared || Number(a.variant.product.price) - Number(b.variant.product.price));
  const picked = types.flatMap(type => ranked.filter(item => item.variant.product.product_type_key === type).slice(0, 1));
  for (const item of ranked) if (picked.length < 3 && !picked.includes(item)) picked.push(item);
  return { baseline, alternatives: picked };
}

export function savingsAgainstOriginal(variant: TmProduct, original: TmProduct) {
  if (!['compatible', 'renovated'].includes(variant.product_type_key) || original.product_type_key !== 'original'
    || specialChipVariantKey(variant) || !match(profile(variant), profile(original))?.comparable) return 0;
  const cheaper = Math.round(Number(variant.price) * 100);
  const reference = Math.round(Number(original.price) * 100);
  return Number.isSafeInteger(cheaper) && Number.isSafeInteger(reference) && cheaper > 0 && reference > cheaper ? (reference - cheaper) / 100 : 0;
}
