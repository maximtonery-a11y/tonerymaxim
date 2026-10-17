import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('page-streamed sync preserves Unicode details, enrichment, duplicate IDs and last complete generation on failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tm-stream-sync-'));
  Object.assign(process.env, { TM_CACHE_DIR: dir, WOO_URL: 'https://example.invalid', WOO_CONSUMER_KEY: 'test', WOO_CONSUMER_SECRET: 'test',
    WOO_SYNC_MIN_PRODUCTS: '1', WOO_SYNC_EXPECTED_MIN_PRODUCTS: '1', WOO_SYNC_PAGE_DELAY_MS: '120', TM_DISABLE_INDEXNOW: '1' });
  delete process.env.TM_PERSISTENT_DATA_DIR;
  let mode = 'complete';
  const originalFetch = globalThis.fetch;
  const makeProduct = (id: number, complete = true) => ({ id, sku: `CF226A-${id}`, name: `HP CF226A čierny kompatibilný toner ${id}`,
    slug: `hp-toner-${id}`, price: '17.88', regular_price: '17.88', stock_status: 'instock', stock_quantity: id,
    description: `<p>Žltý text 漢字 🖨️ ${id} ${'opis výrobku '.repeat(600)}</p>`, short_description: '<p>Krátky slovenský opis</p>', images: [], categories: [],
    attributes: complete ? [ { name: 'OEM', options: ['CF226A', 'CF227A'] }, { name: 'Kapacita', options: ['3 100 strán'] }, { name: 'Kompatibilné tlačiarne', options: ['HP LaserJet M402n', 'HP LaserJet M402dw'] } ] : [], meta_data: [] });
  globalThis.fetch = async (input: any) => {
    const url = new URL(String(input));
    assert.ok(url.pathname.includes('/wp-json/wc/v3/products'));
    const page = Number(url.searchParams.get('page'));
    if (mode === 'failed' && page === 2) return new Response('denied', { status: 403 });
    const products = page === 1 ? Array.from({ length: 100 }, (_, i) => makeProduct(i + 1, i !== 0)) : [makeProduct(1), makeProduct(101, false)];
    if (page === 2) products[0].short_description = '<p>Najnovší duplicitný záznam 🖨️</p>';
    const payload = mode === 'truncated' && page === 2 ? [] : products;
    return Response.json(payload, { headers: { 'x-wp-total': mode === 'truncated' ? '500' : '101', 'x-wp-totalpages': '2' } });
  };
  try {
    const { syncProductsCache, getProductFromCache, mapProduct, filterProducts } = await import('../src/lib/tm-products-cache.ts');
    const result = await syncProductsCache({ force: true });
    assert.equal(result.cache.total, 101);
    assert.ok(filterProducts(result.cache.products, { search: 'CF227A' }).some((p: any) => p.id === 100), 'explicit OEM survives compact streaming cache');
    // Cross-page enrichment still uses every product, even though details were
    // already written. The duplicate retains its last value, as before.
    const enriched = result.cache.products.find((p: any) => p.id === 101)!;
    assert.equal(enriched.capacity, '3 100 strán');
    assert.deepEqual(enriched.compatible_printers, ['HP LaserJet M402n', 'HP LaserJet M402dw']);
    for (const id of [1, 100, 101]) {
      const { product } = await getProductFromCache({ id });
      assert.ok(product);
      const raw = makeProduct(id, id !== 101);
      if (id === 1) raw.short_description = '<p>Najnovší duplicitný záznam 🖨️</p>';
      const expected = mapProduct(raw);
      assert.equal(product.description_html, expected.description_html);
      assert.equal(product.short_description_html, expected.short_description_html);
      const expectedAttributes = JSON.parse(JSON.stringify(expected.attributes));
      assert.deepEqual(product.attributes, expectedAttributes);
      assert.deepEqual(product.attributes_all, expectedAttributes);
    }
    assert.ok(result.sync?.products.every((p: any) => !('attributes' in p) && !('description_html' in p)), 'sync must not retain full detail objects');
    const saved = await readFile(join(dir, 'products.json'), 'utf8');
    const detailsPath = join(dir, result.cache.details_file!);
    const details = await open(detailsPath, 'r');
    try {
      for (const p of result.cache.products) {
        const buffer = Buffer.alloc(p._detail_length);
        const { bytesRead } = await details.read(buffer, 0, buffer.length, p._detail_offset);
        assert.equal(bytesRead, buffer.length);
        assert.ok(JSON.parse(buffer.toString('utf8')).description_html.includes('漢字 🖨️'));
      }
    } finally { await details.close(); }
    const initialFiles = (await readdir(dir)).filter(f => f.startsWith('product-details-')).sort();
    for (mode of ['failed', 'truncated']) {
      const fallback = await syncProductsCache({ force: true });
      assert.equal(fallback.refreshed, false);
      assert.equal(fallback.cache.generated_at, result.cache.generated_at);
      assert.equal(await readFile(join(dir, 'products.json'), 'utf8'), saved);
      assert.deepEqual((await readdir(dir)).filter(f => f.startsWith('product-details-')).sort(), initialFiles);
      assert.ok(!(await readdir(dir)).some(f => f.endsWith('.tmp')));
    }
    mode = 'complete';
    const next = await syncProductsCache({ force: true });
    assert.equal(next.refreshed, true);
    assert.notEqual(next.cache.details_file, result.cache.details_file);
    assert.equal((await getProductFromCache({ id: 1 })).product?.short_description_html, '<p>Najnovší duplicitný záznam 🖨️</p>');
  } finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); }
});

test('a failed final publication preserves the previous JSON and removes unpublished detail files', async () => {
  const { createProductCacheWriter } = await import('../src/lib/product-cache-writer.ts');
  const dir = await mkdtemp(join(tmpdir(), 'tm-stream-publish-'));
  const cacheFile = join(dir, 'products.json');
  await writeFile(cacheFile, 'previous complete catalogue');
  const writer = await createProductCacheWriter(dir, cacheFile);
  try {
    await writer.appendDetail({ description_html: '<p>Úplný opis</p>', attributes: [] });
    // A value that cannot be serialised fails after the details have been flushed.
    await assert.rejects(writer.publish({ ok: true }, [{ id: 1, unsupported: BigInt(1) }]));
  } finally { await writer.discard(); }
  assert.equal(await readFile(cacheFile, 'utf8'), 'previous complete catalogue');
  assert.deepEqual(await readdir(dir), ['products.json']);
  await rm(dir, { recursive: true, force: true });
});
