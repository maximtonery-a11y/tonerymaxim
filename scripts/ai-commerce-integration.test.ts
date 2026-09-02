import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { normalizeCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { productCapacity, productColor } from '../src/lib/ai-commerce/catalog.ts';
import { familyOf } from '../src/lib/ai-commerce/engine.ts';
import { isOrderStatusQuestion } from '../src/lib/ai-order-question.ts';

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
 for(const message of ['Môžem platiť v hotovosti?','Máte možnosť osobného odberu?','Ako prebieha reklamácia?','Ako môžem reklamovať chybný toner?','Kedy mi príde objednávka?','Kde vás nájdem a kedy máte otvorené?','Koľko stojí doprava?']){
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

test('explicitné krátke číselné SKU sa dá vyhľadať bez zámeny za objednávku',()=>{
 for(const question of ['Chcem kúpiť SKU 276','Máte 276?','Prosím, nájdite presne 276.']){
  const route=routeCommerceMessage(question,normalizeCommerceState({}));
  assert.equal(route.needsProducts,true,question);
  assert.equal(route.productQuery,'276',question);
 }
 const composite=routeCommerceMessage('Máte DR-1050-KOM-13968?',normalizeCommerceState({}));
 assert.equal(composite.needsProducts,true);
 assert.match(String(composite.productQuery),/DR-1050-KOM-13968/i);
 assert.notEqual(composite.productQuery,'1050');
});

test('diáre zobrazia všetky štyri typy a rýchly nákup bez tonerovej kapacity',async()=>{
 const js=await readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
 const css=await readFile(new URL('../src/styles/ai-sales-assistant.css',import.meta.url),'utf8');
 assert.match(js,/if\(calendarList\)[\s\S]*chosen\.length>=4/);
 assert.match(js,/const capacity=calendar\?0:parseCapacity\(product\)/);
 assert.match(js,/is-calendar-list/);
 assert.match(css,/is-calendar-list[\s\S]*repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(js,/data-ai-buy/);
 assert.match(js,/quantityChooser\(ordered\[Number\(btn\.dataset\.aiBuy\)\]\)/);
});

test('zisťovanie dostupnosti jasne vyžaduje telefón alebo e-mail',async()=>{
 const [component,js]=await Promise.all([
  readFile(new URL('../src/components/FloatingAdvisor.astro',import.meta.url),'utf8'),
  readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8'),
 ]);
 assert.doesNotMatch(component,/Telefón \(voliteľné\)|E-mail \(voliteľné\)/);
 assert.match(component,/Zadajte aspoň telefón alebo e-mail/);
 assert.match(js,/reason==='product_availability'/);
 assert.match(js,/Produkt nie je skladom\. Zadajte telefón alebo e-mail/);
 assert.match(js,/Chýba kontakt: zadajte telefón alebo e-mail/);
 assert.match(js,/Pred odoslaním potvrďte súhlas s kontaktovaním/);
});

test('slovenské otázky na stav objednávky vždy otvoria bezpečné overenie',()=>{
 const questions=[
  'V akom stave je moja objednávka?',
  'Kde je moja objednávka?',
  'Bola už objednávka odoslaná?',
  'Kedy bude zásielka doručená?',
  'Chcem sledovať zásielku.',
  'Čo je s mojím balíkom?',
  'Je moja objednávka vybavená?',
  'Zistiť stav objednávky',
  'Zisti stav',
  'Over mi stav objednávky 300945',
  'Skontroluj stav objednávky',
  'Kde je objednávka 300945?',
 ];
 for(const question of questions)assert.equal(isOrderStatusQuestion(question),true,question);
 for(const question of ['Ako vytvorím objednávku?','Koľko stojí doprava?','Chcem objednať toner.','Zisti stav skladu','Je toner skladom?'])assert.equal(isOrderStatusQuestion(question),false,question);
});

test('výber typu hovorí o variantoch, nie o kusoch na sklade, a má kompaktnú spoločnú zľavu',async()=>{
 const js=await readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
 assert.match(js,/Máme \$\{count\} produktové varianty/);
 assert.doesNotMatch(js,/\$\{Number\(counts\[type\]\|\|0\)\} \$\{material\} skladom/);
 assert.match(js,/tm-ai-type-benefit/);
 assert.match(js,/pri 2–3 ks 10 % · pri 4 a viac ks 25 %/);
});

test('tlačidlo Stav objednávky vynúti bezpečné overenie a nejde do poradne',async()=>{
 const js=await readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
 assert.match(js,/const forceOrderStatus=buttonLabel==='stav objednavky'/);
 assert.match(js,/unifiedAsk\(question,\{forceOrderStatus\}\)/);
 assert.match(js,/options\.forceOrderStatus===true\|\|isOrderStatusQuestion\(question\)/);
});
