import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { normalizeCommerceState } from '../src/lib/ai-commerce/domain.ts';

test('UI používa jednotný endpoint a persistentný state',async()=>{
 const js=await readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
 assert.match(js,/fetch\('\/api\/ai-tomas'/);assert.match(js,/sessionStorage\.setItem\(SESSION_KEY/);
 assert.match(js,/\/api\/ai-commerce\/cart-validate/);
});
test('capabilities nesľubujú neimplementované externé adaptéry',async()=>{
 const engine=await readFile(new URL('../src/lib/ai-commerce/engine.ts',import.meta.url),'utf8');
 assert.doesNotMatch(engine,/channels:\s*\[[^\]]*ucp-ready/);assert.match(engine,/ucp:\s*'planned'/);
});
test('zakázané produkty filtruje server',async()=>{
 const catalog=await readFile(new URL('../src/lib/ai-commerce/catalog.ts',import.meta.url),'utf8');
 for(const rule of ['hatona','no[\\s_-]*chip','sluzba\\s+renovacia'])assert.ok(catalog.includes(rule));
});

test('servisná otázka po produktoch nepoužije starý katalógový dopyt',()=>{
 const state=normalizeCommerceState({lastProductQuery:'CRG054',currentPrinter:'Canon i-SENSYS LBP623Cdw',pendingQuestion:'quantity'});
 for(const message of ['Môžem platiť v hotovosti?','Máte možnosť osobného odberu?','Ako prebieha reklamácia?','Koľko stojí doprava?']){
  const route=routeCommerceMessage(message,state);
  assert.equal(route.needsProducts,false,message);
  assert.equal(route.productQuery,null,message);
  assert.ok(route.intents.includes('POLICY'),message);
 }
 assert.equal(state.pendingQuestion,'quantity','otázka nesmie zrušiť rozpracovaný nákup');
});

test('po servisnej otázke možno pokračovať množstvom aj novým produktom',()=>{
 const state=normalizeCommerceState({lastProductQuery:'CRG054',pendingQuestion:'quantity'});
 const quantity=routeCommerceMessage('2 ks',state);
 assert.equal(quantity.productQuery,'CRG054');
 assert.equal(quantity.needsProducts,true);
 const product=routeCommerceMessage('hľadám toner CRG054H',state);
 assert.equal(product.needsProducts,true);
 assert.match(String(product.productQuery),/CRG054H/i);
});
