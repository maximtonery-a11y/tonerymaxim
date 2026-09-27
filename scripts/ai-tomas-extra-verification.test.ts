import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { POST, requestedQuantity } from '../src/pages/api/ai-tomas.ts';
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


async function apiAsk(message: string, state: any = emptyCommerceState('extra-audit')) {
 const response=await POST({request:new Request('http://localhost/api/ai-tomas',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,state})})} as any);
 assert.equal(response.status,200,message);return response.json();
}
const initialCart=[{id:'keep',sku:'KEEP',quantity:2}];
for(const message of [
 'Ako môžem objednať 2 ks kompatibilného Brother TN-2421?',
 'Je možné pridať 2 ks kompatibilného Brother TN-2421 do košíka?',
 'Dá sa kúpiť 2 ks kompatibilného Brother TN-2421?',
 'Koľko stojí kúpiť 2 ks kompatibilného Brother TN-2421?',
 'Chcem kúpiť 2 ks kompatibilného Brother TN-2421 až po potvrdení ceny.',
 'Pridaj 2 ks kompatibilného Brother TN-2421 až keď ti to potvrdím.',
])test('informačná alebo podmienená veta nemení košík: '+message,async()=>{
 const result=await apiAsk(message,{...emptyCommerceState('info'),cart:initialCart});
 assert.deepEqual(result.state.cart,initialCart,message);
 assert.equal(['ADD_TO_CART','ADD_BUNDLE_TO_CART','OPEN_CHECKOUT'].includes(result.action?.kind),false,message);
});
for(const message of [
 'Zopakuj poslednú objednávku až keď ti to potvrdím.',
 'Zatiaľ iba vysvetli príkaz: zopakuj poslednú objednávku.',
 'Zopakuj objednávku 300945.',
 'Zopakuj objednávku TM-300945.',
])test('dispatcher nepoužije inú ani nepotvrdenú objednávku: '+message,async()=>{
 const flow=await browserFlow();flow.state.profile.lastOrder.number='300950';await flow.ask(message);
 assert.deepEqual(flow.state.cart,[],message);assert.deepEqual(flow.errors,[]);
});
for(const message of ['Pridaj 0 ks Brother TN-2421.','Pridaj -2 ks Brother TN-2421.','Pridaj 1,5 ks Brother TN-2421.','Pridaj 1.5 ks Brother TN-2421.'])test('neplatné množstvo sa nesmie zmeniť na kladný počet: '+message,()=>assert.equal(requestedQuantity(message),null,message));
for(const [message,quantity] of [
 ['Pridaj mi 2 ks Canon GI-41.',2],['Objednaj 3 Brother TN-2421.',3],
 ['Pridaj jednu Epson 104 CMYK sadu (4 ks).',1],['4 ks',4],
 ['Pridaj Canon GI-41.',null],['Pridaj Canon PG-40.',null],
] as const)test('množstvo a OEM: '+message,()=>assert.equal(requestedQuantity(message),quantity));
test('rozpracované množstvo sa nepotvrdí otázkou na cenu dvoch kusov',async()=>{
 const first=await apiAsk('Pridaj kompatibilný Brother TN-2421.');
 const result=await apiAsk('Koľko budú stáť 2 kusy?',{...first.state,cart:initialCart,pendingQuestion:'quantity'});
 assert.deepEqual(result.state.cart,initialCart);assert.notEqual(result.action?.kind,'ADD_TO_CART');
});
test('zákaz košíka a servisné otázky zrušia rozpracovaný nákup',async()=>{
 for(const message of ['Nič nepridávaj, chcem len cenu.','Chcem vrátiť nepoužitý toner.','Ako zaplatím kartou?','Chcem človeka.']){
  const first=await apiAsk('Pridaj kompatibilný Brother TN-2421.');
  const result=await apiAsk(message,{...first.state,cart:initialCart,pendingQuestion:'quantity'});
  assert.deepEqual(result.state.cart,initialCart,message);assert.notEqual(result.action?.kind,'ADD_TO_CART',message);assert.equal(result.state.pendingQuestion,null,message);
 }
});
for(const message of [
 'Doručili zásielku, ale ja ju nemám.',
 'Objednávka bola doručená, ale ja som nič neprevzala.',
 'Balík je doručený, ale zásielka sa ku mne nedostala.',
])test('alternatívny opis nedoručeného balíka neotvorí inú objednávku: '+message,async()=>{
 const flow=await browserFlow();await flow.ask(message);
 assert.equal(flow.calls.includes('/api/ai-order-status'),false,message);
 assert.match(flow.messages.at(-1).innerHTML,/dopravc|kuriér|GPS|odovzdan/i,message);
 assert.deepEqual(flow.state.cart,[]);assert.deepEqual(flow.errors,[]);
});
test('dlhší rozhovor drží najviac 20 správ a zachová pôvodný košík',async()=>{
 let state={...emptyCommerceState('long'),cart:initialCart};
 const phrases=['Canon PFI-102','Podávač papiera cvaká.','Chcem kompletný prehľad dopravy a platby.','Chcem vrátiť nepoužitý toner.','HP M455dn','Koľko stojí doprava?'];
 for(let i=0;i<36;i++){
  const message=phrases[i%phrases.length];const result=await apiAsk(message,state);
  assert.deepEqual(result.state.cart,initialCart,message);assert.ok(result.state.history.length<=20);
  assert.notEqual(result.action?.kind,'ADD_TO_CART');state=result.state;
 }
});

