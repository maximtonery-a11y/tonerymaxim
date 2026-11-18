import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrderStatusQuestion } from '../src/lib/ai-order-question.ts';
import { browserFlow } from './ai-tomas-browser-fixture.ts';

test('proxy 502, HTML a neplatný JSON nikdy nevypíšu technickú chybu do chatu',async()=>{
 for(const makeResponse of [async()=>new Response('Bad Gateway',{status:502}),async()=>new Response('<html>upstream</html>',{status:503}),async()=>new Response('Bad Gateway'),async()=>{throw new TypeError('Failed to fetch')}]){
  const flow=await browserFlow('/produkt/hp-cf259x-59x-kompatibilny-toner',null,makeResponse);
  flow.state.cart=[{product:{id:'keep'},qty:2}];const before=JSON.stringify(flow.state.commerceState);
  await flow.ask('ok, ale ake su moznosti zliav pri tomto tonery?');
  assert.match(flow.messages.at(-1).innerHTML,/nepodarilo načítať odpoveď.*znova/);
  assert.doesNotMatch(flow.messages.at(-1).innerHTML,/Unexpected token|Bad Gateway|JSON|Failed to fetch/);
  assert.equal(flow.state.busy,false);assert.equal(flow.calls.length,1);assert.equal(JSON.stringify(flow.state.commerceState),before);assert.equal(flow.state.cart[0].qty,2);
 }
});

test('dispatcher odovzdá karty do tej istej odpovede a hodnotenie pripojí až po nich',async()=>{
 const g=globalThis as any,previous=g.__TM_PRODUCTS_FILE_CACHE__;
 g.__TM_PRODUCTS_FILE_CACHE__={ok:true,version:4,runtime_compact:true,generated_at:'single-answer',total:1,products:[{id:13264,sku:'13264',name:'HP CF259X čierny kompatibilný toner',slug:'hp-cf259x',price:33.72,product_type_key:'compatible',compatible_printers:['HP LaserJet M404dn']}]};delete g.__TM_PUBLIC_PRODUCTS_CACHE__;delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
 try{
  const flow=await browserFlow();await flow.ask('Ukáž kompatibilný HP CF259X.');
  const bot=flow.messages.filter(message=>message.role==='bot');assert.equal(bot.length,1);assert.deepEqual(flow.presentation.map(item=>item.kind),['products','feedback']);assert.ok(flow.presentation.every(item=>item.target===bot[0]));assert.deepEqual(flow.errors,[]);
 }finally{if(previous)g.__TM_PRODUCTS_FILE_CACHE__=previous;else delete g.__TM_PRODUCTS_FILE_CACHE__;delete g.__TM_PUBLIC_PRODUCTS_CACHE__;delete g.__TM_PRODUCTS_LOOKUP_INDEX__;}
});

test('prehliadač rešpektuje zákaz košíka aj pri zopakovaní objednávky', async () => {
  const flow = await browserFlow();
  await flow.ask('Zopakuj poslednú objednávku, ale nič nepridávaj do košíka.');
  assert.deepEqual(flow.state.cart, []);
  assert.deepEqual(flow.calls, ['/api/ai-tomas']);
  assert.deepEqual(flow.errors, []);
});

test('prehliadač na priamy pokyn skutočne zopakuje objednávku', async () => {
  const flow = await browserFlow();
  await flow.ask('Zopakuj poslednú objednávku.');
  assert.equal(flow.state.cart.length, 1);
  assert.equal(flow.state.cart[0].product.id, 'old');
  assert.deepEqual(flow.errors, []);
});

test('prehliadač zachová registračnú zľavu pri otázkach na e-mail a mobil', async () => {
  const flow = await browserFlow('/ucet');
  for (const question of ['ako uplatním zľavu za registráciu', 'kde mi ta zľava príde zatiaľ neprišla', 'a kde to najdem na mobile?', 'Kam zadám kupón?']) {
    await flow.ask(question);
    assert.match(flow.messages.at(-1).innerHTML, /Moje odmeny/);
    assert.match(flow.messages.at(-1).innerHTML, /Kupónová zľava/);
    assert.doesNotMatch(flow.messages.at(-1).innerHTML, /nemám.*spoľahlivú odpoveď/);
    assert.deepEqual(flow.state.cart, []);
  }
  assert.deepEqual(flow.calls, Array(4).fill('/api/ai-tomas'));
  assert.deepEqual(flow.errors, []);
});

