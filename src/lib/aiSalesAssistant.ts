import { compactKey, getProductsCache, normalize } from './tm-products-cache';
import { AI_CONTACT_FALLBACK, aiKnowledge, type AiKnowledgeItem } from '../data/ai-knowledge';

export type AiIntent = 'product_search' | 'shipping' | 'payment' | 'claim' | 'order' | 'diagnostic' | 'compatibility' | 'support' | 'account' | 'legal' | 'contact' | 'fallback' | 'empty';

type Product = Record<string, any>;
type ProductGroup = { key: string; label: string; count: number; products: Product[]; recommended?: Product | null };

const TYPE_LABELS: Record<string, string> = {
  compatible: 'kompatibilný',
  original: 'originálny',
  renovated: 'renovovaný',
  product: 'ostatný',
};

const TYPE_PLURAL: Record<string, string> = {
  compatible: 'kompatibilné',
  original: 'originálne',
  renovated: 'renovované',
  product: 'ostatné',
};

const TYPE_ORDER: Record<string, number> = { compatible: 1, original: 2, renovated: 3, product: 4 };

const SERVICE_INTENT_WORDS: Record<AiIntent, string[]> = {
  shipping: ['doprava', 'dopravne', 'postovne', 'kurier', 'gls', 'dpd', 'pickup', 'box', 'balikomat', 'parcelshop', 'dorucenie', 'pride balik', 'cena dopravy'],
  payment: ['platba', 'zaplatit', 'gopay', 'dobierka', 'prevod', 'faktura', 'kartou', 'bankovy prevod', 'ico', 'dic', 'firma'],
  claim: ['reklamacia', 'reklamovat', 'vratit', 'vymenit', 'nepasuje', 'nesedi', 'zly toner', 'chyba tovaru', 'prisiel zly', 'nefunguje', 'vratenie'],
  order: ['objednavka', 'objednavku', 'odoslete', 'poslete', 'expedujete', 'kedy pride', 'kedy mi pride', 'stav objednavky', 'sledovanie zasielky'],
  diagnostic: ['tlaci', 'pasy', 'ciary', 'smuhy', 'flaky', 'bledy', 'slabo', 'sype', 'prasi', 'nerozpozna', 'chyba kazety', 'replace toner'],
  compatibility: ['kompatibilny', 'originalny', 'renovovany', 'rozdiel', 'alternativny', 'zaruka', 'poskodi'],
  support: ['ako najdem', 'aky toner', 'spravny toner', 'model tlaciarne', 'co zadat', 'toner alebo atrament'],
  account: ['ucet', 'prihlasenie', 'registracia', 'heslo', 'zabudnute heslo'],
  legal: ['gdpr', 'cookies', 'osobne udaje', 'obchodne podmienky'],
  contact: ['kontakt', 'telefon', 'mail', 'email', 'pracovna doba', 'cislo'],
  product_search: [], fallback: [], empty: [],
};

function uniq<T>(values: T[]) { return [...new Set(values)]; }

function words(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((x) => x.length >= 2);
}

function formatCount(count: number, singular: string, few: string, many: string) {
  if (count === 1) return `1 ${singular}`;
  if (count > 1 && count < 5) return `${count} ${few}`;
  return `${count} ${many}`;
}

function productUrl(product: Product) {
  return product.detail_url || product.url || (product.slug ? `/produkt/${product.slug}` : `/produkty?s=${encodeURIComponent(product.sku || product.name || '')}`);
}

