import test from 'node:test';
import assert from 'node:assert/strict';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { isCalendarQuery, isGeneralCalendarQuestion, resetCalendarCatalogForTests, searchCalendarProducts } from '../src/lib/calendar-ai-catalog.ts';
import { priceForQuantity, quantityOffers } from '../src/lib/ai-commerce/pricing.ts';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
import { POST as aiTomasPost } from '../src/pages/api/ai-tomas.ts';

async function askAiTomas(message: string, state?: any) {
  const request = new Request('http://localhost/api/ai-tomas', {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ message, page:'/', state }),
  });
  const response = await aiTomasPost({ request } as any);
  assert.equal(response.status, 200);
  return response.json() as Promise<any>;
}

test('kalendárové otázky smerujú do živého katalógu', () => {
  for (const question of ['Hľadám diár 2027', 'Máte týždenné diáre?', 'Máte minidiáre?', 'Máte nástenný kalendár Tatry?', 'Chcem PF pohľadnice']) {
    assert.equal(isCalendarQuery(question), true, question);
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, true, question);
    assert.match(String(route.productQuery), /.+/);
  }
});

test('všeobecná otázka na kalendáre ide živej AI bez náhodných produktov', async () => {
  for (const question of ['Aké kalendáre máte?', 'Aké kalendáre máte v ponuke?', 'Dobrý deň, aké kalendáre ponúkate?']) {
    assert.equal(isGeneralCalendarQuestion(question), true, question);
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, false, question);
    assert.equal(route.productQuery, null, question);
    const result = await askAiTomas(question);
    assert.equal(result.commerce, null, question);
    assert.equal(result.advisor.products.length, 0, question);
    assert.match(result.advisor.answer.join(' '), /nástenné.*stolové.*Hľadáte konkrétny kalendár/is, question);
    assert.deepEqual(result.advisor.sources.map((source:any)=>source.label), ['Nástenné kalendáre','Stolové kalendáre']);
  }
});

test('kalendárové vyhľadávanie neprimieša produkt iba podľa marketingového popisu', async () => {
  resetCalendarCatalogForTests();
  try {
    const result = await searchCalendarProducts('kalendár Slovensko máte?');
    assert.deepEqual(result.products.map((product) => product.sku).sort(), ['NK-01-27','SK-01-27']);
  } finally {
    resetCalendarCatalogForTests();
  }
});

test('diárové podkategórie sa rozpoznajú aj v prirodzenom tvare', async () => {
  for (const question of ['máte týždenné diáre?', 'máte mesačné diáre?', 'máte minidiáre?']) {
    const route = routeCommerceMessage(question, emptyCommerceState());
    assert.equal(route.needsProducts, true, question);
    assert.ok(route.intents.includes('PRODUCT_SEARCH'), question);
  }
  const monthly = await searchCalendarProducts('máte mesačné diáre?');
  assert.ok(monthly.products.length > 0);
  assert.ok(monthly.products.every((product) => /diár/i.test(product.name)));
});

test('všeobecná otázka na diáre vráti druhy ponuky, nie jediný náhodný variant', async () => {
  for (const question of ['Máte v ponuke diáre?', 'Aké máte diáre v ponuke?']) {
    const result = await searchCalendarProducts(question);
    const names = result.products.map((product) => product.name).join(' ');
    assert.ok(result.products.length >= 3, `${question}: ${result.products.length}`);
    assert.match(names, /Denný diár/i);
    assert.match(names, /Týždenný diár/i);
    assert.match(names, /Minidiár/i);
  }
});

test('prírodný motív nevydá kalendár iba pre slovo prirodzene v popise', async () => {
  const result = await searchCalendarProducts('aký nástenný kalendár s prírodou máte?');
  assert.ok(result.products.length > 0);
  assert.ok(result.products.every((product) => !/Ženy/i.test(product.name)));
  assert.ok(result.products.every((product) => /Nástenné/i.test(product.category)));
});

test('jednotný endpoint neprotirečí katalógu a neotvorí zbytočne človeka', async () => {
  const result = await askAiTomas('kalendár Slovensko máte?');
  assert.equal(result.advisor.unanswered, false);
  assert.equal(result.advisor.handoffSuggested, false);
  assert.equal(result.action?.kind, undefined);
  assert.deepEqual(result.commerce.products.map((product: any) => product.sku).sort(), ['NK-01-27','SK-01-27']);
  assert.doesNotMatch(result.advisor.answer.join(' '), /nemám.*spoľahlivú odpoveď|model tlačiarne/i);
});

test('neznámy kalendárový motív dostane kalendárové spresnenie bez handoffu', async () => {
  const result = await askAiTomas('máte kalendár s motívom ponorky?');
  assert.equal(result.action.kind, 'CLARIFY_PRODUCT');
  assert.equal(result.advisor.unanswered, false);
  assert.equal(result.advisor.handoffSuggested, false);
  assert.match(result.advisor.answer.join(' '), /nástenný.*stolový.*minidiár/i);
  assert.doesNotMatch(result.advisor.answer.join(' '), /model tlačiarne|kód toneru/i);
});

test('konkrétna produkčná otázka dostane poradenskú odpoveď aj produkty', async () => {
  const question = 'aké nástenné kalendáre máte v ponuke?';
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

test('všeobecná otázka na tonery si vypýta model alebo označenie a nezobrazí náhodné produkty', async () => {
  for (const question of ['Máte tonery na sklade?', 'Máte kompatibilné tonery?', 'Ponúkate náplne?']) {
    const result = await askAiTomas(question);
    assert.match(result.advisor.answer.join(' '), /presný model tlačiarne.*označenie tonera|presný model tlačiarne.*označenie.*náplne/i, question);
    assert.deepEqual(result.advisor.products, [], question);
    assert.deepEqual(result.advisor.groups, [], question);
    assert.equal(result.commerce, null, question);
    assert.equal(result.action, null, question);
  }
});

test('prechod z toneru na kalendár zahodí starý tonerový kontext', async () => {
  const toner = await askAiTomas('Máte na sklade tonery do HP P1102?');
  const calendar = await askAiTomas('a kalendat stolovy Slovensko mate?', toner.state);
  assert.equal(calendar.route.needsProducts, true);
  assert.match(String(calendar.route.productQuery), /kalendat.*stolovy.*slovensko/i);
  assert.equal(calendar.commerce?.source, 'calendar');
  assert.ok(calendar.commerce?.products?.length > 0);
  assert.ok(calendar.commerce.products.every((product: any) => product.source === 'kalendare-2027'));
  assert.ok(calendar.commerce.products.every((product: any) => !/CE285|P1102|toner/i.test(`${product.sku} ${product.name}`)));
  assert.doesNotMatch(calendar.advisor.answer.join(' '), /nadväzujúca požiadavka|P1102|tonerov do/i);
});
