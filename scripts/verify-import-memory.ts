// Offline, two-generation import benchmark. No production services are called.
// node --expose-gc --experimental-strip-types scripts/verify-import-memory.ts [repo-root]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(process.argv[2] || process.cwd());
const directory = await mkdtemp(join(tmpdir(), 'tm-import-bench-'));
Object.assign(process.env, { TM_CACHE_DIR: directory, WOO_URL: 'https://example.invalid', WOO_CONSUMER_KEY: 'test', WOO_CONSUMER_SECRET: 'test',
  WOO_SYNC_MIN_PRODUCTS: '1', WOO_SYNC_EXPECTED_MIN_PRODUCTS: '1', WOO_SYNC_PAGE_DELAY_MS: '120', TM_DISABLE_INDEXNOW: '1' });
delete process.env.TM_PERSISTENT_DATA_DIR;
const count = 2_500;
let generation = 1;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://example.invalid');
  const page = Number(url.searchParams.get('page'));
  const products = Array.from({ length: 100 }, (_, offset) => {
    const id = (page - 1) * 100 + offset + 1;
    return { id, sku: `CF${100000 + id}A`, name: `HP CF${100000 + id}A čierny kompatibilný toner`, slug: `hp-bench-${id}`,
      price: String(10 + generation), regular_price: String(10 + generation), stock_status: 'instock', stock_quantity: id,
      date_modified: '2026-10-13T07:00:00', date_modified_gmt: '2026-10-13T05:00:00',
      description: `<p>${id} ${'Úplný technický opis a kompatibilita výrobku. '.repeat(500)}</p>`,
      short_description: `<p>Krátky opis ${id}</p>`, categories: [], images: [], meta_data: [],
      attributes: [ { id: 1, name: 'Kapacita', options: ['3 100 strán'] },
        { id: 2, name: 'Kompatibilné tlačiarne', options: Array.from({ length: 20 }, (_, n) => `HP LaserJet M${1000 + n}`) },
        ...Array.from({ length: 8 }, (_, n) => ({ id: n + 3, name: `Technický parameter ${n}`, options: [`${id}-${n} ${'Úplný parameter '.repeat(100)}`] })) ],
    };
  });
  return Response.json(products, { headers: { 'x-wp-total': String(count), 'x-wp-totalpages': '25' } });
};
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
try {
  const { syncProductsCache, getProductsCache, getProductFromCache } = await import(pathToFileURL(join(root, 'src/lib/tm-products-cache.ts')).href);
  const durations = [];
  for (generation = 1; generation <= 2; generation++) {
    const start = performance.now();
    await syncProductsCache({ force: true });
    durations.push(Math.round(performance.now() - start));
    (globalThis as any).gc?.();
  }
  const memory = process.memoryUsage();
  const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  const cache = await getProductsCache();
  const runtime = cache.products.map(({ _detail_offset, _detail_length, ...product }: any) => canonical(product));
  const hash = createHash('sha256').update(JSON.stringify(runtime));
  for (const id of [1, 100, 501, 1250, 2500]) {
    const { product } = await getProductFromCache({ id });
    assert.ok(product && product.description_html && product.attributes.length >= 10);
    hash.update(JSON.stringify(canonical({ description_html: product.description_html, short_description_html: product.short_description_html, attributes: product.attributes })));
  }
  console.log(JSON.stringify({ products: cache.total, generations: 2, durationsMs: durations, peakRssMb,
    rssMb: Math.round(memory.rss / 1048576), heapMb: Math.round(memory.heapUsed / 1048576), dataSha256: hash.digest('hex') }));
} finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
