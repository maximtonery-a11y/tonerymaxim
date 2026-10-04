import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedMissCache } from '../src/lib/bounded-miss-cache.ts';
import { findPrinterEntity, printerEntities } from '../src/lib/seo-catalog.ts';
import { beginCatalogSync, finishCatalogSync, storefrontMemoryDiagnostics } from '../src/lib/storefront-memory-diagnostics.ts';
import { GET } from '../src/pages/api/storefront-check.ts';

const catalog = () => [{ id: 1, slug: 'hp-test', name: 'HP W1420A toner', price: 10, stock_status: 'instock', stock_quantity: 10, product_type_key: 'compatible', compatible_printers: ['HP LaserJet M110w'] }];

test('negative cache stays bounded under 100000 distinct misses', () => {
  const products: any[] = [];
  for (let i = 0; i < 100_000; i++) assert.equal(findPrinterEntity(products, 'hp', `missing-${i}`), null);
  assert.equal(storefrontMemoryDiagnostics().printerNegativeEntries, 512);
  assert.equal(storefrontMemoryDiagnostics().printerPositiveEntries, 0);
});
test('miss flood never evicts a successful printer result', () => {
  const products = catalog();
  const first = findPrinterEntity(products, 'hp', 'hp-laserjet-m110w');
  assert.ok(first);
  for (let i = 0; i < 2000; i++) findPrinterEntity(products, 'hp', `missing-${i}`);
  assert.strictEqual(findPrinterEntity(products, 'hp', 'hp-laserjet-m110w'), first);
  assert.deepEqual(first.products.map(p => p.id), [1]);
});
test('TTL expires without refreshing on reads; LRU evicts oldest', () => {
  let now = 0;
  const cache = new BoundedMissCache(2, 100, () => now);
  cache.add('a'); cache.add('b');
  assert.equal(cache.has('a'), true);
  cache.add('c');
  assert.equal(cache.has('b'), false);
  now = 99; assert.equal(cache.has('a'), true);
  now = 100; assert.equal(cache.has('a'), false);
  assert.equal(cache.has('c'), false);
  assert.equal(cache.size, 0);
});
test('oversized input is not retained and does not change lookup result', () => {
  const cache = new BoundedMissCache(); cache.add('x'.repeat(257));
  assert.equal(cache.size, 0);
  assert.equal(findPrinterEntity([], 'hp', 'x'.repeat(1000)), null);
  assert.equal(storefrontMemoryDiagnostics().printerNegativeEntries, 0);
});
test('new catalogue can resolve a model absent in previous generation', () => {
  assert.equal(findPrinterEntity([], 'hp', 'hp-laserjet-m110w'), null);
  assert.ok(findPrinterEntity(catalog(), 'hp', 'hp-laserjet-m110w'));
});
test('complete index has priority over a previously cached miss', () => {
  const products: any[] = [];
  assert.equal(findPrinterEntity(products, 'hp', 'hp-laserjet-m110w'), null);
  products.push(...catalog());
  const entity = printerEntities(products).find(p => p.slug === 'hp-laserjet-m110w');
  assert.ok(entity);
  assert.strictEqual(findPrinterEntity(products, 'hp', 'hp-laserjet-m110w'), entity);
});
test('diagnostics retain only latest sync and return independent snapshots', () => {
  beginCatalogSync(); finishCatalogSync('refreshed');
  const first = storefrontMemoryDiagnostics();
  assert.equal(first.lastSync?.status, 'refreshed');
  assert.ok(first.lastSync?.after?.rss);
  first.lastSync!.status = 'failed';
  assert.equal(storefrontMemoryDiagnostics().lastSync?.status, 'refreshed');
  beginCatalogSync(); finishCatalogSync('unchanged');
  assert.equal(storefrontMemoryDiagnostics().lastSync?.status, 'unchanged');
  beginCatalogSync(); finishCatalogSync('failed');
  assert.equal(storefrontMemoryDiagnostics().lastSync?.status, 'failed');
});
test('diagnostic endpoint preserves contract and adds finite memory counters', async () => {
  const response = await GET({} as any);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(response.status, data.ok ? 200 : 503);
  for (const key of ['rssMb', 'heapMb', 'heapTotalMb', 'externalMb', 'arrayBuffersMb']) assert.ok(Number.isFinite(data.checks[key]), key);
  assert.equal(data.diagnostics.revision, 'memory-v1');
  assert.equal(data.diagnostics.printerNegativeLimit, 512);
});
