import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCatalogQuery, partialProductCodeMatch, findExactProductIdentityMatches } from '../src/lib/catalog-query.ts';
import { filterProducts, normalize } from '../src/lib/tm-products-cache.ts';

const products = ['530', '531', '532', '533'].flatMap((number, color) =>
  ['compatible', 'original', 'renovated'].map((type, variant) => ({
    id: color * 3 + variant + 1, name: `HP CF${number}A toner ${type}`, sku: `CF${number}A-${type}`,
    product_type_key: type, stock_status: 'instock', compatible_printers: ['HP Color LaserJet Pro M180n'],
    search_text: normalize(`HP CF${number}A toner ${type} HP Color LaserJet Pro M180n`),
  })),
);

for (const query of ['CF53', 'cf53', 'HP CF53', 'CF-53', 'CF 53', 'CF530']) {
  test(`unfinished OEM ${query} finds the matching products`, () => {
    const found = filterProducts(products, { search: query });
    assert.equal(found.length, query === 'CF530' ? 3 : 12);
  });
}
test('prefix results retain explicit product type filters', () => {
  for (const type of ['compatible', 'original', 'renovated']) {
    const found = filterProducts(products, { search: 'CF53', type });
    assert.equal(found.length, 4);
    assert.ok(found.every(p => p.product_type_key === type));
  }
});
test('full OEM never widens to other colours or unknown suffixes', () => {
  assert.deepEqual(filterProducts(products, { search: 'CF530A' }).map(p => p.id), [1, 2, 3]);
  assert.equal(filterProducts(products, { search: 'CF530B' }).length, 0);
  assert.equal(filterProducts(products, { search: 'Canon CF53' }).length, 0);
  assert.equal(filterProducts(products, { search: 'CF53999' }).length, 0);
});
test('an existing exact code takes precedence over longer codes', () => {
  const exact = { ...products[0], id: 100, name: 'HP CF53 toner', sku: 'CF53', search_text: 'hp cf53 toner' };
  assert.deepEqual(filterProducts([...products, exact], { search: 'CF53' }).map(p => p.id), [100]);
});
test('prefix fallback does not weaken exact identity purchase matching', () => {
  assert.equal(findExactProductIdentityMatches(products, 'CF53').length, 0);
  assert.equal(partialProductCodeMatch({ name: 'HP CE285A', compatible_printers: ['HP CF530A'], slug: 'old-cf530a' }, analyzeCatalogQuery('CF53')), false);
});
test('special chip variants are excluded from prefix browsing', () => {
  const special = ['bez čipu', 's OEM čipom', 'Hatona'].map((label, i) => ({
    ...products[0], id: 101 + i, name: `HP CF530A ${label}`, search_text: normalize(`HP CF530A ${label}`),
  }));
  assert.deepEqual(filterProducts([...products, ...special], { search: 'CF53' }).map(p => p.id), filterProducts(products, { search: 'CF53' }).map(p => p.id));
});
test('Brother TN-B023 keeps its full compound OEM identity', () => {
  const toner = { id: 200, name: 'Brother TN-B023 kompatibilný toner', sku: '15082', product_type_key: 'compatible', search_text: 'brother tn-b023 kompatibilny toner' };
  for (const query of ['TN-B023', 'TNB023', 'Brother TN-B023', 'tn b023']) {
    assert.deepEqual(filterProducts([toner, ...products], { search: query }).map(p => p.id), [200]);
    assert.equal(findExactProductIdentityMatches([toner], query).length, 1);
  }
});
