import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { POST, forbidsCartMutation, samePrinterModel } from '../src/pages/api/ai-tomas.ts';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
import { searchCommerce } from '../src/lib/ai-commerce/engine.ts';
import { isOrderStatusQuestion } from '../src/lib/ai-order-question.ts';

async function askApi(message:string,state:any=emptyCommerceState('audit-regression')){
  const request=new Request('http://localhost/api/ai-tomas',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,page:'/',state})});
  const response=await POST({request} as any);
  assert.equal(response.status,200);
  return response.json() as Promise<any>;
}

test('výslovný zákaz košíka nevytvorí nákupný intent',()=>{
  const message='Ukáž mi kompletnú Canon CRG-069H CMYK sadu, ale nič nepridávaj do košíka.';
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(forbidsCartMutation(message),true);
  assert.equal(route.intents.includes('BUY_INTENT'),false);
  assert.equal(route.intents.includes('CART'),false);
  assert.equal(route.intents.includes('CHECKOUT'),false);
});

test('samotné nejednoznačné číslo nie je interné SKU',()=>{
  const route=routeCommerceMessage('711',emptyCommerceState());
  assert.equal(route.productQuery,null);
  assert.equal(route.needsProducts,false);
  assert.equal(routeCommerceMessage('SKU 711',emptyCommerceState()).productQuery,'711');
});

test('server pri zákaze zachová aj existujúci košík',async()=>{
  const state={...emptyCommerceState('cart-safety'),cart:[{id:'original',sku:'OLD',quantity:2}]};
  const result=await askApi('Chcem kúpiť 1 ks kompatibilného HP CF280X, ale nič nepridávaj do košíka, iba mi ho ukáž.',state);
  assert.deepEqual(result.state.cart,state.cart);
  assert.equal(result.action,null);
  assert.match(result.advisor.answer.join(' '),/nič som nepridal/i);
});

test('AI nevytvorí CRG-069H sadu zo štyroch samostatných tonerov',async()=>{
  const result=await askApi('Pridaj 1 kompletnú kompatibilnú vysokokapacitnú Canon CRG-069H CMYK sadu do košíka.');
  assert.notEqual(result.action?.kind,'ADD_BUNDLE_TO_CART');
  assert.equal(result.action,null);
  assert.equal(result.state.cart.length,0);
  assert.match(result.advisor.answer.join(' '),/katalógový produkt|nespojil do falošnej sady/i);
});

test('hotová katalógová CMYK sada nie je jednotlivá farba ani duplikát',async()=>{
  const result=await searchCommerce('Brother BT5000');
  const packaged=result.products.find((p:any)=>p.package_shape==='set');
  assert.ok(packaged);
  assert.equal(packaged.color,'cmyk');
  const matching=result.presentation.sets.filter((set:any)=>set.products.some((p:any)=>String(p.id)===String(packaged.id)));
  assert.equal(matching.length,1);
  assert.equal(matching[0].packageKind,'catalog');
  assert.equal(matching[0].products.length,1);
});

test('Epson L3250 a Epson EcoTank L3250 sú ten istý model',()=>{
  assert.equal(samePrinterModel('Epson L3250','Epson EcoTank L3250'),true);
  assert.equal(samePrinterModel('Epson L3250','Epson L3260'),false);
});

test('všeobecná otázka vysvetlí toner verzus atrament',async()=>{
  const result=await buildAssistantAnswer('Aký je rozdiel medzi tonerom a atramentom?');
  assert.equal(result.intent,'support');
  assert.match(result.answer.join(' '),/Laserové tlačiarne používajú toner/);
});

test('bodky na papieri dostanú diagnostickú odpoveď',async()=>{
  const result=await buildAssistantAnswer('Na papieri sa mi opakujú čierne bodky. Čo mám robiť?');
  assert.equal(result.intent,'diagnostic');
  assert.match(result.answer.join(' '),/optický valec|poškodený toner/);
});

test('storno pred expedíciou uvedie aj refundáciu',async()=>{
  const question='Chcem zrušiť zaplatenú objednávku ešte pred expedíciou. Kedy dostanem peniaze späť?';
  assert.equal(isOrderStatusQuestion(question),false);
  assert.equal(isOrderStatusQuestion('Kde je moja objednávka 301007?'),true);
  const result=await buildAssistantAnswer(question);
  assert.equal(result.intent,'order');
  assert.match(result.answer.join(' '),/refundáciu odošleme bez zbytočného odkladu/);
  assert.match(result.answer.join(' '),/info@tonerymaxim\.sk/);
});

test('otázka na IČO vráti identitu predávajúceho',async()=>{
  const result=await buildAssistantAnswer('Aké je vaše IČO?');
  assert.equal(result.faq,'predavajuci-firma');
  assert.match(result.answer.join(' '),/IČO 37 328 344/);
});

test('server nevytvára skladané balíky a prehliadač zachová poistku zákazu košíka',async()=>{
  const [source,api]=await Promise.all([
    readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8'),
    readFile(new URL('../src/pages/api/ai-tomas.ts',import.meta.url),'utf8'),
  ]);
  assert.doesNotMatch(api,/ADD_BUNDLE_TO_CART/);
  assert.match(source,/forbidsCartMutation\(question\)/);
  assert.match(source,/state\.cart=uiCartBefore/);
});
