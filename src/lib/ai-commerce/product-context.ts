import { getProductFromCache, getProductsCache } from '../tm-products-cache.ts';
import { analyzeCatalogQuery, exactPrinterModelMatch, findExactProductIdentityMatches } from '../catalog-query.ts';
import { currentProductSlug } from '../product-slug-aliases.ts';
import { productIdForHistoricalSlug } from '../product-slug-history.ts';
import { isAvailableNow, ORDER_DELIVERY_LABEL, storefrontStockText } from '../product-availability.ts';
import { aiKnowledge } from '../../data/ai-knowledge.ts';
import type { CommerceState } from './domain.ts';

const norm = (value: unknown) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const key = (value: unknown) => norm(value).replace(/[^a-z0-9]/g, '');
const productCode = /\b(?:cf|ce|crg|tn|dr|wt|mc|w|q|clt|mlt|tk|pg|cl|gi|pgi|pfi|cli|lc|bt)[- ]?\d{2,}[a-z0-9-]*\b/i;
const brandedPrinter = /\b(?:hp|brother|canon|epson|samsung|oki|xerox|kyocera|lexmark|ricoh|sharp|toshiba|pantum|dell|konica(?:\s+minolta)?)(?:\s+[a-z][a-z-]*){0,5}\s+[a-z-]*\d+[a-z0-9-]*\b/gi;