test('prehliadač neposiela otázky na odmeny a body na kontrolu objednávky', async () => {
  const flow = await browserFlow('/ucet');
  for (const question of ['Kde nájdem 7 % zľavu za objednávku?', 'Kde sú vernostné body po expedovaní objednávky?', 'Kde zadám kupón z dokončenej objednávky?']) {
    await flow.ask(question);
    assert.match(flow.messages.at(-1).innerHTML, /Kupónová zľava|Vernostná zľava/);
  }
  assert.deepEqual(flow.calls, Array(3).fill('/api/ai-tomas'));
  assert.equal(flow.verifications(), 0);
  assert.deepEqual(flow.state.cart, []);
  assert.deepEqual(flow.errors, []);
  assert.equal(isOrderStatusQuestion('Kde je moja objednávka so zľavou?'), true);
  assert.equal(isOrderStatusQuestion('Over stav objednávky 300945 s kupónom.'), true);
});

test('prehliadač zobrazí žiadané TM číslo a pri chýbajúcom ponúkne overenie', async () => {
  const flow = await browserFlow();
  await flow.ask('Kde je objednávka 300945?');
  assert.match(flow.messages.at(-1).innerHTML, /300945/);
  assert.doesNotMatch(flow.messages.at(-1).innerHTML, /300950/);
  await flow.ask('Kde je objednávka 300001?');
  assert.equal(flow.verifications(), 1);
  assert.deepEqual(flow.errors, []);
});

test('nadväzujúca otázka na stav ostáva pri rovnakej objednávke a nová téma prejde do poradne', async () => {
  const flow=await browserFlow('/ucet');
  await flow.ask('Kde je objednávka 300945?');
  await flow.ask('a kde ju nájdem?');
  assert.match(flow.messages.at(-1).innerHTML,/300945/);
  assert.doesNotMatch(flow.messages.at(-1).innerHTML,/300950/);
  await flow.ask('Kde je objednávka 300950?');
  await flow.ask('a kde ju nájdem?');
  assert.match(flow.messages.at(-1).innerHTML,/300950/);
  await flow.ask('A ako uplatním zľavu za registráciu?');
  assert.equal(flow.calls.at(-1),'/api/ai-tomas');
  assert.match(flow.messages.at(-1).innerHTML,/Moje odmeny/);
  assert.deepEqual(flow.errors,[]);
});

test('celý dispatcher prejde PFI → diagnostika → neprevzatá zásielka → doprava a platba', async () => {
  const g = globalThis as any;
  const previous = g.__TM_PRODUCTS_FILE_CACHE__;
  g.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, runtime_compact: true, generated_at: 'browser-missing-pfi', total: 0, products: [] };
  delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
  delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  try {
    const flow = await browserFlow();
    const questions = [
      ['Canon PFI-102', /vhodnú náplň nenašiel/],
      ['Podávač papiera cvaká. Čo mám skontrolovať?', /odpojte od elektriny/i],
      ['Zásielka je doručená, ale neprevzal som ju.', /GPS|záznamu o odovzdaní/i],
      ['Chcem kompletný prehľad dopravy a platby.', /GoPay/],
    ] as const;
    for (const [question, expected] of questions) {
      await flow.ask(question);
      assert.match(flow.messages.at(-1).innerHTML, expected, question);
    }
    assert.ok(flow.calls.every(url => url === '/api/ai-tomas'));
    assert.deepEqual(flow.state.cart, []);
    assert.deepEqual(flow.errors, []);
  } finally {
    if (previous) g.__TM_PRODUCTS_FILE_CACHE__ = previous; else delete g.__TM_PRODUCTS_FILE_CACHE__;
    delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
    delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  }
});

test('browser dispatcher sends the product page and renders its exact compatibility answer', async () => {
  const g = globalThis as any;
  const previous = g.__TM_PRODUCTS_FILE_CACHE__;
  g.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, runtime_compact: true, generated_at: 'browser-product-context', total: 1, products: [
    { id: 52658, sku: 'SET-HP-220A-KOM-CIP', name: 'HP 220A CMYK kompatibilná sada', slug: 'hp-220a-cmyk', price: 116.34, stock_status: 'instock', stock_quantity: null, compatible_printers: ['HP Color LaserJet Pro MFP 4302dw'] },
  ] };
  delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
  delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  try {
    const flow = await browserFlow('/produkt/hp-220a-cmyk');
    await flow.ask('Do ktorých tlačiarní pasuje tento produkt?');
    assert.match(flow.messages.at(-1).innerHTML, /Myslíte.*HP 220A/);
    assert.match(flow.messages.at(-1).innerHTML, /HP Color LaserJet Pro MFP 4302dw/);
    assert.deepEqual(flow.calls, ['/api/ai-tomas']);
    assert.deepEqual(flow.state.cart, []);
    assert.deepEqual(flow.errors, []);
  } finally {
    if (previous) g.__TM_PRODUCTS_FILE_CACHE__ = previous; else delete g.__TM_PRODUCTS_FILE_CACHE__;
    delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
    delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  }
});

