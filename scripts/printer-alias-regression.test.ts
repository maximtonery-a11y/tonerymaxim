import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { GET, buildPrinterIndex } from '../src/pages/api/printers.ts';
import { exactPrinterName, matchingPrinterName } from '../src/lib/printer-name-search.ts';

const products = [
  { id: 1, name: 'Samsung toner', price: 10, compatible_printers: ['Samsung ML-2165W', 'Samsung ML-2165W'] },
  { id: 2, name: 'Samsung original toner', price: 20, compatible_printers: ['Samsung ML-2165', 'Samsung ML-2165W'] },
  { id: 3, name: 'Different Samsung series', price: 30, compatible_printers: ['Samsung ML-2160'] },
  { id: 4, name: 'Xerox toner', price: 40, compatible_printers: ['Xerox Phaser 3020BI', 'Xerox Phaser 3020'] },
  { id: 5, name: 'HP toner', price: 50, compatible_printers: ['HP LaserJet M110w'] },
  { id: 6, name: 'HP plus toner', price: 60, compatible_printers: ['HP LaserJet M110we'] },
];
const printers = buildPrinterIndex(products, 'Samsung');

test('canonical printer groups retain real aliases and count each product once', () => {
  const model = printers.find(p => p.title === 'Samsung ML-2165')!;
  assert.equal(model.product_count, 2);
  assert.deepEqual(model.aliases, ['Samsung ML-2165W']);
  assert.equal(model.url, '/tlaciarne/samsung/samsung-ml-2165');
  assert.equal(matchingPrinterName(model, 'ML-2165W'), 'Samsung ML-2165W');
  assert.equal(matchingPrinterName(model, 'Samsung ML-2160'), null);
  assert.equal(exactPrinterName(model, 'Samsung ML2165W'), true);
  assert.equal(exactPrinterName(model, 'ML2165W'), true);
  assert.equal(exactPrinterName(model, 'Samsung ML2165DW'), false);
  const all = buildPrinterIndex(products);
  assert.equal(all.filter(p => p.brand === 'HP').length, 2, 'HP+ identities must stay separate');
  const xerox = all.find(p => p.title === 'Xerox Phaser 3020')!;
  assert.equal(xerox.product_count, 1);
  assert.equal(matchingPrinterName(xerox, '3020BI'), 'Xerox Phaser 3020BI');
});

test('printer API finds the W variant without merging a different series or retaining query keys', async () => {
  const state = globalThis as any;
  state.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, generated_at: 'alias-generation-1', total: products.length, products };
  async function query(q: string) {
    const r = await GET({ url: new URL('http://localhost/api/printers?brand=samsung&q=' + encodeURIComponent(q)) } as any);
    assert.equal(r.status, 200); return r.json();
  }
  for (const q of ['ML-2165W', 'Samsung ML2165W', 'ml2165w']) {
    const result = await query(q);
    assert.equal(result.printers.length, 1);
    assert.equal(result.printers[0].title, 'Samsung ML-2165');
    assert.ok(result.printers[0].aliases.includes('Samsung ML-2165W'));
  }
  for (let i = 0; i < 100; i++) assert.equal((await query('absent-' + i)).printers.length, 0);
  assert.equal(state.__TM_PRINTERS_INDEX__.size, 1);
  state.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, generated_at: 'alias-generation-2', total: 1, products: [products[2]] };
  assert.equal((await query('ML-2165W')).printers.length, 0);
});

test('actual printer selector renders the W alias and uses the canonical URL for Enter and click', async () => {
  const source = (await readFile(new URL('../src/scripts/printer-finder.js', import.meta.url), 'utf8'))
    .replace(/^import .*printer-name-search\.ts';\n/m, '');
  const element = () => ({ handlers: {} as Record<string, Function>, hidden: true, innerHTML: '', textContent: '', value: '', disabled: false,
    addEventListener(name: string, handler: Function) { this.handlers[name] = handler; } });
  const input = element(), suggestions = element(), submit = element(), clear = element();
  const nodes = new Map([['[data-printer-input]', input], ['[data-printer-suggestions]', suggestions], ['[data-printer-submit]', submit], ['[data-clear-printer]', clear]]);
  const root = { dataset: { brand: 'Samsung' }, classList: { contains: () => false }, querySelector: (selector: string) => nodes.get(selector) || null };
  const document = { querySelectorAll: (selector: string) => selector === '[data-printer-finder]' ? [root] : [], querySelector: () => null, addEventListener() {} };
  const window = { location: { href: '' } };
  vm.runInNewContext(source, { document, window, exactPrinterName, matchingPrinterName, encodeURIComponent,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, printers, brands: [] }) }) });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  input.value = 'ML-2165W'; input.handlers.input();
  assert.equal(suggestions.hidden, false);
  assert.match(suggestions.innerHTML, /Samsung ML-2165W/);
  assert.doesNotMatch(suggestions.innerHTML, /Samsung ML-2160/);
  let prevented = false;
  input.handlers.keydown({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(window.location.href, '/tlaciarne/samsung/samsung-ml-2165');
  window.location.href = '';
  suggestions.handlers.click({ target: { closest: () => ({ dataset: { printerChoice: 'Samsung ML-2165W' } }) } });
  assert.equal(window.location.href, '/tlaciarne/samsung/samsung-ml-2165');
  input.value = 'ML-9999W'; input.handlers.input();
  assert.match(suggestions.innerHTML, /Nenašli sme model/);
});
