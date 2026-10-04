import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('three real sync cycles plus failed import retain catalogue and bounded diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tm-memory-sync-'));
  process.env.TM_PERSISTENT_DATA_DIR = dir;
  process.env.TM_CACHE_DIR = dir;
  process.env.WOO_URL = 'https://example.invalid';
  process.env.WOO_CONSUMER_KEY = 'test';
  process.env.WOO_CONSUMER_SECRET = 'test';
  process.env.WOO_SYNC_MIN_PRODUCTS = '1';
  process.env.WOO_SYNC_EXPECTED_MIN_PRODUCTS = '1';
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let fail = false;
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (!url.includes('/wp-json/wc/v3/products?')) throw new Error(`Unexpected external request: ${url}`);
    calls++;
    if (fail) return new Response('denied', {status:403});
    return Response.json(Array.from({length:100},(_,i)=>({id:i+1,name:`HP CF226A toner ${i}`,slug:`hp-test-${i}`,sku:`TEST${i}`,price:'17.88',regular_price:'17.88',status:'publish',stock_status:'instock',stock_quantity:20,attributes:[],categories:[],images:[]})), {headers:{'x-wp-total':'100','x-wp-totalpages':'1'}});
  };
  try {
    const {syncProductsCache} = await import('../src/lib/tm-products-cache.ts');
    const {storefrontMemoryDiagnostics} = await import('../src/lib/storefront-memory-diagnostics.ts');
    for(let i=0;i<3;i++) {
      const [a,b] = await Promise.all([syncProductsCache({force:true}),syncProductsCache({force:true})]);
      assert.strictEqual(a,b);
      assert.equal(a.refreshed,true);
      assert.equal(a.cache.products.length,100);
      assert.equal(calls,i+1);
      const metrics=storefrontMemoryDiagnostics();
      assert.equal(metrics.lastSync?.status,'refreshed');
      assert.equal(metrics.syncRunning,false);
      assert.equal(metrics.catalogProducts,100);
      assert.ok(metrics.lastSync?.after?.rss);
    }
    fail=true;
    const fallback = await syncProductsCache({force:true});
    assert.equal(fallback.refreshed,false);
    assert.equal(fallback.cache.products.length,100);
    assert.equal(storefrontMemoryDiagnostics().lastSync?.status,'retained-old');
  } finally { globalThis.fetch=originalFetch; await rm(dir,{recursive:true,force:true}); }
});
