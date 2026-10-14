import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = await mkdtemp(join(tmpdir(), 'tm-generation-race-'));
Object.assign(process.env, { TM_CACHE_DIR: dir, WOO_URL: 'https://example.invalid', WOO_CONSUMER_KEY: 'test', WOO_CONSUMER_SECRET: 'test',
  WOO_SYNC_MIN_PRODUCTS: '1', WOO_SYNC_EXPECTED_MIN_PRODUCTS: '1', TM_DISABLE_INDEXNOW: '1', WOO_CACHE_FILE_STAT_INTERVAL_MS: '60000' });
delete process.env.TM_PERSISTENT_DATA_DIR;
const originalFetch = globalThis.fetch;
const originalOpen = fs.open;
let generation = 1;
const raw = (id: number) => ({ id, sku: `CF230X-${id}`, name: `HP CF230X čierny kompatibilný toner ${id}`, slug: `hp-cf230x-${id}`,
  price: generation === 1 ? '17.50' : '25.90', regular_price: '25.90', stock_status: 'instock', stock_quantity: 20,
  description: `<p>Úplný opis GEN${generation} výrobku ${id} 漢字 🖨️</p>`, short_description: '<p>Krátky opis</p>', categories: [], images: [], meta_data: [],
  attributes: [{ name: 'Generácia detailu', options: [`GEN${generation}`] }, { name: 'Kompatibilné tlačiarne', options: ['HP LaserJet Pro M203dw'] }] });
globalThis.fetch = async () => Response.json(generation === 1 ? [raw(1), raw(2)] : [raw(1), raw(3)], { headers: { 'x-wp-total': '2', 'x-wp-totalpages': '1' } });
const { syncProductsCache, getProductFromCache, getProductsCache } = await import('../src/lib/tm-products-cache.ts');
const { createProductCacheWriter } = await import('../src/lib/product-cache-writer.ts');
test.after(async () => { fs.open = originalOpen; syncBuiltinESMExports(); globalThis.fetch = originalFetch; await rm(dir, { recursive:true, force:true }); });

function pauseReads(file: string, expected: number) {
  let entered = 0;
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>(r => release = r), started = new Promise<void>(r => ready = r);
  fs.open = (async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === file && args[1] === 'r') { entered++; if (entered === expected) ready(); await gate; }
    return originalOpen(...args);
  }) as typeof fs.open;
  syncBuiltinESMExports();
  return { started, release, restore: () => { fs.open = originalOpen; syncBuiltinESMExports(); } };
}

test('readers delayed across a real import recover full details, fresh price and removal from one generation', async () => {
  const first = await syncProductsCache({ force:true });
  const oldFile = join(dir, first.cache.details_file!);
  const gate = pauseReads(oldFile, 2);
  const surviving = getProductFromCache({ id:1 }), removed = getProductFromCache({ id:2 });
  try {
    await gate.started; generation = 2;
    const next = await syncProductsCache({ force:true });
    await assert.rejects(stat(oldFile), { code:'ENOENT' });
    gate.release();
    const a = await surviving, b = await removed;
    assert.equal(a.cache.generated_at, next.cache.generated_at);
    assert.equal(Number(a.product?.price), 25.90);
    assert.match(a.product?.description_html, /GEN2.*漢字 🖨️/);
    assert.ok(a.product?.attributes.some((attribute:any) => attribute.options.includes('GEN2')));
    assert.equal(b.cache.generated_at, next.cache.generated_at);
    assert.equal(b.product, null, 'A removed product must not survive a retry');
  } finally { gate.release(); await Promise.allSettled([surviving, removed]); gate.restore(); }
});

test('a second process publishing a cache forces a fresh coherent lookup; a genuinely missing file stays recoverable', async () => {
  const previous = await getProductsCache();
  (globalThis as any).__TM_PRODUCT_DETAILS_CACHE__?.clear();
  const oldFile = join(dir, previous.details_file!);
  const gate = pauseReads(oldFile, 1), pending = getProductFromCache({ id:1 });
  const writer = await createProductCacheWriter(dir, join(dir,'products.json'));
  try {
    await gate.started;
    const location = await writer.appendDetail({ description_html:'<p>Externá generácia GEN3 漢字</p>', short_description_html:'', attributes:[{ name:'Generácia detailu',options:['GEN3'] }] });
    const originalProduct = previous.products.find(p=>p.id===1);
    assert.ok(originalProduct);
    const product = { ...originalProduct, price:'42.00', ...location };
    const generated_at = new Date(Date.now()+1000).toISOString();
    await writer.publish({ ok:true,version:4,runtime_compact:true,total:1,generated_at,details_file:writer.detailsFile },[product]);
    await rm(oldFile);
    gate.release();
    const result = await pending;
    assert.equal(result.cache.generated_at, generated_at);
    assert.equal(result.product?.price,'42.00');
    assert.match(result.product?.description_html,/GEN3/);
    assert.deepEqual(result.product?.attributes,[{ name:'Generácia detailu',options:['GEN3'] }]);
    (globalThis as any).__TM_PRODUCT_DETAILS_CACHE__?.clear();
    await rm(join(dir,writer.detailsFile));
    const fallback = await getProductFromCache({ id:1 });
    assert.equal(fallback.cache.generated_at,generated_at);
    assert.equal(fallback.product?.price,'42.00');
    assert.equal(fallback.product?.name,originalProduct.name);
  } finally { gate.release(); await Promise.allSettled([pending]); gate.restore(); await writer.discard(); }
});
