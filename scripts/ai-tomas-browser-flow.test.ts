import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { forbidsCartMutation, isCartChangingAction } from '../src/lib/ai-cart-safety.ts';
import { isOrderStatusQuestion, isOrderRepeatCommand, selectRequestedOrder } from '../src/lib/ai-order-question.ts';

// Executes the real browser dispatcher with fake DOM/network boundaries.
// This covers branches before the API call; it does not replace visual QA.
async function browserFlow(pathname = '/', savedSession: any = null) {
  const pageUrl = new URL(pathname, 'http://localhost');
  const source = await readFile(new URL('../src/scripts/ai-sales-assistant.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('  async function unifiedAsk('), source.indexOf('  function looksLikeShopping('));
  assert.ok(code.length > 1000);
  let persisted: any = null;
  const hydration = savedSession ? vm.runInNewContext(
    source.slice(source.indexOf('  const state = { busy:'), source.indexOf('  function trackEvent(')) + '; ({state, saveCommerceSession})',
    { saved: savedSession, SESSION_KEY: 'tm_ai_tomas_state_v1', messages: { innerHTML: '' }, sessionStorage: { setItem: (_key: string, value: string) => { persisted = JSON.parse(value); } } },
  ) : null;
  const state: any = hydration?.state || { mode: 'advice', busy: false, cart: [], commerceState: emptyCommerceState('browser-flow'), profile: { lastOrder: { products: [{ id: 'old', name: 'Old product' }] } } };
  const calls: string[] = [], messages: any[] = [], errors: unknown[] = [], requests: any[] = [];
  let verifications = 0;
  const noop = () => {};
  const scope: any = {
    state, isOrderStatusQuestion, isOrderRepeatCommand, selectRequestedOrder, forbidsCartMutation, isCartChangingAction,
    beginSession: noop, looksLikeShopping: () => false, escapeHtml: (v: unknown) => String(v),
    addMessage: (role: string, html: string) => { const node = { role, innerHTML: html, textContent: 'response', scrollIntoView: noop }; messages.push(node); return node; },
    renderGuestOrderVerification: () => { verifications++; },
    addCommerceItem: (product: any, qty: number) => state.cart.push({ product, qty }),
    askNextStep: noop, trackEvent: noop, autoPanelSize: noop, setExperience: noop,
    textToHtml: (lines: string[]) => lines.join(' '), appendSources: noop, attachFeedback: noop,
    openHandoff: noop, renderCommerceResults: noop, renderSafeProducts: noop,
    cartKey: (p: any) => p.id, updateLiveCart: noop, quantityChooser: noop, renderTypeQuestion: noop,
    renderCart: noop, prepareHandoff: noop, saveCommerceSession: hydration?.saveCommerceSession || noop, requestAnimationFrame: (fn: () => void) => fn(),
    location: { pathname: pageUrl.pathname, search: pageUrl.search }, URLSearchParams, console: { error: (...args: any[]) => errors.push(args) },
    fetch: async (url: string, options: any) => {
      calls.push(url);
      if (url === '/api/ai-order-status') return Response.json({ ok: true, orders: [{ number: '300950', statusLabel: 'Nová' }, { number: '300945', statusLabel: 'Vybavená' }] });
      assert.equal(url, '/api/ai-tomas');
      requests.push(JSON.parse(options.body));
      return POST({ request: new Request(`http://localhost${url}`, options) } as any);
    },
  };
  const ask = vm.runInNewContext(`${code}; unifiedAsk`, scope);
  return { ask, state, calls, messages, errors, requests, verifications: () => verifications, persisted: () => persisted };
}

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

test('celý dispatcher prejde PFI → diagnostika → neprevzatá zásielka → doprava a platba', async () => {
  const g = globalThis as any;
  const previous = g.__TM_PRODUCTS_FILE_CACHE__;
  g.__TM_PRODUCTS_FILE_CACHE__ = { ok: true, version: 4, runtime_compact: true, generated_at: 'browser-missing-pfi', total: 0, products: [] };
  delete g.__TM_PUBLIC_PRODUCTS_CACHE__;
  delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
  try {
    const flow = await browserFlow();
    const questions = [
      ['Canon PFI-102', /nenašiel bezpečnú zhodu/],
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
    assert.match(search.messages.at(-1).innerHTML, /Ktorý konkrétny produkt/);
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
