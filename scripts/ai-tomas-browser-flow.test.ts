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
async function browserFlow() {
  const source = await readFile(new URL('../src/scripts/ai-sales-assistant.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('  async function unifiedAsk('), source.indexOf('  function looksLikeShopping('));
  assert.ok(code.length > 1000);
  const state: any = { mode: 'advice', busy: false, cart: [], commerceState: emptyCommerceState('browser-flow'), profile: { lastOrder: { products: [{ id: 'old', name: 'Old product' }] } } };
  const calls: string[] = [], messages: any[] = [], errors: unknown[] = [];
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
    renderCart: noop, prepareHandoff: noop, saveCommerceSession: noop, requestAnimationFrame: (fn: () => void) => fn(),
    location: { pathname: '/' }, console: { error: (...args: any[]) => errors.push(args) },
    fetch: async (url: string, options: any) => {
      calls.push(url);
      if (url === '/api/ai-order-status') return Response.json({ ok: true, orders: [{ number: '300950', statusLabel: 'Nová' }, { number: '300945', statusLabel: 'Vybavená' }] });
      assert.equal(url, '/api/ai-tomas');
      return POST({ request: new Request(`http://localhost${url}`, options) } as any);
    },
  };
  const ask = vm.runInNewContext(`${code}; unifiedAsk`, scope);
  return { ask, state, calls, messages, errors, verifications: () => verifications };
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
  const flow = await browserFlow();
  const questions = [
    ['Canon PFI-102', /katalóg/],
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
});
