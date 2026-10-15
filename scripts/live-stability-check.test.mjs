import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLiveStability } from './verify-live-stability.mjs';

function fixture(overrides = {}) {
  const requests = [];
  const memory = { ok: true, checks: { rssMb: 300, heapMb: 130, memoryLimitConfigured: true }, diagnostics: {
    catalogProducts: 7900, catalogGeneratedAt: new Date(Date.now() - 3600000).toISOString(), productApiCacheEntries: 30,
    productApiCacheBytes: 120000, productApiCacheByteLimit: 8388608, aiCommerceCacheEntries: 5,
    aiCommerceCacheJsonBytes: 100000, aiCommerceCacheJsonByteLimit: 8388608, lastSync: { status: 'refreshed' },
  } };
  return { requests, memory, async fetchImpl(url, options) {
    const path = url.pathname; requests.push({ path, options });
    if (overrides[path]) return overrides[path](url, options, memory);
    const data = path === '/api/health' ? { ok: true }
      : path === '/api/storefront-check' ? memory
      : path === '/api/products' ? { ok: true, products: [{ id: 1, name: 'HP CF230X toner', price: 12.39 }] }
      : path === '/api/smart-search' ? { ok: true, products: [{ title: 'HP 205A CMYK kompatibilná sada tonerov' }] }
      : path === '/api/printers' ? { ok: true, printers: [{ title: 'Samsung ML-2165', aliases: ['Samsung ML-2165W'] }] }
      : path === '/api/product' ? { ok: true, product: { id: 52830, name: 'Canon CRG-045 CMYK sada', price: 75.2 } }
      : path === '/api/ai-tomas' ? { ok: true, advisor: { answer: ['3 ks: 203,04 €; 4 ks: 225,60 €'] }, commerce: { products: [{ id: 52830 }] }, state: { cart: [] }, action: null }
      : null;
    if (data) return Response.json(data);
    if (path === '/') return new Response('<h1>Shop</h1>');
    if (path === '/pokladna') return new Response('<div data-checkout-form hidden></div>');
    if (['/api/order-create', '/api/gopay-create'].includes(path)) {
      assert.deepEqual(JSON.parse(options.body), { cart: [], termsAccepted: false });
      return Response.json({ ok: false }, { status: 400 });
    }
    if (path === '/__tm_stability_missing_page__') return new Response('Missing', { status: 404 });
    throw new Error('Unexpected request: ' + path);
  } };
}

test('live check verifies real responses and sends only empty carts to order/payment APIs', async () => {
  const f = fixture(), result = await verifyLiveStability({ fetchImpl: f.fetchImpl });
  assert.equal(result.ok, true); assert.equal(result.checks.length, 12);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(f.requests.filter(r => r.options.method === 'POST').map(r => r.path), ['/api/order-create', '/api/gopay-create', '/api/ai-tomas']);
});

test('live check loads the catalogue before inspecting diagnostics on a cold process', async () => {
  let loaded = false;
  const f = fixture({
    '/api/products': () => { loaded = true; return Response.json({ ok: true, products: [{ name: 'HP CF230X', price: 12.39 }] }); },
    '/api/storefront-check': (_url, _options, memory) => Response.json({ ...memory,
      diagnostics: { ...memory.diagnostics, catalogProducts: loaded ? 7900 : null, catalogGeneratedAt: loaded ? memory.diagnostics.catalogGeneratedAt : null } }),
  });
  const result = await verifyLiveStability({ fetchImpl: f.fetchImpl });
  assert.equal(result.ok, true);
  assert.ok(f.requests.findIndex(r => r.path === '/api/products') < f.requests.findIndex(r => r.path === '/api/storefront-check'));
});

test('missing aliases, stale import and visible empty checkout fail the live check', async () => {
  const f = fixture({
    '/api/printers': () => Response.json({ ok: true, printers: [] }),
    '/pokladna': () => new Response('<div data-checkout-form></div>'),
    '/api/storefront-check': (_url, _options, memory) => {
      memory.diagnostics.catalogGeneratedAt = new Date(Date.now() - 31 * 3600000).toISOString();
      return Response.json(memory);
    },
  });
  const result = await verifyLiveStability({ fetchImpl: f.fetchImpl });
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.filter(c => !c.ok).map(c => c.name), ['Memory and catalogue', 'Printer variant alias', 'Empty checkout']);
});

test('wrong AI pack arithmetic fails and missing container limits are reported explicitly', async () => {
  const f = fixture({
    '/api/storefront-check': (_url, _options, memory) => { memory.checks.memoryLimitConfigured = false; return Response.json(memory); },
    '/api/ai-tomas': () => Response.json({ ok: true, advisor: { answer: ['62,19 €'] }, commerce: { products: [{ id: 52830 }] }, state: { cart: [] } }),
  });
  const result = await verifyLiveStability({ fetchImpl: f.fetchImpl });
  assert.equal(result.ok, false); assert.ok(result.warnings.some(w => /memory limit/.test(w)));
  assert.equal(result.checks.find(c => c.name === 'AI pack calculation').ok, false);
});
