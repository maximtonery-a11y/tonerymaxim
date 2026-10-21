import { explicitlyRequestsSpecialChipVariant, filterProducts, getProductFromCache, getProductsCache, isSpecialChipVariantProduct } from '../tm-products-cache.ts';
import { analyzeCatalogQuery, exactPrinterModelMatch, findExactProductIdentityMatches } from '../catalog-query.ts';
import { currentProductSlug } from '../product-slug-aliases.ts';
import { productIdForHistoricalSlug } from '../product-slug-history.ts';
import { isAvailableNow, ORDER_DELIVERY_LABEL, storefrontStockText } from '../product-availability.ts';
import { aiKnowledge } from '../../data/ai-knowledge.ts';
import type { CommerceState } from './domain.ts';
import { isGeneralProductTypeComparison } from '../ai-product-type-question.ts';
import { productPageYield } from '../ai-page-yield.ts';
import { HP_TONER_HELP_LABEL, HP_TONER_HELP_PATH } from '../hp-toner-help.ts';
import { isProductPriceQuestion } from './price-question.ts';

const norm = (value: unknown) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const key = (value: unknown) => norm(value).replace(/[^a-z0-9]/g, '');
const productCode = /\b(?:cf|ce|crg|tn|dr|wt|mc|w|q|clt|mlt|tk|pg|cl|gi|pgi|pfi|cli|lc|bt)[- ]?\d{2,}[a-z0-9-]*\b/i;
const brandedPrinter = /\b(?:hp|brother|canon|epson|samsung|oki|xerox|kyocera|lexmark|ricoh|sharp|toshiba|pantum|dell|konica(?:\s+minolta)?)(?:\s+[a-z][a-z-]*){0,5}\s+[a-z-]*\d+[a-z0-9-]*\b/gi;

// A path is an identity hint only. Resolve it against our catalogue, never
// fetch a customer-supplied URL or infer compatibility from words in a slug.
function sitePage(page: string) {
  try {
    const url = new URL(page, 'https://www.tonerymaxim.sk');
    if (!['tonerymaxim.sk', 'www.tonerymaxim.sk', 'tonerymaxim.info', 'www.tonerymaxim.info'].includes(url.hostname)) return null;
    return url;
  } catch { return null; }
}

