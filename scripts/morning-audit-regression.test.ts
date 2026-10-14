import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'tm-morning-audit-'));
process.env.TM_CACHE_DIR = dir;
delete process.env.TM_PERSISTENT_DATA_DIR;
process.env.OPENAI_ASSISTANT_ENABLED = '1';
process.env.OPENAI_API_KEY = 'offline-test-key-with-more-than-twenty-characters';
const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('Offline audit must not contact external services'); };
const { mapProduct, getProductsCache, getProductFromCache } = await import('../src/lib/tm-products-cache.ts');
const { analyzeCatalogQuery } = await import('../src/lib/catalog-query.ts');
const { resolveCommerceProducts } = await import('../src/lib/ai-commerce/catalog.ts');
const { searchCommerce } = await import('../src/lib/ai-commerce/engine.ts');
const { POST } = await import('../src/pages/api/ai-tomas.ts');
const { buildAssistantAnswer } = await import('../src/lib/aiSalesAssistant.ts');
const { GET: productsApi } = await import('../src/pages/api/products.ts');
const { storefrontMemoryDiagnostics } = await import('../src/lib/storefront-memory-diagnostics.ts');

function product(id: number, name: string, price: string, printers: string[], color = 'Čierna', type = 'compatible') {
  return { id, sku: `SKU-${id}`, name, slug: `product-${id}`, price, regular_price: price, stock_status: 'instock', stock_quantity: 20,
    color, capacity: '1 000 strán', compatible_printers: printers, product_type_key: type, categories: [], image: '/images/tm-product-placeholder-box.jpg',
    search_text: `${name} ${printers.join(' ')}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() };
}
const fixtures = [
  product(37637, 'HP CF230X (30X) čierny kompatibilný toner', '12.39', ['HP LaserJet Pro M203dw']),
  product(38181, 'HP CF230X (30X) čierny originálny toner', '145.16', ['HP LaserJet Pro M203dw'], 'Čierna', 'original'),
  product(52830, 'Canon CRG-045 CMYK kompatibilná sada tonerov (4 ks)', '75.20', ['Canon i-SENSYS MF635Cx'], 'CMYK'),
  product(45100, 'Canon CRG-045C azúrový kompatibilný toner', '20.73', ['Canon i-SENSYS MF635Cx'], 'Azúrová'),
  product(45101, 'Canon CRG-045BK čierny kompatibilný toner', '20.00', ['Canon i-SENSYS MF635Cx']),
  product(52989, 'Epson 102 (C13T03R140) čierna kompatibilná atramentová náplň', '4.36', ['Epson EcoTank ET-2700']),
  product(52990, 'Epson 102 (C13T03R240) azúrová kompatibilná atramentová náplň', '2.96', ['Epson EcoTank ET-2700'], 'Azúrová'),
  product(36585, 'Epson T1812XL kompatibilná atramentová náplň', '2.36', ['Epson Home XP-102'], 'Azúrová'),
  product(55010, 'Canon PFI-120BK čierna originálna atramentová náplň', '85.80', ['Canon imagePROGRAF TM-200'], 'Čierna', 'original'),
  product(55011, 'Epson T3357 (33XL) 5-farebná kompatibilná sada atramentových náplní', '11.20', ['Epson XP-530'], 'CMYK'),
  product(41401, 'Xerox 700 (006R01379) čierny originálny toner', '120.00', ['Xerox 700', 'Xerox 700I'], 'Čierna', 'original'),
  product(41434, 'Xerox 700 (013R00655) originálny optický valec', '140.00', ['Xerox 700', 'Xerox 700I'], '', 'original'),
  { ...product(53300, 'Lexmark 56F2H0E čierny kompatibilný toner', '30.00', []), capacity: '' },
  { ...product(53282, 'Kompatibilný toner pre Lexmark 56F2X0E Black 20000 strán', '299.64', []), sku: '16043', capacity: '' },
];
await writeFile(join(dir, 'products.json'), JSON.stringify({ ok: true, version: 4, runtime_compact: true, generated_at: '2026-10-14T05:07:13.231Z', total: fixtures.length, products: fixtures }));
test.after(async () => { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); });

async function ask(message: string, state: any = {}) {
  const response = await POST({ request: new Request('http://localhost/api/ai-tomas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, state, page: '/' }) }) } as any);
  assert.equal(response.status, 200, message);
  return response.json();
}
const answer = (data: any) => (data.advisor?.answer || []).join(' ');

test('natural question wrappers preserve full OEM and separate multiple OEM codes', async () => {
  for (const query of ['Máte HP CF230X?', 'Prosím HP CF230X', 'Hľadám HP CF230X']) {
    assert.deepEqual(analyzeCatalogQuery(query).referenceTokens, ['cf230x'], query);
    const result = await ask(query);
    assert.equal(result.commerce.products.length, 2, query);
    assert.ok(result.commerce.products.every((p: any) => /CF230X/.test(p.name)));
  }
  assert.deepEqual(new Set(analyzeCatalogQuery('CF230X + CF226A').referenceTokens), new Set(['cf230x', 'cf226a']));
});

test('Epson 102 ink family wins over XP-102 but explicit XP-102 remains a printer', async () => {
  const result = await ask('Hľadám Epson 102 pre Epson ET-2700');
  assert.deepEqual(new Set(result.commerce.products.map((p: any) => p.id)), new Set([52989, 52990]));
  assert.ok(result.commerce.products.every((p: any) => p.compatible_printers.includes('Epson EcoTank ET-2700')));
  const printer = await resolveCommerceProducts('Epson XP-102');
  assert.equal(printer.source, 'printer');
  assert.deepEqual(printer.products.map(p => p.id), [36585]);
});

test('exact numeric printers offer consumables while explicit drum codes and SKUs remain available', async () => {
  for (const query of ['Xerox 700', 'Xerox 700I']) {
    const result = await resolveCommerceProducts(query);
    assert.equal(result.source, 'printer', query);
    assert.deepEqual(result.products.map(p => p.id), [41401], query);
  }
  for (const query of ['013R00655', 'SKU-41434']) {
    const result = await resolveCommerceProducts(query);
    assert.equal(result.source, 'product', query);
    assert.deepEqual(result.products.map(p => p.id), [41434], query);
  }
});

test('Canon pack quote, repeat, follow-up and explicit purchase use the same real product', async () => {
  const question = 'Koľko stoja 3 ks a 4 ks kompatibilnej sady Canon CRG-045 CMYK po množstevnej zľave?';
  const first = await ask(question);
  for (const result of [first, await ask(question, first.state), await ask('A koľko stoja 3 ks a 4 ks?', first.state)]) {
    assert.match(answer(result), /3 ks: 203,04 € spolu/);
    assert.match(answer(result), /4 ks: 225,60 € spolu/);
    assert.doesNotMatch(answer(result), /62,19|azúrový kompatibilný toner/);
    assert.deepEqual(result.commerce.products.map((p: any) => p.id), [52830]);
    assert.deepEqual(result.state.cart, []);
    assert.equal(result.action, null);
    assert.equal(result.state.currentProductId, '52830');
  }
  const purchased = await ask('Pridaj 3 ks kompatibilnej sady Canon CRG-045 CMYK', first.state);
  assert.equal(purchased.action.kind, 'ADD_TO_CART');
  assert.equal(purchased.action.product.id, 52830);
  assert.deepEqual(purchased.state.cart, [{ id: '52830', sku: 'SKU-52830', quantity: 3 }]);
  const single = await ask('Koľko stoja 3 ks kompatibilného čierneho Canon CRG-045BK?', first.state);
  assert.deepEqual(single.commerce.products.map((p: any) => p.id), [45101]);
  assert.match(answer(single), /3 ks: 54,00 € spolu/);
});

test('an uncertain abbreviated HP code requests a model while a full OEM remains usable', async () => {
  const result = await ask('30X do HP, neviem model');
  assert.equal(result.action.kind, 'CLARIFY_PRINTER');
  assert.equal(result.commerce, null);
  assert.match(answer(result), /presný model.*celý OEM/i);
  assert.doesNotMatch(answer(result), /CF230X/);
  const full = await ask('HP CF230X', result.state);
  assert.equal(full.commerce.products.length, 2);
});

test('component explanation includes the waste container and known answers never wait for a model call', async () => {
  const before = externalCalls;
  const result = await ask('Aký je rozdiel medzi tonerom, optickým valcom a odpadovou nádobou?');
  assert.match(answer(result), /Toner dodáva/);
  assert.match(answer(result), /Optický valec/);
  assert.match(answer(result), /Odpadová nádoba zachytáva/);
  await ask('Aké máte možnosti dopravy a platby?');
  await ask('HP CF230X');
  assert.equal(externalCalls, before);
});

test('exact Lexmark fallback restores yield and manufacturer-listed printers without overwriting supplier data', async () => {
  const result = await ask('Máte kompatibilný Lexmark 56F2X0E?');
  assert.equal(result.commerce.products[0].capacity, '20 000 strán');
  assert.equal(result.commerce.products[0].compatible_printers.length, 11);
  assert.ok(result.commerce.products[0].compatible_printers.includes('Lexmark MS521dn'));
  assert.doesNotMatch(answer(result), /chýba.*zoznam kompatibilných tlačiarní/);
  const detail = await getProductFromCache({ id: 53282 });
  assert.equal(detail.product?.page_yield, '20 000 strán');
  const raw = { id: 53282, sku: '16043', name: fixtures.at(-1)!.name, attributes: [], images: [], categories: [], meta_data: [] };
  assert.equal(mapProduct(raw).capacity, '20 000 strán');
  assert.equal(mapProduct({ ...raw, attributes: [{ name: 'Kapacita', options: ['15 000 strán'] }] }).capacity, '15 000 strán');
  assert.equal(mapProduct({ ...raw, name: 'Lexmark toner 56F2X0E 20000-25000 strán' }).capacity, '');
  assert.equal(mapProduct({ ...raw, name: 'Epson náplň 130 ml' }).page_yield, '');
  assert.equal(mapProduct({ ...raw, name: '16043' }).capacity, '');
  assert.equal(mapProduct({ ...raw, sku: 'different' }).compatible_printers.length, 0);
  assert.deepEqual(mapProduct({ ...raw, attributes: [{ name: 'Kompatibilné tlačiarne', options: ['Lexmark MS521dn'] }] }).compatible_printers, ['Lexmark MS521dn']);
});

test('missing compatibility is disclosed for products with no verified supplier or OEM data', async () => {
  const result = await ask('Máte kompatibilný Lexmark 56F2H0E?');
  assert.deepEqual(result.commerce.products[0].compatible_printers, []);
  assert.match(answer(result), /chýba.*zoznam kompatibilných tlačiarní/);
});

test('Advisor keeps Canon PFI-120 separate from unrelated five-colour ink packs', async () => {
  const result = await buildAssistantAnswer('Môžem dostať ponuku Canon PFI-120?', '/', [{ role: 'user', content: 'Epson 604XL' }]);
  assert.ok(result.products.length > 0);
  assert.ok(result.products.every((p: any) => /Canon PFI-120/.test(p.name)));
});

test('expired one-off API and AI results are freed and byte eviction preserves responses', async () => {
  const before = await searchCommerce('HP CF230X');
  const ai: Map<string, any> = (globalThis as any).__TM_AI_COMMERCE_SEARCH_CACHE__;
  ai.set('expired-one-off', { value: {}, bytes: 1024, expires: Date.now() - 1 });
  ai.set('large-one-off', { value: {}, bytes: 8 * 1024 * 1024, expires: Date.now() + 300_000 });
  const after = await searchCommerce('Canon CRG-045');
  assert.ok(after.products.length);
  assert.equal(ai.has('expired-one-off'), false);
  assert.ok(storefrontMemoryDiagnostics().aiCommerceCacheJsonBytes <= 8 * 1024 * 1024);
  assert.deepEqual((await searchCommerce('HP CF230X')).products, before.products);
  const api: Map<string, any> = (globalThis as any).__TM_PRODUCTS_API_RESULT_CACHE__;
  api.set('expired-one-off', { body: '{}', bytes: 2, expiresAt: Date.now() - 1 });
  api.set('large-one-off', { body: '{}', bytes: 8 * 1024 * 1024, expiresAt: Date.now() + 60_000 });
  const response = await productsApi({ url: new URL('http://localhost/api/products?search=CF230X') } as any);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.products.length, 2);
  assert.equal(api.has('expired-one-off'), false);
  assert.ok(storefrontMemoryDiagnostics().productApiCacheBytes <= 8 * 1024 * 1024);
  assert.equal(api.has('large-one-off'), false);
  assert.equal((await getProductsCache()).total, fixtures.length);
});
