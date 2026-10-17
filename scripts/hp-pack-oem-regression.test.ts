import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filterProducts, normalize, isSpecialChipVariantProduct } from '../src/lib/tm-products-cache.ts';
const packs = JSON.parse(fs.readFileSync(new URL('./fixtures/hp-pack-oem-158.json', import.meta.url), 'utf8'))
  .map((p: any) => ({ ...p, search_text: normalize(`${p.name} ${p.sku}`) }));
test('all 158 HP packs are found through every explicit component OEM, without relying on abbreviated titles', () => {
  let checked = 0;
  for (const pack of packs) {
    const variant = /Hatona/i.test(pack.name) ? ' Hatona' : /bez čipu/i.test(pack.name) ? ' bez čipu'
      : /OEM čip/i.test(pack.name) ? ' s OEM čipom' : '';
    for (const oem of pack.attributes[0].values) {
      const found = filterProducts(packs, { search: oem + variant });
      assert.ok(found.some((p: any) => p.id === pack.id), `${pack.id}: ${oem}${variant}`);
      checked++;
    }
  }
  assert.ok(checked >= 632);
});
test('CF531 and CF531A find the real 205A pack; another family and printer prose do not', () => {
  for (const code of ['CF530', 'CF531', 'CF532', 'CF533', 'CF531A']) {
    const found = filterProducts(packs, { search: code });
    assert.ok(found.some((p: any) => p.id === 52649), code);
    assert.ok(!found.some((p: any) => p.id === 52650), code);
    assert.ok(found.every((p: any) => !isSpecialChipVariantProduct(p)));
  }
  const fake = { id: -1, name: 'HP toner', sku: 'unrelated', slug: 'unrelated', price: 10,
    product_type_key: 'compatible', stock_status: 'instock', search_text: 'hp toner cf531a',
    attributes: [{ name: 'Poznámka', values: ['CF531A'] }], description: 'CF531A' };
  assert.ok(!filterProducts([...packs, fake], { search: 'CF531A' }).some((p: any) => p.id === -1));
});

test('CF383A stays with compatible products before originals and renovations, including autocomplete', async () => {
  const products = [
    { id: 43956, name: 'HP CF383A purpurový kompatibilný toner', product_type_key: 'compatible' },
    { id: 40360, name: 'HP CF383A (312A) purpurový originálny toner', product_type_key: 'original' },
    { id: 38858, name: 'HP CF383A (312A) purpurový renovovaný toner Patent Free', product_type_key: 'renovated' },
  ].map(p => ({ ...p, sku: String(p.id), slug: String(p.id), price: 20, stock_status: 'instock',
    search_text: normalize(p.name), compatible_printers: ['HP Color LaserJet Pro MFP M476dn'] }));
  assert.deepEqual(filterProducts(products, { search: 'CF383A' }).map(p => p.id), [43956, 40360, 38858]);
  assert.deepEqual(filterProducts(products, { search: 'M476dn' }).map(p => p.id), [43956, 40360, 38858]);
  (globalThis as any).__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4,
    generated_at: 'hp-pack-type-regression', total: products.length, products };
  const { GET: smartGet } = await import('../src/pages/api/smart-search.ts');
  const data = await (await smartGet({ url: new URL('http://localhost/api/smart-search?q=CF383A') } as any)).json() as any;
  assert.deepEqual(data.products.map((p: any) => p.id), [43956, 40360, 38858]);
});

test('abbreviated CF530 pack remains searchable in the previous compact cache before its first refresh', () => {
  const pack = packs.find((p: any) => p.id === 52649);
  const compact = { ...pack, attributes: undefined, attributes_all: undefined, oem_codes: undefined };
  for (const code of ['CF530A', 'CF531A', 'CF532A', 'CF533A']) {
    assert.ok(filterProducts([compact], { search: code }).some((p: any) => p.id === 52649), code);
  }
  assert.equal(filterProducts([compact], { search: 'CF541A' }).length, 0);
});
