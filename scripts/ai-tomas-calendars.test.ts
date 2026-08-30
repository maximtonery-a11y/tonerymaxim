import test from 'node:test';
import assert from 'node:assert/strict';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { isCalendarQuery, resetCalendarCatalogForTests, searchCalendarProducts } from '../src/lib/calendar-ai-catalog.ts';
import { priceForQuantity, quantityOffers } from '../src/lib/ai-commerce/pricing.ts';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';

test('kalendárové otázky smerujú do živého katalógu', () => {
  for (const question of ['Aké kalendáre máte?', 'Aké kalendáre máte v ponuke?', 'Hľadám diár 2027', 'Máte nástenný kalendár Tatry?', 'Chcem PF pohľadnice']) {
    assert.equal(isCalendarQuery(question), true, question);
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, true, question);
    assert.match(String(route.productQuery), /.+/);
  }
});

test('presná produkčná otázka dostane poradenskú odpoveď aj produkty', async () => {
  const question = 'aké kalendáre máte v ponuke?';
  const route = routeCommerceMessage(question, emptyCommerceState());
  assert.ok(route.intents.includes('ADVICE'));
  assert.equal(route.needsProducts, true);

  const [advisor, catalogue] = await Promise.all([
    buildAssistantAnswer(question),
    searchCalendarProducts(question),
  ]);
  assert.match(advisor.answer.join(' '), /nástenné.*stolové.*diáre/i);
  assert.ok(catalogue.products.length > 0);
  assert.ok(catalogue.products.every((product) => product.source === 'kalendare-2027'));
});

test('kalendáre majú vlastné množstevné zľavy', () => {
  assert.equal(priceForQuantity(10, 'calendar', 1).discountPercent, 0);
  assert.equal(priceForQuantity(10, 'calendar', 3).discountPercent, 5);
  assert.equal(priceForQuantity(10, 'calendar', 21).discountPercent, 15);
  assert.deepEqual(quantityOffers(10, 'calendar').map((offer) => offer.quantity), [1, 3, 21]);
  assert.equal(priceForQuantity(10, 'compatible', 4).discountPercent, 25);
});

test('živý kalendárový feed sa mapuje do bezpečného AI produktu', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { sku:'NK-02-27', name:'Nástenný kalendár Tatry 2027', category:'Nástenné kalendáre', price:5.03, format:'340 × 460 mm', slug:'nastenny-kalendar-tatry-2027', image:'/images/nk-02.jpg', availability:{inStock:true}, price_tiers:[] },
    { sku:'SK-PSY-27', name:'Stolový kalendár Psy 2027', category:'Stolové kalendáre', price:4, slug:'stolovy-kalendar-psy-2027', image:'/images/psy.jpg', availability:{inStock:true}, price_tiers:[] },
  ]), { status: 200, headers: { 'Content-Type':'application/json' } });
  try {
    const result = await searchCalendarProducts('nástenný kalendár Tatry');
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].sku, 'NK-02-27');
    assert.equal(result.products[0].source, 'kalendare-2027');
    assert.equal(result.products[0].product_type_key, 'calendar');
    assert.equal(result.products[0].purchasable, true);
    assert.equal(result.products[0].url, '/kalendare/produkt/nastenny-kalendar-tatry-2027');
  } finally {
    globalThis.fetch = originalFetch;
    resetCalendarCatalogForTests();
  }
});

test('výpadok živého feedu použije záložný katalóg bez HTTP 500', async () => {
  const originalFetch = globalThis.fetch;
  resetCalendarCatalogForTests();
  globalThis.fetch = async () => { throw new Error('simulated outage'); };
  try {
    const result = await searchCalendarProducts('nástenný kalendár Tatry 2027');
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].name, 'Nástenný kalendár Tatry 2027');
    assert.equal(result.products[0].source, 'kalendare-2027');
  } finally {
    globalThis.fetch = originalFetch;
    resetCalendarCatalogForTests();
  }
});

test('poškodený JSON živého feedu použije záložný katalóg', async () => {
  const originalFetch = globalThis.fetch;
  resetCalendarCatalogForTests();
  globalThis.fetch = async () => new Response('{broken json', { status: 200, headers: { 'Content-Type':'application/json' } });
  try {
    const result = await searchCalendarProducts('diár 2027');
    assert.ok(result.products.length > 0);
    assert.ok(result.products.every((product) => product.source === 'kalendare-2027'));
  } finally {
    globalThis.fetch = originalFetch;
    resetCalendarCatalogForTests();
  }
});

test('prázdny alebo neplatný feed nesmie vymazať kalendárovú ponuku', async () => {
  const originalFetch = globalThis.fetch;
  resetCalendarCatalogForTests();
  globalThis.fetch = async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'Content-Type':'application/json' } });
  try {
    const result = await searchCalendarProducts('aké kalendáre máte');
    assert.ok(result.products.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    resetCalendarCatalogForTests();
  }
});

test('AI Tomáš vie predstaviť celý sortiment a nehovorí iba o toneroch', async () => {
  const result = await buildAssistantAnswer('Čo predávate?');
  const answer = result.answer.join(' ');
  assert.match(answer, /toner/i);
  assert.match(answer, /kalendár/i);
  assert.equal(result.unanswered, undefined);
});