function productSlug(page: string) {
  try {
    const match = sitePage(page)?.pathname.match(/^\/produkt\/([^/]+)\/?$/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

function catalogueSearch(page: string) {
  const url = sitePage(page);
  if (!url || !/^\/produkty\/?$/i.test(url.pathname)) return null;
  const read = (name: string) => String(url.searchParams.get(name) || '').trim().slice(0, 160);
  const search = read('s') || read('search') || read('q') || read('sku');
  const printer = read('printer');
  if (!search && !printer) return null;
  return { search, printer, brand: read('brand'), type: read('type'), color: read('color') };
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

function isTonerProduct(product: any) {
  const attributes = [...(Array.isArray(product.attributes_all) ? product.attributes_all : []), ...(Array.isArray(product.attributes) ? product.attributes : [])];
  const kind = attributes.find((attribute: any) => norm(attribute.name) === 'typ produktu');
  const values = Array.isArray(kind?.values) ? kind.values : Array.isArray(kind?.options) ? kind.options : [];
  const material = kind ? `${kind.value || ''} ${values.join(' ')}`
    : `${product.name} ${(Array.isArray(product.categories) ? product.categories : []).map((category: any) => category.name).join(' ')}`;
  return /\btoner\w*\b/.test(norm(material)) && !/\b(?:valec|nadoba)\b/.test(norm(product.name));
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

const shortProductReference = (message: string) => /^(?:(?:myslim|ano|a)[, ]+)?(?:tento|tato|tieto|tuto|toto|ten|ta|to)(?:\s+(?:produkt|toner|napln|sada|sadu|kompatibilny|originalny|renovovany)){0,3}[.!?]*$/.test(norm(message).trim());

// Old saved conversations have no pendingProductQuestion. Recover only from
// the immediately preceding product clarification, never from an older topic.
function pendingProductQuestion(state: CommerceState): string | null {
  const turns = state.history.slice(-8);
  const clarification = (value: string) => /ktory konkretny produkt myslite|napiste, prosim, presne oznacenie tonera alebo produktu|ktory z tychto produktov|o ktory toner alebo produkt ide/.test(norm(value));
  if (turns.at(-1)?.role !== 'assistant') return null;
  // Current sessions carry the unresolved question explicitly. Customer-facing
  // wording is needed only to recover older saved sessions without that field.
  if (state.pendingProductQuestion && !shortProductReference(state.pendingProductQuestion)) return state.pendingProductQuestion;
  if (!clarification(turns.at(-1)!.content)) return null;
  for (let i = turns.length - 2; i >= 0; i -= 2) {
    const turn = turns[i];
    if (turn?.role !== 'user') return null;
    if (!shortProductReference(turn.content)) return turn.content;
    if (turns[i - 1]?.role !== 'assistant' || !clarification(turns[i - 1].content)) return null;
  }
  return null;
}

function productSelection(message: string) {
  const n = norm(message).trim().replace(/[.!?]+$/, '');
  return shortProductReference(message)
    || /^(?:ten\s+)?(?:kompatibilny|originalny|renovovany)(?:\s+(?:toner|produkt))?$/.test(n)
    || /^(?:sku|kod produktu)\s*[:#-]?\s*[a-z0-9_-]+$/.test(n)
    || productCode.test(n) && !/\b(?:ako|preco|kolko|pasuje|funguje|hladam|potrebujem|chcem|najdi|pridaj|kup|objednaj|doprav\w*|plat\w*)\b/.test(n) && n.split(/\s+/).length <= 8;
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
  const sku = identityQuestion.match(/\bsku\s*[:#-]?\s*([a-z0-9][a-z0-9_-]*)/i)?.[1];
  if (explicitSearch && (analysis.hasReference||sku)) {
    const cache = await getProductsCache();
    const exactSku = sku ? cache.products.filter(product => key(product.sku) === key(sku)) : [];
    const matches = narrowProducts(exactSku.length ? exactSku : findExactProductIdentityMatches(cache.products, identityQuestion).map(match => match.product), identityQuestion);
    if (pageProduct && matches.some(product => String(product.id) === String(pageProduct.id))) return { product: pageProduct, choices: [] };
    if (matches.length === 1) return { product: (await getProductFromCache({ id: matches[0].id })).product, choices: [] };
    // No fallback to the page or a previous selection for an unknown code.
    return { product: null, choices: matches };
  }
  if (onDetail) return { product: pageProduct, choices: [] };
  const search = catalogueSearch(page);
  if (search) {
    const cache = await getProductsCache();
    const visible = filterProducts(cache.products, search).filter(product => explicitlyRequestsSpecialChipVariant(search.search) || !isSpecialChipVariantProduct(product));
    const matches = narrowProducts(narrowProducts(visible, `${search.search} ${search.printer}`), message);
    if (matches.length === 1) return { product: (await getProductFromCache({ id: matches[0].id })).product, choices: [] };
    // A new storefront search is the current context even when it is empty
    // or offers several variants. Never resurrect the previous detail page.
    return { product: null, choices: matches };
  }
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
export async function productContextAnswer(message: string, page: string, state: CommerceState, route: { intents: string[]; productQuery: string | null }, returnedReference: string | null = null) {
  if (route.intents.includes('HUMAN_ESCALATION') || isGeneralProductTypeComparison(message)) return null;
  const pending = productSelection(message) ? pendingProductQuestion(state) : null;
  const question = pending || message;
  const n = norm(question);
  const overview = !pending && shortProductReference(message);
  const explanation = /\bako\s+funguj\w*\b/.test(n)
    && (!route.intents.includes('POLICY') || /\b(?:produkt\w*|toner\w*|napln\w*|sada|sady|sadu)\b/.test(n));
  const capacity = /\b(?:vytaznost|kapacita|vydrz|kolko\s+stran)\b/.test(n);
  const list = /\b(?:do|pre|s)\s+(?:ktorych|ktorymi|akych|akymi|akej|ktorej)\s+tlaciarn\w*\b|\b(?:zoznam|ktore)\s+(?:kompatibilnych\s+)?tlaciarn\w*\b/.test(n);
  const compatibility = list || !explanation && /\b(?:pasuje|pasuju|hodi|fungovat|funguje|funguju)\b/.test(n) && /\b(?:tlaciarn\w*|produkt\w*|toner\w*|napln\w*|sada|sady|sadu)\b/.test(n)
    || /\b(?:je|su|bude|budu)\b.*\b(?:kompatibiln|vhodn)\w*\b/.test(n) && /\btlaciarn\w*\b/.test(n);
  const firmware = /firmware|firmver|hp\s*\+|cartridge\s+(?:protection|policy)|authorized\s+hp|nerozpozna|\bcip\w*\b/.test(n)
    && /potvrd|over|fung|pasuj|kompatibil/.test(n);
  const stock = /\b(?:skladom|dostupnost|dostupny|dostupna|dostupne)\b/.test(n);
  const price = !route.intents.includes('POLICY')&&!isProductPriceQuestion(question)&&/\b(?:cena|cenu|ceny|stoji|stoja)\b/.test(n);
  // Do not turn service questions, general explanations or purchase commands
  // into a page lookup just because a product detail happens to be open.
  if (!compatibility && !firmware && !stock && !explanation && !overview && !capacity && !price) return null;
  const refersToProduct = /\b(?:tento|tato|tieto|tuto|ten|ta|ho|uvedeny|uvedena|uvedene)\b/.test(n);
  const printerToTonerSearch = /\b(?:aky|ktory|najdi|najdite|hladam|potrebujem)\b.*\b(?:toner|napln|atrament)\w*\b/.test(n);
  const generalExplanation = /\b(?:ako\s+funguj\w*|preco|rozdiel)\b/.test(n);
  if (!list && !refersToProduct && !firmware && !pending && !overview && (printerToTonerSearch || generalExplanation)) return null;
  if (!compatibility && !firmware && !explanation && !overview && !capacity && !price && route.intents.some(intent => ['POLICY', 'BUY_INTENT', 'ADVICE', 'PRODUCT_COMPARE'].includes(intent))) return null;
  const hasContext = Boolean(productSlug(page) || catalogueSearch(page) || state.currentProductId || state.selectedProductId || state.lastProductQuery || route.productQuery);
  if (!list && !hasContext && !refersToProduct && !overview) return null;

  const { product, choices } = await resolveProduct(returnedReference?`${message} ${returnedReference}`:message, page, state, route.intents.includes('PRODUCT_SEARCH')||Boolean(returnedReference));
  if (!product) return {
    product: null,
    pendingProductQuestion: question,
    advisor: {
      answer: choices.length ? ['Ktorý z týchto produktov máte na mysli? Môžete napísať jeho označenie alebo otvoriť jeho detail.', ...choices.slice(0, 5).map(product => `• ${product.name} (SKU: ${product.sku})`)]
        : ['O ktorý toner alebo produkt ide? Napíšte, prosím, jeho presné označenie alebo otvorte detail produktu.'],
      products: [], groups: [], intent: 'product_clarification', confidence: 1, unanswered: false, handoffSuggested: false, sources: [],
    },
  };

  const sameProduct = !pending && String(state.currentProductId || state.selectedProductId || '') === String(product.id);
  const answer = [sameProduct ? `${product.name}:` : `Myslíte produkt ${product.name}? Ak nie, napíšte presné označenie tonera alebo produktu. Ak áno:`];
  const sources = [{ label: 'Zobraziť produkt', url: `/produkt/${encodeURIComponent(product.slug)}` }];
  const hpProduct = /\bhp\b/.test(norm(product.name));
  const addHpHelp = () => {
    if (!sources.some(source => source.url === HP_TONER_HELP_PATH)) sources.push({ label: HP_TONER_HELP_LABEL, url: HP_TONER_HELP_PATH });
  };
  const printers = productPrinters(product);
  const toner = isTonerProduct(product);
  if(price)answer.push(Number(product.price)>0?`Cena za 1 ks je ${Number(product.price).toLocaleString('sk-SK',{minimumFractionDigits:2,maximumFractionDigits:2})} € s DPH, bez dopravy a ďalších zliav.`:'Aktuálnu cenu tohto produktu vám teraz neviem povedať. Pozrite si, prosím, jeho detail.');
  if (explanation || overview) {
    if (toner) answer.push('Ide o tonerovú kazetu s práškom pre laserovú tlačiareň. Pri tlači sa prášok prenesie na papier a zafixuje teplom.');
    const type = product.product_type_key || (/original/.test(norm(product.name)) ? 'original' : /renov|repas/.test(norm(product.name)) ? 'renovated' : /kompatibil/.test(norm(product.name)) ? 'compatible' : null);
    const definition = aiKnowledge.find(item => item.id === 'kompatibilny-original-renovovany')?.answer;
    const typeIndex = ['original', 'compatible', 'renovated'].indexOf(type);
    if (toner && definition && typeIndex >= 0) answer.push(definition[typeIndex]);
    const color = String(product.color || product.farba || '').trim();
    if (color) answer.push(`Farba: ${color}.`);
  }
  if (capacity || explanation || overview) {
    const pages = productPageYield(product);
    if (pages) answer.push(`Výťažnosť: ${pages.toLocaleString('sk-SK')} strán. Skutočný počet závisí od obsahu a pokrytia tlačených strán.`);
    else if (capacity) answer.push('Výťažnosť pri tomto produkte nemám uvedenú. Ak je pre vás dôležitá, pred objednaním ju s nami overte.');
  }
  if (compatibility || firmware || explanation || overview) {
    for (const printer of printerMentions(question)) {
      const assigned = printers.some(value => exactPrinterModelMatch(value, analyzeCatalogQuery(printer)));
      answer.push(assigned ? `Tento produkt je určený aj pre tlačiareň ${printer}.`
        : `Kompatibilitu tohto produktu s presným modelom ${printer} nemám potvrdenú.`);
    }
    if (printers.length) answer.push(toner ? 'Tieto tonery sú určené pre tieto tlačiarne:' : 'Tento produkt je určený pre tieto tlačiarne:', ...printers.map(printer => `• ${printer}`));
    else answer.push('Pri tomto produkte nemám uvedený zoznam kompatibilných tlačiarní. Napíšte presný model zo štítku tlačiarne; kompatibilitu musí pred objednaním preveriť pracovník.');
    if (/nefunguje\s+v\s+hp\s*\+|nie\s+je\s+(?:urcen\w*|vhodn\w*)\s+pre\s+hp\s*\+/.test(norm(product.name))) {
      answer.push('Tento produkt nefunguje v tlačiarni s aktivovaným HP+. Čo HP+ znamená a ako skontrolovať politiku kaziet, ochranu kaziet a aktualizácie firmvéru, vysvetľuje návod „HP+ a kompatibilné tonery“ v odkazoch nižšie.');
      addHpHelp();
    }
  }
  if (stock) answer.push(`${storefrontStockText(product)}.${isAvailableNow(product) ? '' : ` ${ORDER_DELIVERY_LABEL}.`}`);
  if (firmware) {
    answer.push(`Funkčnosť s konkrétnou verziou firmvéru${hpProduct ? ' ani stav aktivácie HP+' : ''} nemám overené, preto ich nemôžem potvrdiť. Samotná zhoda modelu nepotvrdzuje funkčnosť s daným firmvérom a čipom. Pred nákupom je potrebné preveriť presný model, verziu firmvéru a čip dodávanej náplne s pracovníkom.`);
    if (hpProduct) addHpHelp();
    else sources.push({ label: 'Firmvér a kompatibilný toner', url: '/poradna/aktualizacia-firmveru-a-kompatibilny-toner' });
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
    pendingProductQuestion: null,
    advisor: { answer, products: [], groups: [], intent: compatibility || firmware ? 'compatibility' : 'product_info', confidence: 1, unanswered: false, handoffSuggested: firmware || !printers.length && compatibility, sources },
  };
}
