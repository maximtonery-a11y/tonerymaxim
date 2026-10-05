import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalize } from '../src/lib/tm-products-cache.ts';
const cache = JSON.parse(await readFile(process.env.TM_SEARCH_CATALOG!, 'utf8'));
for (const p of cache.products) p.search_text = normalize([p.name,p.sku,p.slug,p.color,...(p.compatible_printers || [])].join(' '));
(globalThis as any).__TM_PRODUCTS_FILE_CACHE__ = cache;
const { GET: listGet } = await import('../src/pages/api/products.ts');
const { GET: smartGet } = await import('../src/pages/api/smart-search.ts');
const cases = [
  { q: 'CF53', first: 52649, packs: [52649,52693], total: 14 },
  { q: 'HP 205A', first: 52649, packs: [52649,52693] },
  { q: 'Canon CRG-069H', first: 52852, packs: [52852] },
  { q: 'Brother TN-248XL', first: 51893, packs: [51893,51923] },
  { q: 'CF530A', first: 37640, total: 3 },
  { q: 'Brother TN-B023', first: 37466 },
];
for (const item of cases) {
  for (const [path, handler] of [['/api/products?per_page=96&search=',listGet],['/api/smart-search?q=',smartGet]] as const) {
    const data = await (await handler({ url: new URL('http://localhost'+path+encodeURIComponent(item.q)) } as any)).json() as any;
    assert.equal(data.ok,true);
    assert.equal(data.products[0]?.id,item.first,`${path} ${item.q}`);
    if (item.packs) assert.deepEqual(data.products.slice(0,item.packs.length).map((p:any)=>p.id),item.packs,`${path} ${item.q} packs`);
    if (path.startsWith('/api/products') && item.total) assert.equal(data.total,item.total,item.q);
    console.log('PASS',path,item.q,data.total ?? data.products.length,data.products.slice(0,2).map((p:any)=>p.name || p.title));
  }
}