for(const value of ['0','-2','−2','- 2','1,5','1.5','2.0','1-2','100','nula'])test('API odmietne neplatné množstvo a prijme následnú opravu: '+value,async()=>{
 const bad=await apiAsk(`Pridaj ${value} ks kompatibilného Brother TN-2421.`,{...emptyCommerceState('invalid'),cart:initialCart});
 assert.deepEqual(bad.state.cart,initialCart);assert.equal(bad.action?.kind,'CLARIFY_QUANTITY');
 const good=await apiAsk('2 ks',bad.state);
 assert.equal(good.action?.kind,'ADD_TO_CART');assert.equal(good.action.quantity,2);
 assert.equal(good.state.cart.find((p:any)=>p.sku==='KEEP')?.quantity,2);
});

test('dispatcher dovolí opakovanie presne načítanej objednávky podľa čísla',async()=>{
 const flow=await browserFlow();flow.state.profile.lastOrder.number='300945';
 await flow.ask('Zopakuj objednávku TM-300945.');assert.equal(flow.state.cart.length,1);assert.deepEqual(flow.errors,[]);
});

test('po prechode na človeka číslo dva nepokračuje v starom nákupe',async()=>{
 const first=await apiAsk('Pridaj kompatibilný Brother TN-2421.');
 const handoff=await apiAsk('Chcem človeka.',{...first.state,cart:initialCart,pendingQuestion:'quantity'});
 assert.equal(handoff.commerce,null);assert.equal(handoff.action?.kind,'OPEN_HANDOFF');
 const follow=await apiAsk('2 ks',handoff.state);
 assert.deepEqual(follow.state.cart,initialCart);assert.notEqual(follow.action?.kind,'ADD_TO_CART');
});

for(const message of [
 'Ak je skladom, pridaj 2 ks kompatibilného Brother TN-2421.',
 'Pridaj 2 ks kompatibilného Brother TN-2421, ak cena nepresiahne 5 eur.',
 'Čo znamená pridať 2 ks kompatibilného Brother TN-2421 do košíka?',
 'Môžete mi povedať, či sa dá objednať 2 ks kompatibilného Brother TN-2421?',
 'Chcem vedieť, či môžem kúpiť 2 ks kompatibilného Brother TN-2421.',
])test('nevykonaná podmienka alebo otázka na význam nie je súhlas: '+message,async()=>{
 const result=await apiAsk(message,{...emptyCommerceState('conditional'),cart:initialCart});
 assert.deepEqual(result.state.cart,initialCart);assert.notEqual(result.action?.kind,'ADD_TO_CART');
});
