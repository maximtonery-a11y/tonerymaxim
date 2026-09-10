import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAvailableNow, orderFulfilmentText, storefrontStockClass, storefrontStockText } from '../src/lib/product-availability.ts';

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

test('množstvo nad sklad sa nezablokuje a zobrazí rozdelené dodanie', () => {
  const product = { price: 69.36, stock_status: 'instock', stock_quantity: 1 };
  assert.equal(orderFulfilmentText(product, 1), 'Skladom 1 ks');
  assert.equal(orderFulfilmentText(product, 3), '1 ks skladom · zostávajúce 2 ks dodáme do 3–10 pracovných dní');
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
  assert.doesNotMatch(secure, /totalRequested > stockQuantity/);
  assert.doesNotMatch(secure, /status === "outofstock"\) return false/);
});

test('košík neznižuje množstvo na aktuálny sklad a povolí plus do 99 ks', async () => {
  const cart = await readFile(new URL('../src/scripts/cart.js', import.meta.url), 'utf8');
  assert.match(cart, /if \(notify\) showStockLimitNotice\(item, limit, requested\);\s*return requested;/);
  assert.match(cart, /const qtyMax = 99;/);
  assert.doesNotMatch(cart, /qty >= maxQty \? 'aria-disabled/);
  assert.match(cart, /zostávajúce.*3–10 pracovných dní/);
});

test('pokladňa zobrazí rozdelené dodanie pri množstve nad sklad', async () => {
  const checkout = await readFile(new URL('../src/scripts/checkout.js', import.meta.url), 'utf8');
  assert.match(checkout, /requested > stock/);
  assert.match(checkout, /orderFulfilmentText\(item, requested\)/);
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