function asAiProduct(product: Product) {
  return {
    id: product.id,
    sku: product.sku || '',
    name: product.name || 'Produkt',
    url: productUrl(product),
    price: Number(product.price || 0),
    image: product.image || (Array.isArray(product.images) ? product.images?.[0] : ''),
    slug: product.slug || '',
    product_type_key: product.product_type_key || 'product',
    product_type_label: product.product_type_label || TYPE_LABELS[product.product_type_key] || 'PRODUKT',
    color: product.color || product.farba || '',
    capacity: product.capacity || product.kapacita || product.yield || product.page_yield || '',
    warranty: product.warranty || product.zaruka || '24 mesiacov',
    stock_status: product.stock_status || 'instock',
    stock_quantity: Number.isFinite(Number(product.stock_quantity)) ? Number(product.stock_quantity) : null,
    stock_text: product.stock_quantity ? `Skladom: ${product.stock_quantity} ks` : '',
  };
}

function cleanQuestion(message: string) {
  return normalize(message)
    .replace(/\b(prosim|potrebujem|najdi|najst|hladam|mate|ponuke|toner|tonery|napln|naplne|tlaciaren|tlaciarne|do|pre|na)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasProductCodeOrModel(message: string) {
  const text = normalize(message);
  if (/\b[a-z]{1,5}[-\s]*\d{2,}[a-z0-9-]*\b/i.test(text)) return true;
  if (/\b\d{2,}[a-z]{1,4}\b/i.test(text)) return true;
  if (/\b(cf|ce|crg|tn|dr|w|q|clt|mlt|tk|c|pg|cli|lc|t)\s*[-]?\s*\d{2,}[a-z0-9]*\b/i.test(text)) return true;
  return false;
}

function keywordScore(message: string, keyword: string) {
  const text = normalize(message);
  const compact = compactKey(message);
  const k = normalize(keyword);
  const kc = compactKey(keyword);
  if (!k || !kc) return 0;
  if (text === k || compact === kc) return 160;
  if (text.includes(k) || compact.includes(kc)) return 110;
  const triggerWords = words(keyword);
  const messageWords = new Set(words(message));
  const matched = triggerWords.filter((word) => messageWords.has(word) || text.includes(word)).length;
  if (!matched) return 0;
  return matched * (triggerWords.length <= 2 ? 28 : 18);
}

function classifyIntent(message: string): { intent: AiIntent; score: number } {
  const scores = new Map<AiIntent, number>();
  for (const [intent, keywords] of Object.entries(SERVICE_INTENT_WORDS) as [AiIntent, string[]][]) {
    if (!keywords.length) continue;
    const score = keywords.reduce((sum, keyword) => sum + keywordScore(message, keyword), 0);
    if (score) scores.set(intent, score);
  }

  const ordered = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const best = ordered[0];
  if (best && best[1] >= 55) return { intent: best[0], score: best[1] };
  if (hasProductCodeOrModel(message)) return { intent: 'product_search', score: 90 };
  return { intent: 'fallback', score: 0 };
}

function knowledgeMatch(message: string, preferredIntent?: AiIntent) {
  let best: AiKnowledgeItem | null = null;
  let bestScore = 0;

  for (const item of aiKnowledge) {
    let score = Number(item.priority || 0);
    if (preferredIntent && item.intent === preferredIntent) score += 70;
    if (preferredIntent && item.intent !== preferredIntent) score -= 35;
    for (const trigger of item.triggers) score += keywordScore(message, trigger);
    if (score > bestScore) { best = item; bestScore = score; }
  }

  return best && bestScore >= 115 ? { item: best, score: bestScore } : null;
}

function productSearchValue(product: Product) {
  const cats = Array.isArray(product.categories) ? product.categories.map((c: any) => `${c.name || ''} ${c.slug || ''}`).join(' ') : '';
  const printers = [...(Array.isArray(product.printers) ? product.printers : []), ...(Array.isArray(product.compatible_printers) ? product.compatible_printers : [])].join(' ');
  const attrs = Array.isArray(product.attributes) ? product.attributes.map((a: any) => `${a.name || ''} ${a.value || ''} ${Array.isArray(a.options) ? a.options.join(' ') : ''}`).join(' ') : '';
  return `${product.name || ''} ${product.sku || ''} ${product.search_text || ''} ${cats} ${printers} ${attrs}`;
}

function relevantProducts(products: Product[], message: string) {
  const raw = message.trim();
  const cleaned = cleanQuestion(raw) || raw;
  const qCompact = compactKey(cleaned);
  const qWords = uniq(words(cleaned));
  const hasModelToken = qWords.some((w) => /\d/.test(w));

  if (!qCompact || qCompact.length < 2) return [];

  const scored = products.map((product) => {
    const name = normalize(product.name || '');
    const skuCompact = compactKey(product.sku || '');
    const text = normalize(productSearchValue(product));
    const textCompact = compactKey(text);
    const printerText = normalize([...(Array.isArray(product.printers) ? product.printers : []), ...(Array.isArray(product.compatible_printers) ? product.compatible_printers : [])].join(' '));
    const printerCompact = compactKey(printerText);
    let score = 0;

    if (skuCompact && skuCompact === qCompact) score += 260;
    if (skuCompact && (skuCompact.includes(qCompact) || qCompact.includes(skuCompact)) && qCompact.length >= 4) score += 180;
    if (compactKey(name).includes(qCompact) && qCompact.length >= 4) score += 150;
    if (printerCompact.includes(qCompact) && qCompact.length >= 4) score += 145;
    if (textCompact.includes(qCompact) && qCompact.length >= 4) score += 90;

    for (const token of qWords) {
      const tc = compactKey(token);
      if (!tc) continue;
      if (skuCompact === tc) score += 80;
      else if (skuCompact.includes(tc) && tc.length >= 3) score += 55;
      if (compactKey(name).includes(tc) && tc.length >= 3) score += 35;
      if (/\d/.test(tc) && printerCompact.includes(tc)) score += 60;
      else if (tc.length >= 4 && printerCompact.includes(tc)) score += 22;
    }

    if (hasModelToken && !qWords.some((token) => /\d/.test(token) && textCompact.includes(compactKey(token)))) score -= 120;
    if (/fixacn|fuser|zapekac/i.test(product.name || '') && !/fixac|fuser|zapek|jednotk/i.test(raw)) score -= 90;
    if (/kompatibil/i.test(product.product_type_key || product.name || '')) score += 8;

    return { product, score };
  })
    .filter((item) => item.score >= 90)
    .sort((a, b) => b.score - a.score || (TYPE_ORDER[a.product.product_type_key] || 9) - (TYPE_ORDER[b.product.product_type_key] || 9) || Number(a.product.price || 0) - Number(b.product.price || 0));

  const strong = scored.length ? scored[0].score : 0;
  return scored.filter((item) => item.score >= Math.max(90, strong - 95)).slice(0, 60).map((item) => item.product);
}

function groupProducts(products: Product[]): ProductGroup[] {
  const map = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.product_type_key || 'product';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(product);
  }

  return [...map.entries()].map(([key, items]) => {
    const sorted = [...items].sort((a, b) => Number(a.price || 999999) - Number(b.price || 999999));
    return {
      key,
      label: TYPE_PLURAL[key] || 'ostatné',
      count: items.length,
      products: sorted.slice(0, 4),
      recommended: sorted[0] || null,
    };
  }).sort((a, b) => (TYPE_ORDER[a.key] || 9) - (TYPE_ORDER[b.key] || 9));
}

function buildProductAnswer(message: string, products: Product[]) {
  const groups = groupProducts(products);
  const total = products.length;
  const compatible = groups.find((g) => g.key === 'compatible');
  const original = groups.find((g) => g.key === 'original');
  const renovated = groups.find((g) => g.key === 'renovated');
  const query = message.trim();

  const groupText = groups.map((group) => {
    if (group.key === 'compatible') return formatCount(group.count, 'kompatibilný', 'kompatibilné', 'kompatibilných');
    if (group.key === 'original') return formatCount(group.count, 'originálny', 'originálne', 'originálnych');
    if (group.key === 'renovated') return formatCount(group.count, 'renovovaný', 'renovované', 'renovovaných');
    return formatCount(group.count, 'ostatný', 'ostatné', 'ostatných');
  }).join(', ');

  const parts = [`Pre „${query}“ máme v ponuke ${formatCount(total, 'produkt', 'produkty', 'produktov')}: ${groupText}.`];

  if (compatible?.recommended) parts.push(`Ako prvú voľbu odporúčam kompatibilnú možnosť ${compatible.recommended.name}. Má najlepší pomer cena/výkon pre bežnú domácu aj kancelársku tlač.`);
  if (original?.recommended) parts.push(`Ak chcete originálnu kvalitu výrobcu tlačiarne, vyberte originálnu možnosť ${original.recommended.name}. Je drahšia, ale je to najistejšia originálna voľba.`);
  if (renovated?.recommended) parts.push(`Renovovaná možnosť je vhodná ako ekologickejšia alternatíva: ${renovated.recommended.name}.`);

  parts.push('Nižšie zobrazujem najvhodnejšie produkty zoradené podľa typu. Pred vložením do košíka ešte odporúčam skontrolovať model tlačiarne v detaile produktu.');
  return parts;
}

function shouldTryProductFirst(message: string, intent: AiIntent) {
  if (['shipping', 'payment', 'claim', 'order', 'account', 'legal', 'contact'].includes(intent)) return false;
  if (intent === 'diagnostic' && !hasProductCodeOrModel(message)) return false;
  if (intent === 'compatibility' && !hasProductCodeOrModel(message)) return false;
  return hasProductCodeOrModel(message);
}

export async function buildAssistantAnswer(message: string) {
  const originalMessage = String(message || '').trim();
  if (!originalMessage) return { answer: ['Napíšte model tlačiarne, označenie toneru alebo otázku.'], products: [], groups: [], intent: 'empty' };

  const classified = classifyIntent(originalMessage);

  if (shouldTryProductFirst(originalMessage, classified.intent)) {
    const cache = await getProductsCache();
    const found = relevantProducts(cache.products || [], originalMessage);
    if (found.length) {
      const groups = groupProducts(found);
      const selectedProducts = groups.flatMap((group) => group.products).slice(0, 12).map(asAiProduct);
      return {
        answer: buildProductAnswer(originalMessage, found),
        products: selectedProducts,
        groups: groups.map((group) => ({ key: group.key, label: group.label, count: group.count, products: group.products.slice(0, 4).map(asAiProduct) })),
        intent: 'product_search',
        confidence: 0.95,
      };
    }
  }

  const matched = knowledgeMatch(originalMessage, classified.intent);
  if (matched) {
    return {
      answer: [`${matched.item.title}:`, ...matched.item.answer],
      products: [],
      groups: [],
      intent: matched.item.intent,
      faq: matched.item.id,
      confidence: Math.min(0.98, matched.score / 260),
    };
  }

  // Ak otázka vyzerá ako model/toner, skúsime produkty aj po znalostnej databáze.
  if (!shouldTryProductFirst(originalMessage, classified.intent) && hasProductCodeOrModel(originalMessage)) {
    const cache = await getProductsCache();
    const found = relevantProducts(cache.products || [], originalMessage);
    if (found.length) {
      const groups = groupProducts(found);
      return {
        answer: buildProductAnswer(originalMessage, found),
        products: groups.flatMap((group) => group.products).slice(0, 12).map(asAiProduct),
        groups: groups.map((group) => ({ key: group.key, label: group.label, count: group.count, products: group.products.slice(0, 4).map(asAiProduct) })),
        intent: 'product_search',
        confidence: 0.9,
      };
    }
  }

  return { answer: AI_CONTACT_FALLBACK, products: [], groups: [], intent: 'fallback', confidence: 0.2, unanswered: true };
}
