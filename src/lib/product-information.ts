import sanitizeHtml from 'sanitize-html';
import { parsePageYieldValue } from './ai-page-yield.ts';

type Product = Record<string, any>;
type Attribute = { name?: string; slug?: string; value?: unknown; values?: string[]; options?: string[]; visible?: boolean };
type Fact = { label: string; value: string; icon: string };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const numberFormat = new Intl.NumberFormat('sk-SK');
const keyOf = (value: string) => normalize(value.replace(/^pa[_-]/i, '')).replace(/[^a-z0-9]/g, '');
function present(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^(?:-|n\/a|neuveden[eay]|neznam[eay]|null|undefined)$/.test(normalize(text)) ? '' : text;
}

const descriptionOptions: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'details', 'summary'],
  allowedAttributes: {
    '*': ['id', 'lang', 'dir'],
    a: ['href', 'title'], img: ['src', 'alt', 'width', 'height', 'title', 'loading'],
    th: ['scope', 'colspan', 'rowspan'], td: ['colspan', 'rowspan'],
    ol: ['start', 'reversed', 'type'], li: ['value'],
    time: ['datetime'], abbr: ['title'],
  },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https', 'http'] },
  allowProtocolRelative: false,
  transformTags: {
    '*': (tagName, attribs) => {
      // Keep authored in-page links together without colliding with storefront IDs.
      if (attribs.id) attribs.id = 'tm-copy-' + attribs.id;
      if (tagName === 'a' && attribs.href?.startsWith('#')) attribs.href = '#tm-copy-' + attribs.href.slice(1);
      if (tagName === 'img') attribs.loading = 'lazy';
      return { tagName, attribs };
    },
  },
};

function teaserFor(text: string) {
  return text.match(/^.{1,240}?[.!?](?=\s|$)/u)?.[0] ||
    (text.length > 240 ? text.slice(0, 237).replace(/\s+\S*$/, '').trimEnd() + '…' : text);
}

