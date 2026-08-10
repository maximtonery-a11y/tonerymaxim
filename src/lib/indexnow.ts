const INDEXNOW_KEY = 'b644885797ef9b9be11adeb1873d7a12';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const SITE_ORIGIN = 'https://www.tonerymaxim.sk';
const MAX_SUBMITTED_URLS = 9500;
const CHUNK_SIZE = 1000;

type Product = Record<string, any>;

export type IndexNowResult = {
  attempted: number;
  accepted: number;
  status: 'skipped' | 'accepted' | 'partial' | 'failed';
  error?: string;
};

function productKey(product: Product): string {
  return String(product.id || product.slug || product.sku || '').trim();
}

function productSignature(product: Product): string {
  return [
    product.slug,
    product.date_modified_gmt || product.date_modified,
    product.price,
    product.regular_price,
    product.sale_price,
    product.stock_status,
    product.stock_quantity,
    product.image,
  ].map((value) => String(value ?? '')).join('|');
}

function productUrl(product: Product): string {
  const slug = String(product.slug || '').trim();
  return slug ? `${SITE_ORIGIN}/produkt/${encodeURIComponent(slug)}` : '';
}

function brandSlug(value: unknown): string {
  const key = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' a ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const aliases: Record<string, string> = {
    'hewlett-packard': 'hp', 'konica-minolta': 'konica-minolta',
  };
  return aliases[key] || key;
}

function productBrand(product: Product): string {
  const direct = product.product_brand || product.manufacturer_brand;
  if (direct) return brandSlug(direct);
  const taxonomy = Array.isArray(product.brands) ? product.brands.find((item: any) => item?.name)?.name : '';
  return brandSlug(taxonomy);
}

function changedUrls(previous: Product[], current: Product[]): string[] {
  const before = new Map<string, Product>();
  const after = new Map<string, Product>();
  for (const product of previous) {
    const key = productKey(product);
    if (key) before.set(key, product);
  }
  for (const product of current) {
    const key = productKey(product);
    if (key) after.set(key, product);
  }
  const changed: Product[] = [];
  const urls = new Set<string>();

  for (const [key, product] of after) {
    const old = before.get(key);
    if (!old || productSignature(old) !== productSignature(product)) changed.push(product);
  }
  for (const [key, product] of before) {
    if (!after.has(key)) {
      const url = productUrl(product);
      if (url) urls.add(url);
    }
  }
  if (!changed.length && !urls.size) return [];

  [
    '/', '/produkty', '/tonery', '/atramentove-naplne', '/kompatibilne-tonery',
    '/originalne-tonery', '/renovovane-tonery', '/tlaciarne', '/znacky',
  ].forEach((path) => urls.add(`${SITE_ORIGIN}${path}`));

  for (const product of changed) {
    const url = productUrl(product);
    if (url) urls.add(url);
    const brand = productBrand(product);
    if (brand) {
      urls.add(`${SITE_ORIGIN}/znacky/${brand}`);
      urls.add(`${SITE_ORIGIN}/tlaciarne/${brand}`);
    }
  }
  return [...urls].slice(0, MAX_SUBMITTED_URLS);
}

async function submitChunk(urlList: string[]): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: 'www.tonerymaxim.sk',
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
      signal: controller.signal,
    });
    return response.ok || response.status === 202;
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyIndexNowAfterProductSync(previous: Product[], current: Product[]): Promise<IndexNowResult> {
  const urls = changedUrls(previous, current);
  if (!urls.length) return { attempted: 0, accepted: 0, status: 'skipped' };

  let accepted = 0;
  let failed = false;
  let error = '';
  for (let index = 0; index < urls.length; index += CHUNK_SIZE) {
    const chunk = urls.slice(index, index + CHUNK_SIZE);
    try {
      if (await submitChunk(chunk)) accepted += chunk.length;
      else failed = true;
    } catch (cause: any) {
      failed = true;
      error = String(cause?.message || cause || 'IndexNow request failed').slice(0, 300);
    }
  }
  return {
    attempted: urls.length,
    accepted,
    status: !failed ? 'accepted' : accepted ? 'partial' : 'failed',
    ...(error ? { error } : {}),
  };
}
