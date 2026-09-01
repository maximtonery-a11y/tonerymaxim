import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { normalizeCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { productCapacity, productColor } from '../src/lib/ai-commerce/catalog.ts';
import { familyOf } from '../src/lib/ai-commerce/engine.ts';

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

test('kompaktná cache zachová farby, kapacitu a Epson rodinu náplní',()=>{
 const fixtures=[
  {name:'Epson T9081XL',sku:'T9081XL',color:'Čierna',capacity:'5 000 strán'},
  {name:'Epson T9082XL',sku:'T9082XL',color:'Azúrová',capacity:'4 000 strán'},
  {name:'Epson T9083XL',sku:'T9083XL',color:'Purpurová',capacity:'4 000 strán'},
  {name:'Epson T9084XL',sku:'T9084XL',color:'Žltá',capacity:'4 000 strán'},
 ];
 assert.deepEqual(fixtures.map(productColor),['black','cyan','magenta','yellow']);
 assert.equal(productCapacity(fixtures[0]),'5 000 strán');
 assert.deepEqual(new Set(fixtures.map(familyOf)),new Set(['EPSON-T908XL']));
});

test('prirodzená požiadavka na WF-6090 routuje iba čistý model tlačiarne',()=>{
 const route=routeCommerceMessage('Hľadám náplne do tlačiarne Epson WF-6090',normalizeCommerceState({}));
 assert.equal(route.needsProducts,true);
 assert.equal(route.productQuery,'Epson WF-6090');
 assert.ok(route.intents.includes('PRINTER_SEARCH'));
});