function readDescription(product: Product) {
  for (const source of [product.description_html, product.short_description_html]) {
    if (!present(source)) continue;
    let paragraph = '';
    let firstBlock = '';
    const html = sanitizeHtml(String(source), {
      ...descriptionOptions,
      exclusiveFilter(frame) {
        const content = frame.text.trim();
        if (!paragraph && frame.tag === 'p' && content) paragraph = content;
        if (!firstBlock && content && /^(?:h[1-6]|li|div|td|dd)$/.test(frame.tag)) firstBlock = content;
        return false;
      },
    }).trim();
    if (!html || (!html.replace(/<[^>]+>/g, '').trim() && !/<img\s/.test(html))) continue;
    const text = (paragraph || firstBlock || html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const structured = /<(?:h[1-6]|[ou]l|dl|table|figure|details|blockquote)\b|<\/p>\s*<|<br\s*\/?>/i.test(html);
    return { html, teaser: teaserFor(text), expandable: structured || text.length > 240 };
  }
  // Legacy cache entries can contain only plain text. Astro escapes this branch.
  const plain = present(product.description);
  if (plain.length <= 240) return { html: '', teaser: plain, expandable: false };
  const escaped = plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return { html: '<p>' + escaped + '</p>', teaser: teaserFor(plain), expandable: true };
}

// The catalogue already evicts its detail objects. Reuse work on hot pages without retaining products.
const descriptions = new WeakMap<Product, ReturnType<typeof readDescription>>();
export function productDescription(product: Product) {
  const cached = descriptions.get(product);
  if (cached) return cached;
  const copy = readDescription(product);
  descriptions.set(product, copy);
  return copy;
}

const colours = [
  { name: 'Čierna', key: 'black', labels: ['cierna','black','bk','k'], suffix: /(?:\d|[-_])BK$/i },
  { name: 'Azúrová', key: 'cyan', labels: ['azurova','cyan','c'], suffix: /(?:\d|[-_])C$/i },
  { name: 'Purpurová', key: 'magenta', labels: ['purpurova','magenta','m'], suffix: /(?:\d|[-_])M$/i },
  { name: 'Žltá', key: 'yellow', labels: ['zlta','yellow','y'], suffix: /(?:\d|[-_])Y$/i },
];
function colourYields(capacity: string, codes: string[]) {
  const result: { name: string; key: string; pages: string; code?: string }[] = [];
  for (const part of capacity.split(/\s*[;,]\s*/)) {
    const match = normalize(part).trim().match(/^([a-z]+)\s*:\s*(\d[\d .,]*)\s*(?:stran(?:y|a)?|pages?)$/);
    const colour = match && colours.find(c => c.labels.includes(match[1]));
    const pages = match && parsePageYieldValue(match[2]);
    // If a value or colour is ambiguous, keep the entire original specification.
    if (!colour || !pages || result.some(item => item.key === colour.key)) return [];
    const matchingCodes = codes.filter(code => colour.suffix.test(code));
    result.push({ name: colour.name, key: colour.key, pages: numberFormat.format(pages), code: matchingCodes.length === 1 ? matchingCodes[0] : undefined });
  }
  return result.length > 1 ? result : [];
}

const colourKeys = ['farba','color','colour','barva'];
const yieldKeys = ['vytaznost','kapacita','pocetstran','pageyield','yield','pages'];
const typeKeys = ['typproduktu','producttype'];
const warrantyKeys = ['zaruka','warranty'];
const chipKeys = ['cip','chip'];
const packKeys = ['obsahbalenia','pocetkusovvbaleni','packsize'];
const skuKeys = ['sku','kodproduktu'];
const skipKeys = new Set([...colourKeys,...yieldKeys,...typeKeys,...warrantyKeys,...chipKeys,...packKeys,...skuKeys,
  'oem','typspotrebnehomaterialu','vyrobcatlaciarne','vyrobcatlaciarni','printermanufacturer',
  'seriatlaciarne','seriatlaciarni','printerseries','series','modeltlaciarne','modeltlaciarni','printermodel','printermodels','models']);

export function productSpecifications(product: Product) {
  const attrs: Attribute[] = Array.isArray(product.attributes_all) && product.attributes_all.length ? product.attributes_all :
    Array.isArray(product.attributes) ? product.attributes : [];
  const fields = attrs.filter(a => a && a.visible !== false).map(a => ({
    name: a.name || a.slug || '', key: keyOf(a.slug || a.name || ''),
    value: present(a.value) || (Array.isArray(a.values) ? a.values : Array.isArray(a.options) ? a.options : []).map(present).filter(Boolean).join(', '),
  }));
  const field = (keys: string[]) => fields.find(a => keys.includes(a.key) && a.value)?.value || '';
  const displayCodes = field(['oem']);
  const codeSource = displayCodes || present(product.mpn) || present(product.oem_codes);
  const codes = [...new Set(codeSource.split(displayCodes || /[,;|]/.test(codeSource) ? /\s*[,;|]\s*/ : /\s+/).map(c => c.trim()).filter(Boolean))];
  const capacity = present(product.capacity) || present(product.yield) || present(product.page_yield) || present(product.kapacita) || field(yieldKeys);
  const yields = colourYields(capacity, codes);
  const rawType = field(typeKeys);
  const kind = keyOf(rawType);
  const name = normalize(String(product.name || ''));
  const ink = ['atrament','atramentovanapln','ink','inkcartridge'].includes(kind) || (!kind && /atramentov|\batrament\b/.test(name));
  const toner = kind === 'toner' || (!kind && /\btoner(?:y|ov)?\b/.test(name) && !/valec|odpadov|zapekac/.test(name));
  const variants: Record<string,string> = { compatible:'Kompatibilný', original:'Originálny', renovated:'Renovovaný' };
  const noun = ink ? 'atrament' : toner ? 'toner' : '';
  const type = noun ? [variants[product.product_type_key], noun].filter(Boolean).join(' ') :
    (rawType || present(product.product_type_detail_label) || present(product.product_type_label)).replace(/-/g, ' ');
  const facts: Fact[] = [];
  const add = (label: string, value: string, icon: string) => { if (value) facts.push({ label, value, icon }); };
  add(noun ? 'Typ náplne' : 'Typ produktu', type ? type[0].toUpperCase() + type.slice(1) : '', ink ? 'drop' : toner ? 'toner' : 'box');
  const count = Number(name.match(/\b(\d{1,2})\s*ks\b/)?.[1]);
  const pack = count > 1 && (ink || toner) ? count + ' ' + (ink ? (count < 5 ? 'atramentové náplne' : 'atramentových náplní') : (count < 5 ? 'tonery' : 'tonerov')) : '';
  add('Obsah balenia', field(packKeys) || pack, 'box');
  const colour = present(product.color) || present(product.farba) || field(colourKeys);
  if (!yields.length || !/^(CMYK|CMY)$/i.test(colour)) add('Farba', colour, 'drop');
  if (!yields.length && capacity) {
    const pages = /^\d[\d .,]*\s*(?:stran(?:a|y)?|pages?)$/.test(normalize(capacity)) && parsePageYieldValue(capacity);
    add(/\b(?:ml|cl|dl|l|g|kg)\b/i.test(capacity) ? 'Kapacita' : 'Výťažnosť', pages ? numberFormat.format(pages) + ' strán' : capacity, 'pages');
  }
  const chip = field(chipKeys);
  add('Čip', toner && normalize(chip) === 's cipom' ? 'Súčasť kazety' : chip, 'chip');
  add('Záruka', present(product.warranty) || present(product.zaruka) || field(warrantyKeys), 'shield');
  if (codes.length === 1) add('Kód výrobcu (OEM)', codes[0], 'tag');
  add('Kód produktu', present(product.sku) || field(skuKeys), 'barcode');
  for (const attr of fields) {
    if (attr.name && !skipKeys.has(attr.key) && !facts.some(f => keyOf(f.label) === attr.key && f.value === attr.value)) add(attr.name, attr.value, 'list');
  }
  const extraCodes = codes.length > 1 ? codes.filter(code => !yields.some(y => y.code === code)) : [];
  return { facts, yields, extraCodes };
}
