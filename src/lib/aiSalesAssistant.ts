import { compactKey, getProductsCache, normalize } from './tm-products-cache.ts';
import { aiKnowledge, type AiKnowledgeItem } from '../data/ai-knowledge.ts';
import { findExactPrinterModelMatches, findExactProductIdentityMatches } from './catalog-query.ts';
import { answerWithOpenAi } from './openai-sales-assistant.ts';

export type AiIntent = 'product_search' | 'shipping' | 'payment' | 'claim' | 'order' | 'diagnostic' | 'compatibility' | 'support' | 'account' | 'loyalty' | 'legal' | 'contact' | 'fallback' | 'empty';

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
  shipping: ['doprava', 'dopravne', 'postovne', 'kurier', 'gls', 'dpd', 'pickup', 'box', 'balikomat', 'parcelshop', 'dorucenie', 'pride balik', 'cena dopravy', 'balik na adresu'],
  payment: ['platba', 'zaplatit', 'gopay', 'dobierka', 'prevod', 'faktura', 'kartou', 'bankovy prevod', 'ico', 'dic', 'firma'],
  claim: ['reklamacia', 'reklamovat', 'vratit', 'vymenit', 'nepasuje', 'nesedi', 'zly toner', 'chyba tovaru', 'prisiel zly', 'nefunguje', 'vratenie'],
  order: ['objednavka', 'objednavku', 'objednal', 'odoslete', 'poslete', 'expedujete', 'expedicia', 'kedy pride', 'kedy mi pride', 'stav objednavky', 'sledovanie zasielky', 'tracking', 'kde je balik'],
  diagnostic: ['tlaci', 'pasy', 'ciary', 'smuhy', 'flaky', 'bledy', 'biele pasy', 'slaba farba', 'farba je slaba', 'slabo', 'sype', 'prasi', 'nerozpozna', 'chyba kazety', 'cartridge error', 'replace toner', 'po vymene tonera netlaci'],
  compatibility: ['kompatibilny', 'originalny', 'renovovany', 'renovovany toner', 'repasovany', 'alternativa', 'alternativny', 'lacnejsi ako original', 'rozdiel', 'zaruka', 'poskodi', 'pokazit tlaciaren'],
  support: ['ako najdem', 'aky toner', 'spravny toner', 'model tlaciarne', 'oznacenie tonera', 'kde najdem oznacenie', 'co zadat', 'toner alebo atrament'],
  account: ['ucet', 'prihlasenie', 'registracia', 'heslo', 'zabudnute heslo', 'nakup bez registracie', 'bez registracie', 'profil', 'adresa v ucte', 'ulozene tlaciarne', 'ulozene produkty', 'historia objednavok'],
  loyalty: ['vernost', 'vernostny', 'body', 'bodov', '1 bod', '7 %', '7%', '7 percent', '5 %', '5%', '5 percent', 'odmena', 'registracie', 'registraciu', 'zlava za registraciu', 'zlava po registracii'],
  legal: ['gdpr', 'cookies', 'osobne udaje', 'obchodne podmienky', 'vop', 'predavajuci', 'prevadzkovatel', 'ico', 'sidlo'],
  contact: ['kontakt', 'telefon', 'mail', 'email', 'pracovna doba', 'cislo'],
  product_search: [], fallback: [], empty: [],
};

function uniq<T>(values: T[]) { return [...new Set(values)]; }

const MATCH_STOP_WORDS = new Set(['na', 'do', 'za', 'od', 'po', 'mi', 'ma', 'mam', 'som', 'sa', 'si', 'je', 'to', 'a', 'aj', 'v', 'vo', 's', 'so', 'pre', 'ako', 'co']);

function words(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter((x) => x.length >= 2 && !MATCH_STOP_WORDS.has(x));
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
  // Bežné čísla (percentá, ceny, počty objednávok) nesmú spustiť produktové vyhľadávanie.
  // Všeobecný model musí mať písmeno a číslo v tom istom tokene; medzeru povoľujeme iba pri známych OEM prefixoch.
  if (/\b[a-z]{1,8}-?\d{2,}[a-z0-9-]*\b/i.test(text)) return true;
  if (/\b\d{2,}[a-z]{1,5}\b/i.test(text)) return true;
  if (/\b(cf|ce|crg|tn|dr|w|q|clt|mlt|tk|pg|cli|lc)\s*-?\s*\d{2,}[a-z0-9]*\b/i.test(text)) return true;
  // Modely často zákazník napíše ako značka + číselný model (napr. Xerox 3020).
  if (/\b(hp|brother|canon|epson|samsung|oki|xerox|kyocera|lexmark|ricoh|sharp|toshiba|pantum|dell|konica|minolta)\s+[a-z-]*\d{3,}[a-z0-9-]*\b/i.test(text)) return true;
  return false;
}

