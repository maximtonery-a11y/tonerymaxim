import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, normalize } from '../src/lib/tm-products-cache.ts';
const products = [
  { id: 1, name: 'Canon CRG-069H čierny kompatibilný toner', sku: 'single-069h' },
  { id: 2, name: 'Canon CRG-069H CMYK kompatibilná sada tonerov (4 ks)', sku: 'set-069h' },
  { id: 3, name: 'Canon CRG-069H azúrový kompatibilný toner', sku: 'cyan-069h' },
  { id: 4, name: 'HP CF530A (205A) čierny kompatibilný toner', sku: 'single-530a' },
  { id: 5, name: 'HP CF530A CF531A CF532A CF533A CMYK kompatibilná sada tonerov', sku: 'set-205a' },
  { id: 6, name: 'Brother TN-248XL čierny kompatibilný toner', sku: 'single-248xl' },
  { id: 7, name: 'Brother TN-248XL CMYK kompatibilná sada tonerov', sku: 'set-248xl' },
  { id: 8, name: 'HP 205A CMYK kompatibilná sada tonerov', sku: 'pack-205a' },
  { id: 9, name: 'HP 205A CMYK sada pre inú tlačiareň', sku: 'wrong-printer' },
  { id: 10, name: 'Canon 205A CMYK sada', sku: 'wrong-brand' },
].map(p => ({ ...p, slug: p.sku, product_type_key: 'compatible', price: 20, stock_status: 'instock', stock_quantity: 10,
  categories: [{ name: 'Tonery', slug: 'tonery' }], compatible_printers: [4, 8, 10].includes(p.id) ? ['HP Color LaserJet Pro M180n'] : p.id === 9 ? ['HP Color LaserJet Pro M280nw'] : [], search_text: normalize(p.name + ' ' + p.sku) }));
(globalThis as any).__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, generated_at: new Date().toISOString(), total: products.length, products };
const { GET: smartGet } = await import('../src/pages/api/smart-search.ts');
const { GET: productsGet } = await import('../src/pages/api/products.ts');
for (const [query, firstId] of [['Canon CRG-069H', 2], ['Brother TN-248XL', 7], ['CF53', 5], ['CF530A', 4], ['HP 205A', 8], ['Canon CRG-069H čierny', 1]] as const) {
  test(`${query}: matching packs first, precise single cartridge intent preserved`, async () => {
    assert.equal(filterProducts(products, { search: query })[0]?.id, firstId);
    const list = await (await productsGet({ url: new URL('http://localhost/api/products?search=' + encodeURIComponent(query)) } as any)).json() as any;
    assert.equal(list.products[0]?.id, firstId);
    const smart = await (await smartGet({ url: new URL('http://localhost/api/smart-search?q=' + encodeURIComponent(query)) } as any)).json() as any;
    assert.equal(smart.products[0]?.id, firstId);
  });
}

test('CF53 also finds the named 205A pack, only with matching brand and printer', async () => {
  for (const get of [productsGet, smartGet]) {
    const isSmart = get === smartGet;
    const response = await get({ url: new URL('http://localhost' + (isSmart ? '/api/smart-search?q=' : '/api/products?search=') + 'CF53') } as any);
    const data = await response.json() as any;
    const ids = data.products.map((p: any) => p.id);
    assert.ok(ids.includes(8));
    assert.ok(ids.indexOf(8) < ids.indexOf(4));
    assert.ok(!ids.includes(9));
    assert.ok(!ids.includes(10));
  }
});
