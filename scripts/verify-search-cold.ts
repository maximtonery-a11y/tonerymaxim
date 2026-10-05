// Fresh-process, GET-only benchmark. Supply the same catalog snapshot for comparisons.
// TM_SEARCH_CATALOG=/path/catalog.json node --experimental-strip-types scripts/verify-search-cold.ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
if (!process.env.TM_SEARCH_CATALOG) throw new Error('Set TM_SEARCH_CATALOG');
const cache = JSON.parse(await readFile(process.env.TM_SEARCH_CATALOG, 'utf8'));
const { normalize } = await import('../src/lib/tm-products-cache.ts');
for (const p of cache.products) p.search_text = normalize([p.name, p.sku, p.slug, p.product_type_label, p.color,
  p.capacity, p.warranty, ...(p.categories || []).map((c: any) => c.name), ...(p.compatible_printers || [])].filter(Boolean).join(' '));
const state = globalThis as any;
assert.equal(state.__TM_SMART_SEARCH_INDEX__, undefined, 'Run in a fresh Node process');
state.__TM_PRODUCTS_FILE_CACHE__ = cache;
const { GET } = await import('../src/pages/api/smart-search.ts');
const queries = ['CF53', 'TN2421', 'M1132'];
let last = performance.now(), maxLag = 0;
const heartbeat = setInterval(() => { const now = performance.now(); maxLag = Math.max(maxLag, now - last - 10); last = now; }, 10);
async function request(q: string) {
  const start = performance.now();
  const response = await GET({ url: new URL(`http://localhost/api/smart-search?q=${q}`) } as any);
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.ok, true); assert.ok(data.products.length > 0);
  return { query: q, ms: Math.round(performance.now() - start), ids: data.products.map((p: any) => p.id) };
}
try {
  const cold = await Promise.all(queries.map(request));
  const index = state.__TM_SMART_SEARCH_INDEX__;
  assert.equal(index.generatedAt, cache.generated_at);
  const warm = await Promise.all(queries.map(request));
  assert.equal(state.__TM_SMART_SEARCH_INDEX__, index, 'Warm requests must reuse the index');
  assert.deepEqual(warm.map(r => r.ids), cold.map(r => r.ids));
  console.log(JSON.stringify({ products: cache.products.length, generatedAt: cache.generated_at, cold, warm,
    maxEventLoopLagMs: Math.round(maxLag), rssMb: Math.round(process.memoryUsage().rss / 1048576) }));
} finally { clearInterval(heartbeat); }