// A path is an identity hint only. Resolve it against our catalogue, never
// fetch a customer-supplied URL or infer compatibility from words in a slug.
function productSlug(page: string) {
  try {
    const url = new URL(page, 'https://www.tonerymaxim.sk');
    if (!['tonerymaxim.sk', 'www.tonerymaxim.sk', 'tonerymaxim.info', 'www.tonerymaxim.info'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/produkt\/([^/]+)\/?$/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

function printerMentions(message: string) {
  return [...message.matchAll(brandedPrinter)].map(match => match[0]).filter(value =>
    !productCode.test(value) && !/^(?:hp|brother|canon|epson|samsung|oki|xerox|kyocera|lexmark|ricoh)\s+\d{2,3}[a-z]{0,3}$/i.test(value));
}

function productPrinters(product: any): string[] {
  const canonical = Array.isArray(product.compatible_printers) && product.compatible_printers.length
    ? product.compatible_printers : Array.isArray(product.printers) ? product.printers : [];
  const attributes = Array.isArray(product.attributes_all) ? product.attributes_all : Array.isArray(product.attributes) ? product.attributes : [];
  // Full product details also contain manufacturer/series attributes and a
  // comma-joined copy of every model. Those are not additional printers.
  const values = canonical.length ? canonical : attributes
    .filter((attribute: any) => /model|kompatibil|compatib|zariaden/.test(norm(`${attribute.name || ''} ${attribute.slug || ''}`))
      && !/seria|vyrobc|brand/.test(norm(`${attribute.name || ''} ${attribute.slug || ''}`)))
    .flatMap((attribute: any) => [...(Array.isArray(attribute.options) ? attribute.options : []), ...(Array.isArray(attribute.values) ? attribute.values : []), attribute.value || '']);
  const printers = new Map<string, string>();
  for (const value of values) for (const part of String(value || '').split(/[,;|\n]+/)) {
    const model = part.trim().replace(/\s+/g, ' ');
    if (/\d/.test(model) && !printers.has(key(model))) printers.set(key(model), model);
  }
  return [...printers.values()];
}

function narrowProducts(products: any[], message: string) {
  const n = norm(message);
  let result = products;
  if (/\b(?:sada|sady|sadu|set|komplet|cmyk)\w*\b/.test(n)) result = result.filter(product => /\b(?:sada|set|cmyk|multipack)\b/.test(norm(product.name)));
  const types = [
    [/\bkompatibil\w*\b/, 'compatible'], [/\boriginal\w*\b/, 'original'], [/\b(?:renov|repas)\w*\b/, 'renovated'],
  ] as const;
  const requested = types.filter(([pattern]) => pattern.test(n));
  if (requested.length === 1) {
    const type = requested[0][1];
    result = result.filter(product => (product.product_type_key || (/original/.test(norm(product.name)) ? 'original' : /renov|repas/.test(norm(product.name)) ? 'renovated' : 'compatible')) === type);
  }
  const colours = [[/\b(?:cier\w*|black|bk)\b/, /cier|black|\bbk\b/], [/\b(?:cyan|azur\w*)\b/, /cyan|azur/], [/\b(?:magenta|purpur\w*)\b/, /magenta|purpur/], [/\b(?:yellow|zlt\w*)\b/, /yellow|zlt/]] as const;
  const colour = colours.filter(([pattern]) => pattern.test(n));
  if (colour.length === 1 && !/\bcmyk\b/.test(n)) result = result.filter(product => colour[0][1].test(norm(`${product.color || ''} ${product.name || ''}`)));
  return result;
}

async function resolveProduct(message: string, page: string, state: CommerceState, explicitSearch: boolean) {
  const slug = productSlug(page);
  const onDetail = /^\/produkt\//i.test(page) || slug !== null;
  let pageProduct: any = null;
  if (slug) {
    pageProduct = (await getProductFromCache({ slug: currentProductSlug(slug), id: slug })).product;
    if (!pageProduct) {
      const historicalId = await productIdForHistoricalSlug(slug);
      if (historicalId) pageProduct = (await getProductFromCache({ id: historicalId })).product;
    }
  }
  // An explicit different toner beats the page. Remove printer references so
  // checking "this toner in HP ... 4302dw" is not a search for another toner.
  let identityQuestion = message;
  for (const printer of printerMentions(message)) identityQuestion = identityQuestion.replace(printer, ' ');
  const analysis = analyzeCatalogQuery(identityQuestion);
  if (explicitSearch && analysis.hasReference) {
    const cache = await getProductsCache();
    const sku = identityQuestion.match(/\bsku\s*[:#-]?\s*([a-z0-9][a-z0-9_-]*)/i)?.[1];
    const exactSku = sku ? cache.products.filter(product => key(product.sku) === key(sku)) : [];
    const matches = narrowProducts(exactSku.length ? exactSku : findExactProductIdentityMatches(cache.products, identityQuestion).map(match => match.product), identityQuestion);
    if (pageProduct && matches.some(product => String(product.id) === String(pageProduct.id))) return { product: pageProduct, choices: [] };
    if (matches.length === 1) return { product: (await getProductFromCache({ id: matches[0].id })).product, choices: [] };
    // No fallback to the page or a previous selection for an unknown code.
    return { product: null, choices: matches };
  }
  if (onDetail) return { product: pageProduct, choices: [] };
  const selectedId = state.selectedProductId || state.currentProductId;
  if (selectedId) return { product: (await getProductFromCache({ id: selectedId })).product, choices: [] };
  if (state.lastProductQuery) {
    const cache = await getProductsCache();
    const matches = narrowProducts(findExactProductIdentityMatches(cache.products, state.lastProductQuery).map(match => match.product), state.lastProductQuery);
    if (matches.length === 1) return { product: (await getProductFromCache({ id: matches[0].id })).product, choices: [] };
    return { product: null, choices: matches };
  }
  return { product: null, choices: [] };
}

/** Factual product questions bypass purchasing and the generative fallback. */
export async function productContextAnswer(message: string, page: string, state: CommerceState, route: { intents: string[]; productQuery: string | null }) {
  const n = norm(message);
  if (route.intents.includes('HUMAN_ESCALATION')) return null;
  const list = /\b(?:do|pre|s)\s+(?:ktorych|ktorymi|akych|akymi|akej|ktorej)\s+tlaciarn\w*\b|\b(?:zoznam|ktore)\s+(?:kompatibilnych\s+)?tlaciarn\w*\b/.test(n);
  const compatibility = list || /\b(?:pasuje|pasuju|hodi|fungovat|funguje|funguju)\b/.test(n) && /\b(?:tlaciarn\w*|produkt\w*|toner\w*|napln\w*|sada|sady|sadu)\b/.test(n)
    || /\b(?:je|su|bude|budu)\b.*\b(?:kompatibiln|vhodn)\w*\b/.test(n) && /\btlaciarn\w*\b/.test(n);
  const firmware = /firmware|firmver|hp\s*\+|cartridge\s+(?:protection|policy)|authorized\s+hp|nerozpozna|\bcip\w*\b/.test(n)
    && /potvrd|over|fung|pasuj|kompatibil/.test(n);
  const stock = /\b(?:skladom|dostupnost|dostupny|dostupna|dostupne)\b/.test(n);
  // Do not turn service questions, general explanations or purchase commands
  // into a page lookup just because a product detail happens to be open.
  if (!compatibility && !firmware && !stock) return null;
  const refersToProduct = /\b(?:tento|tato|tieto|tuto|ten|ta|ho|uvedeny|uvedena|uvedene)\b/.test(n);
  const printerToTonerSearch = /\b(?:aky|ktory|najdi|najdite|hladam|potrebujem)\b.*\b(?:toner|napln|atrament)\w*\b/.test(n);
  const generalExplanation = /\b(?:ako\s+funguj\w*|preco|rozdiel)\b/.test(n);
  if (!list && !refersToProduct && !firmware && (printerToTonerSearch || generalExplanation)) return null;
  if (!compatibility && !firmware && route.intents.some(intent => ['POLICY', 'BUY_INTENT', 'ADVICE', 'PRODUCT_COMPARE'].includes(intent))) return null;
  const hasContext = Boolean(productSlug(page) || state.currentProductId || state.selectedProductId || state.lastProductQuery || route.productQuery);
  if (!list && !hasContext) return null;

  const { product, choices } = await resolveProduct(message, page, state, route.intents.includes('PRODUCT_SEARCH'));
  if (!product) return {
    product: null,
    advisor: {
      answer: choices.length ? ['Ktorý konkrétny produkt myslíte? Napíšte jeho presné označenie alebo otvorte jeho detail.', ...choices.slice(0, 5).map(product => `• ${product.name} (SKU: ${product.sku})`)]
        : ['Napíšte, prosím, presné označenie tonera alebo produktu, prípadne otvorte jeho produktovú stránku. Bez konkrétneho produktu nemôžem spoľahlivo určiť zoznam tlačiarní.'],
      products: [], groups: [], intent: 'product_clarification', confidence: 1, unanswered: false, handoffSuggested: false, sources: [],
    },
  };

  const answer = [`Myslíte produkt ${product.name}? Ak nie, napíšte presné označenie tonera alebo produktu. Ak áno:`];
  const sources = [{ label: 'Zobraziť produkt', url: `/produkt/${encodeURIComponent(product.slug)}` }];
  const printers = productPrinters(product);
  if (compatibility || firmware) {
    for (const printer of printerMentions(message)) {
      const assigned = printers.some(value => exactPrinterModelMatch(value, analyzeCatalogQuery(printer)));
      answer.push(assigned ? `Model ${printer} je uvedený v katalógovom zozname kompatibilných tlačiarní tohto produktu.`
        : `Model ${printer} nie je uvedený v katalógovom zozname tohto produktu; kompatibilitu s týmto presným modelom nemám potvrdenú.`);
    }
    if (printers.length) answer.push('Podľa katalógu je produkt určený pre tieto tlačiarne:', ...printers.map(printer => `• ${printer}`));
    else answer.push('Pri tomto produkte v katalógu chýba zoznam kompatibilných tlačiarní. Napíšte presný model zo štítku tlačiarne; kompatibilitu musí pred objednaním preveriť pracovník.');
    if (/nefunguje\s+v\s+hp\s*\+|nie\s+je\s+(?:urcen\w*|vhodn\w*)\s+pre\s+hp\s*\+/.test(norm(product.name))) {
      answer.push('Upozornenie uvedené pri produkte: táto kompatibilná sada nefunguje v HP+. Ak je vaša tlačiareň aktivovaná v HP+, tento produkt nepoužite.');
    }
  }
  if (stock) answer.push(`${storefrontStockText(product)}.${isAvailableNow(product) ? '' : ` ${ORDER_DELIVERY_LABEL}.`}`);
  if (firmware) {
    answer.push(`Funkčnosť s konkrétnou verziou firmvéru${/\bhp\b/.test(norm(product.name)) ? ' ani stav aktivácie HP+' : ''} nemám overené, preto ich nemôžem potvrdiť. Katalógové priradenie modelu samo osebe nepotvrdzuje funkčnosť s daným firmvérom a čipom. Pred nákupom je potrebné preveriť presný model, verziu firmvéru a čip dodávanej náplne s pracovníkom.`);
    sources.push({ label: 'Firmvér a kompatibilný toner', url: '/poradna/aktualizacia-firmveru-a-kompatibilny-toner' });
  }
  // A mixed technical/policy question must answer its final clauses too.
  for (const [pattern, id, url] of [
    [/\b(?:vratit|vraten|odstup)\w*\b/, 'vratenie-tovaru', '/odstupenie-od-zmluvy'],
    [/\breklam\w*\b/, 'reklamacia-postup', '/reklamacie'],
  ] as const) if (pattern.test(n)) {
    const knowledge = aiKnowledge.find(item => item.id === id);
    if (knowledge) { answer.push(`${knowledge.title}:`, ...knowledge.answer); sources.push({ label: knowledge.title, url }); }
  }
  return {
    product,
    advisor: { answer, products: [], groups: [], intent: 'compatibility', confidence: 1, unanswered: false, handoffSuggested: firmware || !printers.length && compatibility, sources },
  };
}
