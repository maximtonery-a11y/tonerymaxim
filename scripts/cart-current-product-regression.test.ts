import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cartProductUnavailable, markMissingCartProduct, mergeCurrentCartProduct } from '../src/lib/cart-product-refresh.ts';
import { currentProductSlug, isLegacyProductSlug } from '../src/lib/product-slug-aliases.ts';

test('košík nahradí starú URL, cenu a sklad aktuálnymi údajmi katalógu',()=>{
  const stale={
    id:'37471',sku:'15048',name:'Brother TN-2421 kompatibilný toner',price:12.06,
    url:'/produkt/brother-tn-2421-kompatibilny-toner',stock_status:'instock',stock_quantity:4,qty:1,
  };
  const live={
    id:37471,sku:'15048',name:'Brother TN-2421 čierny kompatibilný toner',price:14.01,
    slug:'brother-tn-2421-cierny-kompatibilny-toner',
    detail_url:'/produkt/brother-tn-2421-cierny-kompatibilny-toner',
    stock_status:'outofstock',stock_quantity:0,
  };
  const merged=mergeCurrentCartProduct(stale,live);
  assert.equal(merged.url,live.detail_url);
  assert.equal(merged.name,live.name);
  assert.equal(merged.price,14.01);
  assert.equal(merged.stock_status,'outofstock');
  assert.equal(merged.stock_quantity,0);
  assert.equal(cartProductUnavailable(merged),true);
});

test('produkt nenájdený v úspešne overenom katalógu sa nesmie objednať',()=>{
  const missing=markMissingCartProduct({sku:'NEEXISTUJE',qty:1,stock_status:'instock',stock_quantity:5});
  assert.equal(missing.catalog_missing,true);
  assert.equal(missing.stock_quantity,0);
  assert.equal(cartProductUnavailable(missing),true);
  assert.equal(missing.url,'/produkty?s=NEEXISTUJE');
});

test('staré verejné URL TN2421 majú bezpečné kanonické aliasy',()=>{
  assert.equal(isLegacyProductSlug('brother-tn-2421-kompatibilny-toner'),true);
  assert.equal(currentProductSlug('brother-tn-2421-kompatibilny-toner'),'brother-tn-2421-cierny-kompatibilny-toner');
  assert.equal(currentProductSlug('brother-tn-2421-originalny-toner'),'brother-tn-2421-cierny-originalny-toner');
  assert.equal(currentProductSlug('brother-tn-2421-renovovany-toner'),'brother-tn-2421-cierny-renovovany-toner');
});

test('živý košík vždy overuje produkt a blokuje pokladňu pri nedostupnosti',async()=>{
  const cart=await readFile(new URL('../src/scripts/cart.js',import.meta.url),'utf8');
  assert.match(cart,/fetchProductsBySkus\(cart/);
  assert.match(cart,/\/api\/products\?skus=/);
  assert.doesNotMatch(cart,/Promise\.all\(cart\.map/);
  assert.match(cart,/cartProductUnavailable\(item\)/);
  assert.match(cart,/data-cart-unavailable-notice/);
  assert.match(cart,/setAttribute\('aria-disabled', 'true'\)/);

  const assistant=await readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
  assert.match(assistant,/data\?\.queryLabel\|\|state\.lastQuestion/);
});