function productQueryCandidates(message: string) {
  const normalized = normalize(message).replace(/[^a-z0-9-]+/g, ' ').trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const candidates: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!/\d/.test(tokens[i])) continue;
    for (let before = 0; before <= 2; before += 1) {
      const start = Math.max(0, i - before);
      const value = tokens.slice(start, Math.min(tokens.length, i + 2)).join(' ');
      if (hasProductCodeOrModel(value)) candidates.push(value);
    }
  }
  candidates.push(message);
  return uniq(candidates).sort((a, b) => a.length - b.length);
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
  const matched = triggerWords.filter((word) => messageWords.has(word)).length;
  if (!matched) return 0;
  if (triggerWords.length === 1) return matched ? 60 : 0;
  if (matched === triggerWords.length) return 80;
  if (matched >= 2) return matched * 24;
  return 0;
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
    const triggerScore = item.triggers.reduce((sum, trigger) => sum + keywordScore(message, trigger), 0);
    // Priorita sama osebe nikdy nesmie spôsobiť odpoveď na nesúvisiacu otázku.
    if (!triggerScore) continue;
    let score = triggerScore + Number(item.priority || 0);
    if (preferredIntent && item.intent === preferredIntent) score += 70;
    if (preferredIntent && item.intent !== preferredIntent) score -= 35;
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

function isTonerRequest(message: string) {
  const text = normalize(message);
  return /\btoner(y|u|om|ov)?\b/.test(text) || /\b(tn|cf|ce|crg|w|q|mlt|clt|tk)\s*-?\s*\d{2,}/.test(text);
}

function nonTonerPart(product: Product) {
  return /optick|valec|drum|fuser|fixac|zapekac|atrament|prenosov.*pas|transfer.*belt/i.test(normalize(`${product.name || ''} ${product.product_type_label || ''}`));
}


function filterRequestedProductType(products: Product[], message: string) {
  const text = normalize(message);
  let wanted = '';
  if (/\b(original|originalny|originalna|originalne|originalny)\b/.test(text)) wanted = 'original';
  else if (/\b(kompatibil|alternativ|lacnejs)\w*/.test(text)) wanted = 'compatible';
  else if (/\b(renov|repas)\w*/.test(text)) wanted = 'renovated';
  if (!wanted) return products;
  const filtered = products.filter((product) => String(product.product_type_key || '').toLowerCase() === wanted);
  return filtered.length ? filtered : products;
}