test('browser sends current catalogue search and drops unrelated URL parameters', async () => {
  const g = globalThis as any;
  const previous = g.__TM_PRODUCTS_FILE_CACHE__;
  g.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, runtime_compact: true, generated_at: 'browser-search-context', total: 2, products: [
    { id: 220, sku: 'HP-220A-SET', name: 'HP 220A CMYK kompatibilná sada', slug: 'hp-220a-cmyk', price: 116.34, compatible_printers: ['HP Color LaserJet Pro MFP 4302dw'] },
    { id: 2421, sku: 'BRO-TN2421-K', name: 'Brother TN-2421 čierny kompatibilný toner', slug: 'brother-tn-2421', price: 12.96, product_type_key: 'compatible', compatible_printers: ['Brother HL-L2352DW'] },
  ] };
  delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
  delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  try {
    const flow = await browserFlow('/produkty?s=Brother+TN-2421&email=private@example.sk&token=private');
    flow.state.commerceState.currentProductId = '220';
    flow.state.commerceState.lastProductQuery = 'HP 220A';
    await flow.ask('Do ktorých tlačiarní pasuje tento produkt?');
    assert.equal(flow.requests.at(-1).page, '/produkty?s=Brother+TN-2421');
    assert.match(flow.messages.at(-1).innerHTML, /Brother TN-2421/);
    assert.doesNotMatch(flow.messages.at(-1).innerHTML, /HP 220A/);
    assert.deepEqual(flow.errors, []);
    assert.deepEqual(flow.state.cart, []);
  } finally {
    if (previous) g.__TM_PRODUCTS_FILE_CACHE__ = previous; else delete g.__TM_PRODUCTS_FILE_CACHE__;
    delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
    delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  }
});

test('the real session initializer preserves the question across search → detail navigation and handles old saved sessions', async () => {
  const g = globalThis as any;
  const previous = g.__TM_PRODUCTS_FILE_CACHE__;
  g.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, runtime_compact: true, generated_at: 'browser-deictic-navigation', total: 2, products: [
    { id: 39951, sku: '13276', name: 'HP W1420A (142A) čierny kompatibilný toner nefunguje v HP+', slug: 'hp-w1420a-no-142a-kompatibilny-toner', product_type_key: 'compatible', price: 18.24, capacity: '950 strán', compatible_printers: ['HP LaserJet M110w', 'HP LaserJet MFP M140w'] },
    { id: 38209, sku: '051475', name: 'HP W1420A (142A) čierny originálny toner', slug: 'hp-w1420a-originalny-toner', product_type_key: 'original', price: 59.46, compatible_printers: ['HP LaserJet M110we'] },
  ] };
  delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
  delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  try {
    const cart = [{ product: { id: 'keep', sku: 'KEEP', price: 26.91 }, qty: 1 }];
    const search = await browserFlow('/produkty?s=HP+W1420A', { uiMode: 'advice', uiCart: cart });
    await search.ask('ako funguje tento toner?');
    assert.match(search.messages.at(-1).innerHTML, /Ktorý.*produkt/);
    const saved = search.persisted();
    assert.equal(saved.pendingProductQuestion, 'ako funguje tento toner?');
    for (const legacy of [false, true]) {
      const session = JSON.parse(JSON.stringify(saved));
      if (legacy) delete session.pendingProductQuestion;
      const detail = await browserFlow('/produkt/hp-w1420a-no-142a-kompatibilny-toner', session);
      await detail.ask('tento');
      assert.match(detail.messages.at(-1).innerHTML, /prášok.*papier.*teplom/);
      assert.match(detail.messages.at(-1).innerHTML, /950.*strán/);
      assert.doesNotMatch(detail.messages.at(-1).innerHTML, /M110we|Na túto otázku nemám/);
      assert.equal(detail.requests.at(-1).page, '/produkt/hp-w1420a-no-142a-kompatibilny-toner');
      assert.deepEqual(JSON.parse(JSON.stringify(detail.state.cart)), cart);
      assert.equal(detail.persisted().pendingProductQuestion, null);
      assert.deepEqual(detail.errors, []);
    }
    assert.deepEqual(search.errors, []);
  } finally {
    if (previous) g.__TM_PRODUCTS_FILE_CACHE__ = previous; else delete g.__TM_PRODUCTS_FILE_CACHE__;
    delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
    delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  }
});
