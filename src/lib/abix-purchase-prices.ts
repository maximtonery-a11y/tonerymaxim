export type AbixPriceRecord = {
  sku: string;
  purchase_price: number;
  purchase_price_no_vat: number | null;
  vat_rate: number | null;
  stock_quantity: number | null;
  source: 'abix';
};

export type AbixFeedDiagnostics = {
  records_seen: number;
  records_with_sku: number;
  records_with_price: number;
  duplicates: number;
  detected_record_tag: string;
};

const DEFAULT_URL = 'https://www.abix.sk/data-feed/c1ef84a1-b0a5-46f3-b965-423f4d64ef24/8DAA9232-7FCE-4543-8506-8D0CDB8D3A2B';
const SKU_TAGS = ['sku','code','kod','product_code','productcode','item_code','symbol','id','product_id'];
const PRICE_NET_TAGS = ['price_no_vat','price_without_vat','price_net','net_price','purchase_price_no_vat','purchase_price','cena_bez_dph','cenabezdph','price'];
const PRICE_GROSS_TAGS = ['price_vat','price_with_vat','price_gross','gross_price','cena_s_dph','cenasdph'];
const VAT_TAGS = ['vat','vat_rate','dph','tax'];
const STOCK_TAGS = ['stock','stock_qty','quantity','qty','availability','avail','skladom'];

function decodeXml(v: string): string {
  return v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
function numberValue(v: string): number | null {
  if (!String(v || '').trim()) return null;
  const cleaned = decodeXml(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned); return Number.isFinite(n) ? n : null;
}
function tagValue(xml: string, aliases: string[]): string {
  for (const tag of aliases) {
    const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (m) return decodeXml(m[1]);
  }
  return '';
}
function detectRecordTag(xml: string): string {
  for (const tag of ['SHOPITEM','PRODUCT','ITEM','product','item']) {
    const count = (xml.match(new RegExp(`<${tag}(?:\\s|>)`, 'g')) || []).length;
    if (count >= 2) return tag;
  }
  return '';
}

export function parseAbixFeed(xml: string): { prices: Map<string, AbixPriceRecord>; diagnostics: AbixFeedDiagnostics } {
  const recordTag = detectRecordTag(xml);
  if (!recordTag) throw new Error('ABIX feed: nepodarilo sa rozpoznať produktový element XML.');
  const re = new RegExp(`<${recordTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${recordTag}>`, 'gi');
  const prices = new Map<string, AbixPriceRecord>();
  let recordsSeen = 0, withSku = 0, withPrice = 0, duplicates = 0;
  for (const match of xml.matchAll(re)) {
    recordsSeen++;
    const row = match[1];
    const sku = tagValue(row, SKU_TAGS).trim();
    if (!sku) continue;
    withSku++;
    const net = numberValue(tagValue(row, PRICE_NET_TAGS));
    const gross = numberValue(tagValue(row, PRICE_GROSS_TAGS));
    let vat = numberValue(tagValue(row, VAT_TAGS));
    if (vat != null && vat > 1) vat /= 100;
    const purchase = net ?? (gross != null && vat != null ? gross / (1 + vat) : gross);
    if (purchase == null || purchase <= 0) continue;
    withPrice++;
    const stock = numberValue(tagValue(row, STOCK_TAGS));
    const key = sku.toLowerCase();
    if (prices.has(key)) duplicates++;
    prices.set(key, { sku, purchase_price: Math.round(purchase * 100) / 100, purchase_price_no_vat: net, vat_rate: vat, stock_quantity: stock, source: 'abix' });
  }
  return { prices, diagnostics: { records_seen: recordsSeen, records_with_sku: withSku, records_with_price: withPrice, duplicates, detected_record_tag: recordTag } };
}

export async function fetchAbixPurchasePrices(options: { url?: string; timeoutMs?: number } = {}) {
  const url = options.url || process.env.ABIX_FEED_URL || DEFAULT_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8', 'user-agent': 'ToneryMAXIM-ProductEconomics/1.2' } });
    if (!response.ok) throw new Error(`ABIX feed HTTP ${response.status}`);
    return parseAbixFeed(await response.text());
  } finally { clearTimeout(timer); }
}