function relevantProducts(products: Product[], message: string) {
  const raw = message.trim();

  // Pri otázke vo vete najprv hľadáme presný model tlačiarne. Tým zabránime
  // miešaniu regionálnych modelov (napr. L2350DW vs L2352DW) a náhodným atramentom.
  for (const candidate of productQueryCandidates(raw)) {
    const printerMatches = findExactPrinterModelMatches(products, candidate);
    if (printerMatches.length) {
      let matched = printerMatches.map((match) => match.product);
      if (isTonerRequest(raw)) matched = matched.filter((product) => !nonTonerPart(product));
      matched = filterRequestedProductType(matched, raw);
      return matched
        .sort((a, b) => (TYPE_ORDER[a.product_type_key] || 9) - (TYPE_ORDER[b.product_type_key] || 9)
          || Number(a.price || 0) - Number(b.price || 0)
          || String(a.name || '').localeCompare(String(b.name || ''), 'sk'))
        .slice(0, 60);
    }
  }

  let exactIdentityMatches = productQueryCandidates(raw)
    .flatMap((candidate) => findExactProductIdentityMatches(products, candidate))
    .filter((match, index, all) => all.findIndex((other) => other.product.id === match.product.id) === index);

  // Pri explicitnom OEM prefixe nesmie samotné číslo (napr. 737) pritiahnuť
  // nesúvisiaci produkt inej značky.
  const explicitOem = normalize(raw).match(/\b(cf|ce|crg|tn|dr|w|q|clt|mlt|tk|pgi|cli|lc)\s*-?\s*(\d{2,}[a-z0-9]*)\b/i);
  if (explicitOem) {
    const wanted = compactKey(`${explicitOem[1]}${explicitOem[2]}`);
    const strict = exactIdentityMatches.filter((match) => compactKey(productSearchValue(match.product)).includes(wanted));
    if (strict.length) exactIdentityMatches = strict;
  }

  // Marketingové označenia typu „HP 83A“ alebo „142A“ najprv môžu nájsť
  // originál, z ktorého vieme získať kanonický SKU (napr. CF283A/W1420A).
  // Potom doplníme celú rodinu vrátane kompatibilných a renovovaných variantov.
  if (exactIdentityMatches.length && !explicitOem && /\b(?:hp\s*)?\d{2,4}[a-z]{0,2}\b/i.test(normalize(raw))) {
    const canonical = uniq(exactIdentityMatches.flatMap((m: any) => {
      const values = [String(m.product?.sku || '').trim()];
      const name = String(m.product?.name || '');
      const code = name.match(/\b(?:CF|CE|CRG|TN|DR|W|Q|CLT|MLT|TK|PGI|CLI|LC)[- ]?\d{2,}[A-Z0-9-]*\b/i)?.[0];
      if (code) values.push(code);
      return values;
    }).filter((sku) => /[a-z].*\d|\d.*[a-z]/i.test(sku)));
    for (const sku of canonical.slice(0, 2)) {
      exactIdentityMatches.push(...findExactProductIdentityMatches(products, sku));
    }
    exactIdentityMatches = exactIdentityMatches.filter((match, index, all) => all.findIndex((other) => other.product.id === match.product.id) === index);
  }

  if (exactIdentityMatches.length) {
    let exactProducts = exactIdentityMatches.map((match) => match.product);
    if (!/renovac|repas|sluzb/i.test(normalize(raw))) {
      exactProducts = exactProducts.filter((product) => !/\bsluzba\b.*renovac|renovacia pre/i.test(normalize(product.name || '')));
    }
    exactProducts = filterRequestedProductType(exactProducts, raw);
    return exactProducts
      .sort((a, b) => (
        (TYPE_ORDER[a.product_type_key] || 9) - (TYPE_ORDER[b.product_type_key] || 9)
        || Number(a.price || 0) - Number(b.price || 0)
        || String(a.name || '').localeCompare(String(b.name || ''), 'sk')
      ))
      .slice(0, 60);
  }

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

function findCompatibilityConflict(products: Product[], message: string) {
  const modelTokens = normalize(message).replace(/[^a-z0-9-]+/g, ' ').split(/\s+/).filter((t) => /[a-z]/.test(t) && /\d/.test(t));
  if (modelTokens.length < 2) return null;
  // Pri kombinácii modelu tlačiarne a OEM kódu stačia dve cielené analýzy celej otázky.
  // Neopakujeme scan katalógu pre každý fragment otázky.
  const printer = findExactPrinterModelMatches(products, message);
  const identity = findExactProductIdentityMatches(products, message);
  if (!printer.length || !identity.length) return null;
  const printerIds = new Set(printer.map((x: any) => String(x.product?.id)));
  if (identity.some((x: any) => printerIds.has(String(x.product?.id)))) return null;
  const alternatives = printer.map((x: any) => x.product).filter((p: Product) => !isTonerRequest(message) || !nonTonerPart(p));
  return { requested: identity[0]?.product, alternatives };
}

function noChipPenalty(product: Product) {
  const text = normalize(`${product.name || ''} ${product.sku || ''}`);
  return /no chip|no-chip|bez cipu|bez čipu/.test(text) ? 1 : 0;
}


function parsePageYield(product: Product): number | null {
  const candidates = [product.capacity, product.kapacita, product.yield, product.page_yield];
  if (Array.isArray(product.attributes)) {
    for (const attr of product.attributes) {
      const name = normalize(`${attr?.name || ''}`);
      if (/kapacit|vytaz|vytaznost|yield|stran/.test(name)) {
        candidates.push(attr?.value, ...(Array.isArray(attr?.options) ? attr.options : []));
      }
    }
  }
  for (const value of candidates) {
    if (value == null) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const text = String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    // Kapacity tonerov sú typicky stovky až desiatky tisíc strán. Neberieme náhodné malé čísla.
    const matches = [...text.matchAll(/(\d{3,6}(?:[ .]\d{3})*)\s*(?:str(?:a|á)n|pages?)?/gi)];
    for (const match of matches) {
      const num = Number(match[1].replace(/[ .]/g, ''));
      if (Number.isFinite(num) && num >= 100 && num <= 200000) return num;
    }
  }
  return null;
}

function costPerPage(product: Product): number | null {
  const price = Number(product.price || 0);
  const pages = parsePageYield(product);
  if (!price || price <= 0 || !pages) return null;
  return price / pages;
}

function asksCostPerPage(message: string) {
  const text = normalize(message);
  return /cena.*stran|naklad.*stran|pomer.*cena.*stran|najvyhodnejs.*toner|najleps.*pomer|najlacnejs.*tlac|kolko.*jedna stran/.test(text);
}

function formatCostPerPage(value: number) {
  if (value < 0.01) return `${(value * 100).toFixed(2).replace('.', ',')} centa/str.`;
  return `${value.toFixed(3).replace('.', ',')} €/str.`;
}

function groupProductsForQuestion(products: Product[], message: string): ProductGroup[] {
  const groups = groupProducts(products);
  if (!asksCostPerPage(message)) return groups;
  return groups.map((group) => {
    const withCpp = group.products
      .map((p) => ({ p, cpp: costPerPage(p) }))
      .sort((a, b) => {
        if (a.cpp == null && b.cpp == null) return noChipPenalty(a.p) - noChipPenalty(b.p) || Number(a.p.price || 999999) - Number(b.p.price || 999999);
        if (a.cpp == null) return 1;
        if (b.cpp == null) return -1;
        return noChipPenalty(a.p) - noChipPenalty(b.p) || a.cpp - b.cpp || Number(a.p.price || 999999) - Number(b.p.price || 999999);
      });
    const sorted = withCpp.map((x) => x.p);
    return { ...group, products: sorted.slice(0, 4), recommended: sorted[0] || null };
  });
}

function groupProducts(products: Product[]): ProductGroup[] {
  const map = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.product_type_key || 'product';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(product);
  }

  return [...map.entries()].map(([key, items]) => {
    const sorted = [...items].sort((a, b) => noChipPenalty(a) - noChipPenalty(b) || Number(a.price || 999999) - Number(b.price || 999999));
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
  const groups = groupProductsForQuestion(products, message);
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

  if (asksCostPerPage(message)) {
    const ranked = products.map((p) => ({ p, cpp: costPerPage(p), pages: parsePageYield(p) })).filter((x) => x.cpp != null).sort((a, b) => (a.cpp! - b.cpp!));
    if (ranked.length) {
      const best = ranked[0];
      parts.push(`Najlepší vypočítateľný pomer ceny a deklarovanej výťažnosti má ${best.p.name}: približne ${formatCostPerPage(best.cpp!)} pri cene ${Number(best.p.price || 0).toFixed(2).replace('.', ',')} € a deklarovanej kapacite ${best.pages!.toLocaleString('sk-SK')} strán.`);
      parts.push('Ide o orientačný prepočet z aktuálnej ceny a deklarovanej kapacity v katalógu. Reálna cena za stranu závisí od pokrytia stránky a spôsobu tlače. Produkty bez spoľahlivo uvedenej kapacity do poradia podľa ceny za stranu nezaraďujem.');
    } else {
      parts.push('Pri týchto produktoch nemám v katalógu dostatočne spoľahlivú kapacitu na korektný výpočet ceny za jednu stranu, preto poradie nebudem odhadovať.');
    }
  }

  if (compatible?.recommended) {
    const cpp = costPerPage(compatible.recommended);
    parts.push(asksCostPerPage(message) && cpp != null
      ? `Z kompatibilných možností vychádza najlepšie ${compatible.recommended.name} – približne ${formatCostPerPage(cpp)}.`
      : `Z kompatibilných možností je cenovo najvýhodnejšia ${compatible.recommended.name}. Vhodnosť vždy overte podľa presného modelu tlačiarne.`);
  }
  if (original?.recommended) parts.push(`Ak chcete originálnu kvalitu výrobcu tlačiarne, vyberte originálnu možnosť ${original.recommended.name}. Je drahšia, ale je to najistejšia originálna voľba.`);
  if (renovated?.recommended) parts.push(`Renovovaná možnosť je vhodná ako ekologickejšia alternatíva: ${renovated.recommended.name}.`);

  parts.push('Nižšie zobrazujem najvhodnejšie produkty zoradené podľa typu. Pred vložením do košíka ešte odporúčam skontrolovať model tlačiarne v detaile produktu.');
  return parts;
}

function enrichProductAnswer(message: string, answer: string[], products: Product[]) {
  const text = normalize(message);
  const extra = [...answer];
  if (/sklad|skladom|mate ho|mate ich/.test(text)) {
    const inStock = products.filter((p) => String(p.stock_status || 'instock') === 'instock').length;
    extra.push(inStock ? `Z nájdených možností je ${inStock} aktuálne označených ako skladom.` : 'Pri nájdených produktoch si skladovosť overte v detaile produktu.');
  }
  if (/cesk|cesko|\bcr\b|\bcz\b|brno|praha/.test(text)) {
    extra.push('Do Českej republiky posielame iba klasickým kuriérom na adresu. Cena GLS alebo DPD kuriéra je 3,90 € s DPH, rovnako ako na Slovensku; doprava je zdarma od 29 € hodnoty tovaru po zľavách. GLS ParcelShop/Balíkomat ani DPD Pickup/Pickup Box máme nastavené iba pre Slovensko.');
  } else if (/doprava|kurier|doruc|poslat|poslete/.test(text)) {
    extra.push('Na Slovensku stojí kuriér GLS alebo DPD 3,90 € s DPH; GLS ParcelShop/Balíkomat a DPD Pickup/Pickup Box 2,90 €. Doprava je zdarma od 29 € hodnoty tovaru po zľavách.');
  }
  if (/kedy|ako rychlo|za kolko dni|pride|dorucenie/.test(text)) {
    extra.push('Tovar označený „Skladom“ objednaný v pracovný deň do 15:00 spravidla expedujeme v ten istý pracovný deň; doručenie býva spravidla 1–2 pracovné dni od odoslania.');
  }
  return extra;
}

function shouldTryProductFirst(message: string, intent: AiIntent) {
  if (['shipping', 'payment', 'claim', 'order', 'account', 'legal', 'contact'].includes(intent)) return false;
  if (intent === 'diagnostic' && !hasProductCodeOrModel(message)) return false;
  if (intent === 'compatibility' && !hasProductCodeOrModel(message)) return false;
  return hasProductCodeOrModel(message);
}

export type AiConversationTurn = { role: 'user' | 'assistant'; content: string };

function contextualizeFollowUp(message: string, history: AiConversationTurn[] = []) {
  const current = String(message || '').trim();
  const n = normalize(current);
  if (!current || !history.length) return current;

  // Ak zákazník zadal nový konkrétny model/OEM, starý kontext sa nesmie miešať.
  // Výnimka: prirodzené pokračovanie s mestom/ČR (napr. „pošlete mi ho do Brna?“)
  // môže heuristika modelu vyhodnotiť ako kód, hoci ide len o dopravu.
  const locationFollowUp = /\b(?:brno|brna|praha|cesko|ceska|cr|cz)\b/.test(n) && /posl|kurier|dopr|doruc|pickup|parcel|box/.test(n);
  if (hasProductCodeOrModel(current) && !locationFollowUp) return current;
  // Jednoznačná samostatná servisná otázka nepotrebuje zdediť predchádzajúci produkt.
  if (/\b(?:dobierk\w*|gopay|platb\w*|prevod\w*|faktur\w*|reklamac\w*|vraten\w*|odstupen\w*|hesl\w*|registrac\w*|gdpr|kontakt\w*|telefon\w*|email\w*|pracovna doba)/.test(n)) return current;

  const followUp = current.length <= 90 && (
    /^(a |ale |tak |dobre |ok |ano |nie )/.test(n)
    || /\b(lacnejs|drahsi|original|kompatibil|renov|sklad|skladom|kolko stoji|cena|do ceska|do cr|brno|brna|praha|kurier|doprava|poslete|poslat|objednat|ten|tento|tohto|zoberiem|chcem ho|chcem ju)\b/.test(n)
    || /kedy.*pride/.test(n)
  );
  if (!followUp) return current;

  const previousUsers = history.filter((turn) => turn?.role === 'user').map((turn) => String(turn.content || '').trim()).filter(Boolean).slice(-6).reverse();
  const productContext = previousUsers.find((text) => hasProductCodeOrModel(text));
  if (!productContext) return current;
  return `${productContext}. Nadväzujúca požiadavka zákazníka: ${current}`;
}

export async function buildAssistantAnswer(message: string, page = '', history: AiConversationTurn[] = []) {
  const rawMessage = String(message || '').trim();
  const originalMessage = contextualizeFollowUp(rawMessage, history);
  const isContextualProductFollowUp = originalMessage !== rawMessage && hasProductCodeOrModel(originalMessage);
  if (!rawMessage) return { answer: ['Napíšte model tlačiarne, označenie toneru alebo otázku.'], products: [], groups: [], intent: 'empty' };

  const classified = classifyIntent(originalMessage);

  // Neexistujúcu zľavu si Tomáš nesmie vymyslieť. Overené automatické percentá sú 5 % a 7 %.
  const discountMatch = normalize(originalMessage).match(/\b(\d{1,3})\s*(?:%|percent)/);
  if (/zlavu|zlavovy|zľavu|zľavovy/i.test(originalMessage) && discountMatch && !['5', '7'].includes(discountMatch[1])) {
    return {
      answer: [
        `Zľavu ${discountMatch[1]} % nemám v overených ponukách ToneryMAXIM, preto vám taký zľavový kód nebudem sľubovať.`,
        'Overené sú uvítacia zľava 5 % po registrácii a 7 % odmena na ďalší nákup kompatibilných tonerov po dokončenej objednávke.',
      ],
      products: [], groups: [], intent: 'fallback', confidence: 0.98, unanswered: true,
    };
  }

  // Jednoznačné obchodné témy routujeme priamo, aby ich všeobecné slová ako „nákup“ neprebili.
  const normalizedMessage = normalize(originalMessage);

  // Jasné požiadavky mimo schopností asistenta nesmú byť omylom klasifikované podľa slov ako e-mail či faktúra.
  if (/\b(napis|napiste|vytvor|urob)\b.*\b(email|mail|basen|basnick|zivotopis)\b/i.test(normalizedMessage)
      || /\b(urob|vystav|vytvor)\b.*\bfaktur/i.test(normalizedMessage)) {
    return {
      answer: [
        'Túto úlohu priamo v AI Tomášovi neviem vykonať.',
        'Rád však poradím s výberom toneru alebo náplne, kompatibilitou, dopravou, platbou, reklamáciou, účtom alebo problémom s tlačou.'
      ],
      products: [], groups: [], intent: 'fallback', confidence: 0.98, unanswered: true,
    };
  }

  // Identita asistenta: bežné otázky o tom, kto Tomáš je, nesmú skončiť vo fallbacku.
  if (/\b(ako sa volas|kto si|si (?:umela inteligencia|ai|robot)|si clovek|co si zac)\b/i.test(normalizedMessage)) {
    const identity = aiKnowledge.find((item) => item.id === 'ai-tomas-identita');
    if (identity) return { answer: [`${identity.title}:`, ...identity.answer], products: [], groups: [], intent: 'support', faq: identity.id, confidence: 0.99 };
  }

  // ToneryMAXIM nepredáva samotné tlačiarne. Toto musí mať prednosť pred katalógovým hľadaním,
  // pretože názvy kompatibilných tlačiarní sa nachádzajú v produktových dátach tonerov.
  if (/\b(predavate|mate|ponukate|kupim.*u vas|da sa.*kupit).*\btlaciarn/i.test(normalizedMessage)) {
    const printers = aiKnowledge.find((item) => item.id === 'predaj-tlaciarni');
    if (printers) return { answer: [`${printers.title}:`, ...printers.answer], products: [], groups: [], intent: 'support', faq: printers.id, confidence: 0.99 };
  }

  // Všeobecné otázky „predávate/máte X?“ overujeme priamo v aktuálnom katalógu.
  // Hľadáme iba v identite produktu (názov, SKU, typ/kategória), nie v zozname kompatibilných tlačiarní.
  const sellMatch = normalizedMessage.match(/\b(?:predavate|mate|ponukate)\s+(.{2,80}?)(?:\?|$)/i);
  if (sellMatch && !hasProductCodeOrModel(originalMessage)) {
    const rawWanted = String(sellMatch[1] || '').replace(/\b(?:v ponuke|na sklade|skladom|do tlaciarni|do tlaciarne)\b/gi, ' ').trim();
    const wantedWords = words(rawWanted).filter((w) => !['produkt', 'produkty', 'tovar'].includes(w));
    if (wantedWords.length) {
      const cache = await getProductsCache();
      const matches = (cache.products || []).filter((product: Product) => {
        const haystack = normalize([product.name, product.sku, product.product_type_label, product.category, product.categories, product.type].filter(Boolean).join(' '));
        return wantedWords.every((word) => haystack.includes(word) || (word.startsWith('pask') && haystack.includes('pask')));
      }).slice(0, 12);
      if (matches.length) {
        const groups = groupProductsForQuestion(matches, originalMessage);
        return {
          answer: [
            `Áno, v aktuálnom katalógu som našiel ${formatCount(matches.length, 'relevantný produkt', 'relevantné produkty', 'relevantných produktov')} pre „${rawWanted}“.`,
            'Ak mi napíšete presný model tlačiarne alebo označenie pôvodného spotrebného materiálu, pomôžem vybrať správnu možnosť.'
          ],
          products: groups.flatMap((group) => group.products).slice(0, 12).map(asAiProduct),
          groups: groups.map((group) => ({ key: group.key, label: group.label, count: group.count, products: group.products.slice(0, 4).map(asAiProduct) })),
          intent: 'product_search', confidence: 0.96,
        };
      }
      return {
        answer: [
          `Pre „${rawWanted}“ som v aktuálnom katalógu nenašiel spoľahlivú zhodu. Nechcem preto tvrdiť, že tento sortiment predávame, ak to neviem overiť.`,
          'Napíšte presný model tlačiarne alebo označenie produktu a skúsim ho preveriť presnejšie.'
        ], products: [], groups: [], intent: 'fallback', confidence: 0.55, unanswered: true, clarification: true,
      };
    }
  }

  // Otázky okolo hranice dopravy zdarma majú prednosť pred platbou/dobierkou.
  if (/\b(29|28[,.]?\d*)\b/.test(normalizedMessage) && /doprava|dobierka|kosik|nakup|objednavk/.test(normalizedMessage)) {
    const shipping = aiKnowledge.find((item) => item.id === 'doprava-ceny');
    if (shipping) return { answer: [`${shipping.title}:`, ...shipping.answer], products: [], groups: [], intent: 'shipping', faq: shipping.id, confidence: 0.98 };
  }

  // Citlivé údaje: explicitné otázky majú vždy bezpečnostnú odpoveď.
  if (/\b(cislo karty|platobn.*kart|cvv|cvc|pin|rodne cislo|iban|heslo do bank|cislo objednavky|adres[auy]?)\b/i.test(normalizedMessage)
      && /mozem|poslat|napisat|sem|zadavat|zadat/i.test(normalizedMessage)) {
    const sensitive = aiKnowledge.find((item) => item.id === 'citlive-udaje-chat');
    if (sensitive) return { answer: [`${sensitive.title}:`, ...sensitive.answer], products: [], groups: [], intent: 'legal', faq: sensitive.id, confidence: 0.99 };
  }

  // Čas expedície má prednosť pred spôsobom platby, ak sa zákazník pýta kedy bude objednávka odoslaná.
  if (!isContextualProductFollowUp && /(?:objednal.*(?:dnes|sobot|nedel|vikend)|kedy.*exped|kedy.*odosl|prevod.*kedy.*exped)/i.test(normalizedMessage)) {
    const dispatch = aiKnowledge.find((item) => item.id === 'expedicia-kedy-posleme');
    if (dispatch) return { answer: [`${dispatch.title}:`, ...dispatch.answer], products: [], groups: [], intent: 'order', faq: dispatch.id, confidence: 0.98 };
  }

  // Otázka na vrátenie peňazí po odstúpení potrebuje presnú lehotu, nie všeobecný postup vrátenia.
  if (/vrat\w* peniaz|peniaz\w*.*odstupen|odstupen.*peniaz/i.test(normalizedMessage)) {
    const refund = aiKnowledge.find((item) => item.id === 'odstupenie-vratenie-penazi');
    if (refund) return { answer: [`${refund.title}:`, ...refund.answer], products: [], groups: [], intent: 'claim', faq: refund.id, confidence: 0.98 };
  }

  // Vrátenie/reklamácia má prednosť pred slovom poštovné alebo toner, aby sa otázka
  // o nákladoch na vrátenie nezamenila za bežnú cenu dopravy.
  if (/vrateni|vratenie|odstupen|nespravny toner|zle som objednal|kupil som nespravny/i.test(normalizedMessage)) {
    const returns = aiKnowledge.find((item) => item.id === 'vratenie-tovaru');
    if (returns) return { answer: [`${returns.title}:`, ...returns.answer], products: [], groups: [], intent: 'claim', faq: returns.id, confidence: 0.98 };
  }
  const directKnowledgeId = /rodne cislo|adres[auy]?|iban|cislo objednavky/i.test(normalizedMessage) && /mozem|poslat|napisat|sem/i.test(normalizedMessage)
    ? 'citlive-udaje-chat'
    : /(?:ake|vase|vas|kto|firma|prevadzkovatel|predavajuci|sidlo).*\b(?:ico|dic|ic dph|prevadzkuje|predavajuci|sidlo)\b|\bkto prevadzkuje\b/i.test(normalizedMessage)
      ? 'predavajuci-firma'
    : /(?:zmen\w*|uprav\w*).*\b(?:heslo|adres\w*|profil|telefon|osobne udaje)\b/i.test(normalizedMessage)
      ? 'ucet-profil-heslo'
    : /(?:ako dlho|lehota|30 dni|dva roky).*reklamac|reklamac.*(?:ako dlho|lehota|30 dni|dva roky)/i.test(normalizedMessage)
      ? 'reklamacia-lehoty'
    : /prazdn\w* toner|recykl\w* toner|spatn\w* odber.*toner/i.test(normalizedMessage)
      ? 'recyklacia-tonerov'
    : /\bbod(y|ov|ov)?\b|vernost/i.test(normalizedMessage)
    ? 'vernost-body'
    : /bez registracie|musim (mat )?ucet|co dostanem za registrac|vyhoda registrac|chcem sa zaregistrovat/i.test(normalizedMessage)
      ? 'registracia-zlava'
      : '';
  if (directKnowledgeId) {
    const direct = aiKnowledge.find((item) => item.id === directKnowledgeId);
    if (direct) return { answer: [`${direct.title}:`, ...direct.answer], products: [], groups: [], intent: direct.intent as AiIntent, faq: direct.id, confidence: 0.98 };
  }

  // Zahraničná doprava musí mať prednosť pred všeobecnou slovenskou dopravou.
  // Česká doprava má vlastnú odpoveď: iba klasický kuriér, bez SK pickup/parcelshop možností.
  if (!hasProductCodeOrModel(originalMessage) && /\b(cesk(a|ej|u|o)|cesko|cr|cz|brno|brna|praha|prahy)\b/i.test(normalize(originalMessage))) {
    const foreignShipping = aiKnowledge.find((item) => item.id === 'ceska-republika');
    if (foreignShipping) return {
      answer: [`${foreignShipping.title}:`, ...foreignShipping.answer],
      products: [], groups: [], intent: 'shipping', faq: foreignShipping.id, confidence: 0.98,
    };
  }

  if (isContextualProductFollowUp || shouldTryProductFirst(originalMessage, classified.intent)) {
    const cache = await getProductsCache();
    const conflict = findCompatibilityConflict(cache.products || [], originalMessage);
    if (conflict?.requested && conflict.alternatives.length) {
      const found = conflict.alternatives.slice(0, 60);
      const groups = groupProductsForQuestion(found, originalMessage);
      return {
        answer: enrichProductAnswer(originalMessage, [
          `${conflict.requested.name || conflict.requested.sku || 'Zadaná náplň'} nie je v našich katalógových dátach vedená ako kompatibilná so zadaným modelom tlačiarne.`,
          `Pri modeloch ako Brother HL-L2350DW a HL-L2352DW však odporúčam najprv skontrolovať presné označenie priamo na štítku tlačiarne a zároveň označenie tonerovej kazety, ktorú v tlačiarni aktuálne používate.`,
          `Windows alebo ovládač tlačiarne môže v niektorých prípadoch zobrazovať podobné alebo regionálne označenie modelu, preto sa pri výbere náplne nespoliehajte iba na názov uvedený v počítači.`,
          `Ak je na tlačiarni naozaj HL-L2350DW, vyberajte z kompatibilných produktov zobrazených nižšie. Ak je na štítku HL-L2352DW alebo na používanej kazete nájdete TN-2421/TN-2411, napíšte mi toto označenie a overím správnu náplň.`
        ], found),
        products: groups.flatMap((group) => group.products).slice(0, 12).map(asAiProduct),
        groups: groups.map((group) => ({ key: group.key, label: group.label, count: group.count, products: group.products.slice(0, 4).map(asAiProduct) })),
        intent: 'product_search', confidence: 0.98,
      };
    }
    const found = relevantProducts(cache.products || [], originalMessage);
    if (found.length) {
      const groups = groupProductsForQuestion(found, originalMessage);
      const selectedProducts = groups.flatMap((group) => group.products).slice(0, 12).map(asAiProduct);
      return {
        answer: enrichProductAnswer(originalMessage, buildProductAnswer(originalMessage, found), found),
        products: selectedProducts,
        groups: groups.map((group) => ({ key: group.key, label: group.label, count: group.count, products: group.products.slice(0, 4).map(asAiProduct) })),
        intent: 'product_search',
        confidence: 0.95,
      };
    }
  }

  // Technické poradenské otázky o typoch tlačiarní a nákladoch na tlač.
  // Majú prednosť pred všeobecným produktovým fallbackom, ale nikdy nehádať konkrétny toner bez modelu tlačiarne.
  const technicalKnowledgeId = /tankov\w* tlaciar/i.test(normalizedMessage)
    ? 'typy-tlaciarni-prehlad'
    : /(?:najlacnejs|najnižš|najnizs).*?(?:tlac|prevadzk)|(?:laser|tank|atrament).*?(?:cena za stranu|najlacnejs)/i.test(normalizedMessage)
      ? 'naklady-na-stranu-typ-tlaciarne'
    : /(?:cena|naklad|prepocet).*?(?:jedn\w* )?stran|kolko stoji.*stran/i.test(normalizedMessage)
      ? 'cena-za-stranu-vypocet'
    : /(?:najleps|najvyhodnejs).*?(?:pomer|cena).*?stran|toner.*?cena.*?vykon/i.test(normalizedMessage)
      ? 'najlepsi-pomer-toner'
    : /najlacnejs\w* toner.*?(?:ciern|farebn)|aky.*najlacnejs\w* toner/i.test(normalizedMessage)
      ? 'najlacnejsi-toner-bez-modelu'
    : /aku tlaciaren.*(?:kup|odpor)|odporuc.*tlaciaren|tlaciaren.*(?:domov|kancelari|vela tlace|malo tlace)/i.test(normalizedMessage)
      ? 'vyber-tlaciarne-podla-pouzitia'
      : '';
  if (technicalKnowledgeId) {
    const technical = aiKnowledge.find((item) => item.id === technicalKnowledgeId);
    if (technical) return { answer: [`${technical.title}:`, ...technical.answer], products: [], groups: [], intent: 'support', faq: technical.id, confidence: 0.98 };
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
      const groups = groupProductsForQuestion(found, originalMessage);
      return {
        answer: enrichProductAnswer(originalMessage, buildProductAnswer(originalMessage, found), found),
        products: groups.flatMap((group) => group.products).slice(0, 12).map(asAiProduct),
        groups: groups.map((group) => ({ key: group.key, label: group.label, count: group.count, products: group.products.slice(0, 4).map(asAiProduct) })),
        intent: 'product_search',
        confidence: 0.9,
      };
    }
  }

  if (hasProductCodeOrModel(originalMessage)) {
    return {
      answer: [
        'Pri tomto označení si nechcem tipnúť nesprávny produkt.',
        'Upresnite prosím značku a celé označenie náplne, napríklad „HP 652XL“, alebo napíšte presný model tlačiarne zo štítku.',
      ],
      products: [],
      groups: [],
      intent: 'fallback',
      confidence: 0.35,
      unanswered: true,
      clarification: true,
    };
  }

  const aiResult = await answerWithOpenAi(originalMessage, page);
  if (aiResult) {
    return {
      answer: aiResult.answer,
      products: [],
      groups: [],
      intent: aiResult.status === 'answer' ? 'support' : 'fallback',
      confidence: aiResult.confidence,
      unanswered: aiResult.status !== 'answer',
      clarification: aiResult.status === 'clarify',
      source: 'openai-grounded-knowledge',
    };
  }

  return {
    answer: [
      'Na túto otázku nemám v overených informáciách spoľahlivú odpoveď, preto si nechcem nič vymýšľať.',
      'Rád poradím s výberom toneru alebo náplne, kompatibilitou, dopravou, platbou, reklamáciou, účtom alebo problémom s tlačou. Pri inej otázke nás môžete kontaktovať na info@tonerymaxim.sk alebo +421 917 859 206.',
    ],
    products: [],
    groups: [],
    intent: 'fallback',
    confidence: 0.2,
    unanswered: true,
    clarification: true,
  };
}
