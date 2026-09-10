import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAvailableNow, storefrontStockClass, storefrontStockText } from '../src/lib/product-availability.ts';

test('nulový sklad sa zobrazuje ako produkt na objednávku', () => {
  const product = { price: 55.35, stock_status: 'outofstock', stock_quantity: 0 };
  assert.equal(isAvailableNow(product), false);
  assert.equal(storefrontStockText(product), 'Na objednávku');
  assert.equal(storefrontStockClass(product), 'is-backorder');
});

test('kladný sklad zostáva skladom', () => {
  const product = { price: 55.35, stock_status: 'instock', stock_quantity: 4 };
  assert.equal(isAvailableNow(product), true);
  assert.equal(storefrontStockText(product), 'Skladom 4 ks');
});

test('detail a katalóg umožňujú vložiť produkt na objednávku do košíka', async () => {
  const detail = await readFile(new URL('../src/scripts/product-detail.js', import.meta.url), 'utf8');
  const catalog = await readFile(new URL('../src/scripts/catalog.js', import.meta.url), 'utf8');
  assert.doesNotMatch(detail, /if \(!isProductInStock\(product\)\) \{\s*openAvailabilityModal/);
  assert.doesNotMatch(catalog, /if \(!isProductInStock\(product\)\) \{\s*openAvailabilityModal/);
  assert.match(detail, /Pridať do košíka/);
  assert.match(catalog, /Pridať do košíka/);
});

test('server povolí aktívny produkt s nulovým skladom, no stále vyžaduje cenu a publikovanie', async () => {
  const secure = await readFile(new URL('../src/lib/secure-checkout-cart.ts', import.meta.url), 'utf8');
  assert.match(secure, /return price > 0/);
  assert.match(secure, /status: "publish"/);
  assert.match(secure, /stockQuantity > 0 && totalRequested > stockQuantity/);
  assert.doesNotMatch(secure, /status === "outofstock"\) return false/);
});

test('dohodnutá lehota je jednotná v detaile, katalógu, košíku a pokladni', async () => {
  const paths = [
    '../src/scripts/product-detail.js',
    '../src/scripts/catalog.js',
    '../src/scripts/cart.js',
    '../src/scripts/checkout.js',
  ];
  const sources = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) assert.match(source, /3–10 pracovných dní|ORDER_DELIVERY_LABEL/);
});
