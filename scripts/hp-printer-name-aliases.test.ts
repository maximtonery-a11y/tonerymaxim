import test from 'node:test';
import assert from 'node:assert/strict';
import { findPrinterEntity, printerEntities } from '../src/lib/seo-catalog.ts';
import { GET, buildPrinterIndex } from '../src/pages/api/printers.ts';
import { exactPrinterName, matchingPrinterName } from '../src/lib/printer-name-search.ts';
import { filterProducts } from '../src/lib/tm-products-cache.ts';
import { sameConsumablePrinterFamily } from '../src/lib/printer-model-family.ts';

const fullName = 'HP LaserJet Pro MFP M1132';
const aliases = ['HP LaserJet M1132', 'HP LaserJet Pro M1132', fullName];
const slugs = aliases.map(name => name.toLowerCase().replace(/ /g, '-'));
function product(id: number, name: string, printer: string, type = 'compatible') {
  return { id, name, sku: String(id), slug: `product-${id}`, price: 20,
    stock_status: 'instock', product_type_key: type, compatible_printers: [printer],
    search_text: `${name} ${printer}`.toLowerCase() };
}
function catalogue() {
  return [
    product(37594, 'HP CE285A čierny kompatibilný toner', fullName),
    product(43964, 'HP CE285X čierny kompatibilný toner', fullName),
    product(38139, 'HP CE285A čierny originálny toner', fullName, 'original'),
    product(38754, 'HP CE285A renovovaný toner', fullName, 'renovated'),
    product(38130, 'HP CE285AD originálne tonery (2 ks)', aliases[1], 'original'),
    product(90001, 'HP iný variant tlačiarne', 'HP LaserJet Pro MFP M1132s'),
    product(90002, 'HP iné číslo tlačiarne', 'HP LaserJet Pro MFP M1134'),
    product(90003, 'Iná značka', 'Canon LaserJet M1132'),
  ];
}
const expected = [37594, 38130, 38139, 38754, 43964].sort((a, b) => a - b);
const ids = (products: any[]) => products.map(p => p.id).sort((a, b) => a - b);

test('homepage legacy slug and both current HP names show the same complete offer', () => {
  const products = catalogue();
  for (const slug of slugs) {
    const page = findPrinterEntity(products, 'hp', slug);
    assert.ok(page, `missing printer page: ${slug}`);
    assert.deepEqual(ids(page.products), expected, slug);
    assert.strictEqual(findPrinterEntity(products, 'hp', slug), page);
  }
});

test('building the full SEO index cannot restore the split original-only offer', () => {
  const products = catalogue();
  printerEntities(products);
  for (const slug of slugs) assert.deepEqual(ids(findPrinterEntity(products, 'hp', slug)!.products), expected);
  assert.equal(findPrinterEntity(products, 'hp', 'hp-laserjet-m113'), null);
});

test('printer suggestions group Pro/MFP spellings and count each product once', () => {
  const products = catalogue();
  products[0].compatible_printers.push(aliases[1], aliases[0]);
  const printers = buildPrinterIndex(products, 'HP');
  const m1132 = printers.filter(p => exactPrinterName(p, fullName));
  assert.equal(m1132.length, 1);
  assert.equal(m1132[0].product_count, 5);
  for (const alias of aliases) {
    assert.equal(exactPrinterName(m1132[0], alias), true, alias);
    assert.ok(matchingPrinterName(m1132[0], alias));
  }
  assert.equal(printers.filter(p => /M1132s$/.test(p.title)).length, 1);
});

test('old homepage name remains searchable even when no product stores that spelling', () => {
  const printer = buildPrinterIndex(catalogue(), 'HP').find(p => p.title === aliases[1])!;
  assert.ok(printer);
  assert.equal(exactPrinterName(printer, aliases[0]), true);
  assert.ok(matchingPrinterName(printer, aliases[0]));
  assert.ok(matchingPrinterName(printer, 'LaserJet M1132'));
  assert.equal(exactPrinterName(printer, 'HP LaserJet M1132s'), false);
});

test('printer-filter search and model pages retain both compatible and original SKUs', () => {
  const products = catalogue();
  for (const printer of aliases) {
    assert.deepEqual(ids(filterProducts(products, { printer })), expected);
  }
});

test('public printer API returns one complete HP alias group for the old homepage name', async () => {
  const state = globalThis as any;
  const previous = state.__TM_PRODUCTS_FILE_CACHE__;
  state.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, generated_at: 'hp-m1132-alias-regression',
    total: catalogue().length, products: catalogue() };
  try {
    for (const name of aliases) {
      const response = await GET({ url: new URL(`http://localhost/api/printers?brand=HP&q=${encodeURIComponent(name)}`) } as any);
      assert.equal(response.status, 200);
      const body = await response.json();
      const exact = body.printers.filter((p: any) => exactPrinterName(p, name));
      assert.equal(exact.length, 1, name);
      assert.equal(exact[0].product_count, 5, name);
      assert.equal(exact[0].url, '/tlaciarne/hp/hp-laserjet-pro-m1132');
    }
  } finally {
    state.__TM_PRODUCTS_FILE_CACHE__ = previous;
  }
});

test('HP identity keeps every model suffix, including HP+ e, and other printer ranges', () => {
  assert.equal(sameConsumablePrinterFamily(aliases[0], fullName), true);
  for (const [left, right] of [
    ['HP LaserJet M110w', 'HP LaserJet Pro M110we'],
    ['HP LaserJet Pro MFP M140w', 'HP LaserJet MFP M140we'],
    ['HP LaserJet Pro MFP M1132', 'HP LaserJet Pro MFP M1132s'],
    ['HP LaserJet M1132', 'HP LaserJet M1134'],
    ['HP LaserJet M1132', 'HP DeskJet M1132'],
    ['HP LaserJet M1132', 'Canon LaserJet M1132'],
  ]) assert.equal(sameConsumablePrinterFamily(left, right), false, `${left} / ${right}`);
  const products = [product(1, 'HP W1420A compatible', 'HP LaserJet Pro M110w'),
    product(2, 'HP W1420A original', 'HP LaserJet Pro M110we', 'original')];
  assert.deepEqual(ids(findPrinterEntity(products, 'hp', 'hp-laserjet-m110w')!.products), [1]);
  assert.deepEqual(ids(findPrinterEntity(products, 'hp', 'hp-laserjet-m110we')!.products), [2]);
});
