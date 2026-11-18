import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { forbidsCartMutation, isCartChangingAction } from '../src/lib/ai-cart-safety.ts';
import { isOrderStatusQuestion, isOrderRepeatCommand, selectRequestedOrder } from '../src/lib/ai-order-question.ts';
import { resolveConversationContext, conversationArchive } from '../src/lib/ai-conversation-context.ts';
import { readAiJson, aiRequestErrorMessage } from '../src/lib/ai-http-response.ts';

// Executes the real browser dispatcher with fake DOM/network boundaries.
// This covers branches before the API call; it does not replace visual QA.
export async function browserFlow(pathname = '/', savedSession: any = null, responseOverride?:()=>Promise<Response>) {
  const pageUrl = new URL(pathname, 'http://localhost');
  const source = await readFile(new URL('../src/scripts/ai-sales-assistant.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('  async function unifiedAsk('), source.indexOf('  function looksLikeShopping('));
  assert.ok(code.length > 1000);
  let persisted: any = null;
  const hydration = savedSession ? vm.runInNewContext(
    source.slice(source.indexOf('  const state = { busy:'), source.indexOf('  function trackEvent(')) + '; ({state, saveCommerceSession})',
    { saved: savedSession, conversationArchive, SESSION_KEY: 'tm_ai_tomas_state_v1', messages: { innerHTML: '' }, sessionStorage: { setItem: (_key: string, value: string) => { persisted = JSON.parse(value); } } },
  ) : null;
  const state: any = hydration?.state || { mode: 'advice', busy: false, cart: [], commerceState: emptyCommerceState('browser-flow'), profile: { lastOrder: { products: [{ id: 'old', name: 'Old product' }] } } };
  const calls: string[] = [], messages: any[] = [], errors: unknown[] = [], requests: any[] = [];
  let verifications = 0;
  const presentation:any[]=[];
  const noop = () => {};
  const scope: any = {
    state, isOrderStatusQuestion, isOrderRepeatCommand, selectRequestedOrder, forbidsCartMutation, isCartChangingAction, resolveConversationContext, conversationArchive,readAiJson,aiRequestErrorMessage,
    beginSession: noop, looksLikeShopping: () => false, escapeHtml: (v: unknown) => String(v),
    addMessage: (role: string, html: string) => { const node = { role, innerHTML: html, textContent: 'response', scrollIntoView: noop }; messages.push(node); return node; },
    renderGuestOrderVerification: () => { verifications++; },
    addCommerceItem: (product: any, qty: number) => state.cart.push({ product, qty }),
    askNextStep: noop, trackEvent: noop, autoPanelSize: noop, setExperience: noop,
    textToHtml: (lines: string[]) => lines.join(' '), appendSources: noop, attachFeedback: (target:any)=>presentation.push({kind:'feedback',target}),
    openHandoff: noop, renderCommerceResults: (_data:any,options:any)=>presentation.push({kind:'products',target:options?.target}), renderSafeProducts: noop,
    cartKey: (p: any) => p.id, updateLiveCart: noop, quantityChooser: noop, renderTypeQuestion: noop,
    renderCart: noop, prepareHandoff: noop, saveCommerceSession: hydration?.saveCommerceSession || noop, requestAnimationFrame: (fn: () => void) => fn(),
    location: { pathname: pageUrl.pathname, search: pageUrl.search }, URLSearchParams, console: { error: (...args: any[]) => errors.push(args) },
    fetch: async (url: string, options: any) => {
      calls.push(url);
      if (url === '/api/ai-order-status') return Response.json({ ok: true, orders: [{ number: '300950', statusLabel: 'Nová' }, { number: '300945', statusLabel: 'Vybavená' }] });
      assert.equal(url, '/api/ai-tomas');
      requests.push(JSON.parse(options.body));
      if(responseOverride)return responseOverride();
      return POST({ request: new Request(`http://localhost${url}`, options) } as any);
    },
  };
  const ask = vm.runInNewContext(`${code}; unifiedAsk`, scope);
  return { ask, state, calls, messages, errors, requests,presentation, verifications: () => verifications, persisted: () => persisted };
}
