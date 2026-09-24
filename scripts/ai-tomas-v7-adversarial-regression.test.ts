import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { forbidsCartMutation, isCartChangingAction } from '../src/lib/ai-cart-safety.ts';
import { isOrderStatusQuestion } from '../src/lib/ai-order-question.ts';
import { searchCommerce } from '../src/lib/ai-commerce/engine.ts';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';

async function ask(message:string,state:any=emptyCommerceState('v7-adversarial')){
  const request=new Request('http://localhost/api/ai-tomas',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,page:'/',state})});
  const response=await POST({request} as any);
  assert.equal(response.status,200,message);
  return response.json() as Promise<any>;
}

const hardCartProhibitions=[
  'Chcem HP CF280X, ale do košíka ho nepridávať.',
  'Ukáž HP CF280X bez toho, aby sa vložil do košíka.',
  'Nechcem, aby ste HP CF280X dali do košíka.',
  'Košíka sa nedotýkajte, iba ukážte HP CF280X.',
  'Košík ponechajte bez zmeny a ukážte HP CF280X.',
  'HP CF280X iba informatívne, nič nekupujte.',
  'Prosím iba cenu HP CF280X, bez nákupu.',
  'HP CF280X áno, ale žiadne pridávanie do košíka.',
  'Nepridať do košíka. Iba zobraziť HP CF280X.',
  'Nevytvárajte objednávku, len ukážte HP CF280X.',
  'Nechcem nákup meniť, iba porovnať HP CF280X.',
  'Zákaz úprav košíka, ukážte HP CF280X.',
  'Chcem len informácie, nič s košíkom nerobte.',
  'Košík nesmie byť zmenený.',
  'Nechajte môj nákup tak.',
  'Iba ukázať, nie pridávať.',
  'Nekupovať, len porovnať HP CF280X.',
  'Bez vloženia čohokoľvek do môjho nákupu.',
  'Neželám si pridať produkt do košíka.',
  'Prosím nezasahovať do košíka.',
  'Košík neupravovať.',
  'Žiadna zmena nákupu.',
  'Nepridávajte automaticky.',
  'Len mi to nájdite, nekupujte to.',
  'CHCEM KÚPIŤ HP CF280X, ALE NIČ NEPRIDÁVAJTE!',
  'Chcem kupit HP CF280X, no nevkladat do kosika.',
  'Daj mi cenu, avšak produkt do nákupu nedávajte.',
  'Nič neobjednať; iba ukázať dostupnosť.',
  'Kompletnú CRG-069H sadu len zobrazte, nepridajte ju.',
  'Štyri farby CRG-069H porovnajte, ale nekupujte ich.',
];

for(const [index,message] of hardCartProhibitions.entries())test(`silný zákaz košíka ${index+1}`,async()=>{
  assert.equal(forbidsCartMutation(message),true,message);
  const initial=[{id:'keep-a',sku:'KEEP-A',quantity:2},{id:'keep-b',sku:'KEEP-B',quantity:5}];
  const result=await ask(message,{...emptyCommerceState(`ban-${index}`),cart:initial});
  assert.deepEqual(result.state.cart,initial,message);
  assert.equal(isCartChangingAction(result.action?.kind),false,message);
  assert.equal(result.route.intents.includes('BUY_INTENT'),false,message);
  assert.equal(result.route.intents.includes('CART'),false,message);
  assert.equal(result.route.intents.includes('CHECKOUT'),false,message);
});

const legitimateCartRequests=[
  'Pridaj HP CF280X do košíka.',
  'Ukáž košík.',
  'Chcem kúpiť 2 ks HP CF280X.',
  'Porovnaj bez zmeny farby HP CF280X.',
  'Produkt bez čipu pridaj do košíka.',
  'Zmeň farbu filtra na čiernu.',
  'Nemenovaný produkt mi ukáž.',
  'Objednaj jednu kompatibilnú CRG-069H CMYK sadu.',
  'Daj mi do nákupu 4 ks HP CF280X.',
  'Pokračovať do pokladne.',
];
for(const [index,message] of legitimateCartRequests.entries())test(`poistka nemá falošný poplach ${index+1}`,()=>{
  assert.equal(forbidsCartMutation(message),false,message);
});

const ambiguousNumbers=[
  '711','Hľadám 711','Ukáž mi 711','Potrebujem produkt 711',
  'číslo objednávky 301007','telefón 0900123456','PSČ 97405',
];
for(const message of ambiguousNumbers)test(`holé číslo nie je interné SKU: ${message}`,()=>{
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(route.productQuery,null,message);
  assert.equal(route.needsProducts,false,message);
});

for(const message of ['SKU 711','sku:301007','SKU-97405','kód produktu 1326','KOD PRODUKTU: 2027'])test(`číselné SKU iba s označením: ${message}`,()=>{
  const expected=message.match(/\d{3,12}/)?.[0];
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(route.productQuery,expected,message);
  assert.equal(route.needsProducts,true,message);
});

const nonStatusOrderQuestions=[
  'Zrušte objednávku 301007.',
  'Stornovať objednávku pred expedíciou.',
  'Chcem zmeniť objednávku 301007.',
  'Upravte položky v objednávke.',
  'Kedy vrátite peniaze za objednávku?',
  'Žiadam refundáciu platby.',
  'Chcem odstúpiť od objednávky.',
  'Potrebujem reklamovať objednávku.',
  'Zmeňte adresu objednávky.',
  'Opravte telefón v objednávke.',
];
for(const message of nonStatusOrderQuestions)test(`servisná zmena nie je zisťovanie stavu: ${message}`,()=>{
  assert.equal(isOrderStatusQuestion(message),false,message);
});

const realStatusQuestions=[
  'Kde je moja objednávka?',
  'Zisti stav objednávky 301007.',
  'Sleduj zásielku 301007.',
  'Bola už objednávka odoslaná?',
  'Je balík pripravený?',
  'Čo je s objednávkou 301007?',
  'Over mi prosím stav objednávky.',
  'Tracking zásielky 301007.',
];
for(const message of realStatusQuestions)test(`skutočná otázka na stav: ${message}`,()=>{
  assert.equal(isOrderStatusQuestion(message),true,message);
});

for(const message of ['Kedy bude objednávka doručená?','Ako dlho trvá doručenie objednávky?','Koľko trvá dodanie?'])test(`všeobecná lehota nežiada súkromný stav: ${message}`,()=>{
  assert.equal(isOrderStatusQuestion(message),false,message);
});

test('zakázaná voľba typu po rozpracovanom nákupe nepridá uložené množstvo',async()=>{
  const first=await ask('Pridaj 2 ks HP CF280X do košíka.',emptyCommerceState('pending-ban'));
  assert.equal(first.action?.kind,'ASK_PRODUCT_TYPE');
  assert.equal(first.state.pendingQuestion,'product_type');
  const second=await ask('Kompatibilný iba ukáž, do košíka ho nepridávať.',first.state);
  assert.deepEqual(second.state.cart,[]);
  assert.equal(isCartChangingAction(second.action?.kind),false);
  assert.equal(second.state.pendingQuestion,null);
});

test('povolená voľba typu po rozpracovanom nákupe pridá uložené množstvo',async()=>{
  const first=await ask('Pridaj 2 ks HP CF280X do košíka.',emptyCommerceState('pending-allow'));
  assert.equal(first.action?.kind,'ASK_PRODUCT_TYPE');
  const second=await ask('Kompatibilný.',first.state);
  assert.equal(second.action?.kind,'ADD_TO_CART');
  assert.equal(second.action?.quantity,2);
  assert.equal(second.state.cart[0]?.quantity,2);
});

const crg069Catalog=await searchCommerce('Canon CRG-069H');
const realCrg069Set=crg069Catalog.products.find((product:any)=>product.sku==='SET-CAN-CRG-069H-KOM-4PK'&&product.package_shape==='set');

for(const quantity of [1,2,3,4,5,9,20,99])test(`CMYK požiadavka ${quantity} použije jeden reálny produkt sady`,async()=>{
  const result=await ask(`Pridaj ${quantity} ks kompletnej kompatibilnej Canon CRG-069H CMYK sady do košíka.`,emptyCommerceState(`bundle-${quantity}`));
  assert.notEqual(result.action?.kind,'ADD_BUNDLE_TO_CART');
  if(realCrg069Set){
    assert.equal(result.action?.kind,'ADD_TO_CART');
    assert.equal(result.action?.product?.sku,realCrg069Set.sku);
    assert.equal(result.action?.product?.package_shape,'set');
    assert.equal(result.action?.quantity,quantity);
    assert.equal(result.state.cart.length,1);
    assert.equal(result.state.cart[0]?.quantity,quantity);
  }else{
    assert.equal(result.action?.kind,undefined);
    assert.deepEqual(result.state.cart,[]);
  }
});

test('opakované pridanie rovnakého produktu bez množstva ho nezdvojí',async()=>{
  const first=await ask('Pridaj 1 ks kompatibilného HP CF280X do košíka.',emptyCommerceState('duplicate'));
  assert.equal(first.action?.kind,'ADD_TO_CART');
  assert.equal(first.state.cart[0]?.quantity,1);
  const second=await ask('Pridaj ho do košíka.',first.state);
  assert.equal(second.action?.kind,'OPEN_CART');
  assert.equal(second.state.cart.length,1);
  assert.equal(second.state.cart[0]?.quantity,1);
});

test('opakované pridanie s výslovným množstvom zvýši existujúci riadok',async()=>{
  const first=await ask('Pridaj 1 ks kompatibilného HP CF280X do košíka.',emptyCommerceState('increment'));
  const second=await ask('Pridaj ešte 2 ks.',first.state);
  assert.equal(second.action?.kind,'ADD_TO_CART');
  assert.equal(second.state.cart.length,1);
  assert.equal(second.state.cart[0]?.quantity,3);
});

test('zmena témy na platbu počas výberu typu nepridá produkt',async()=>{
  const first=await ask('Pridaj 2 ks HP CF280X do košíka.',emptyCommerceState('topic-payment'));
  assert.equal(first.state.pendingQuestion,'product_type');
  const second=await ask('Môžem zaplatiť dobierkou?',first.state);
  assert.deepEqual(second.state.cart,[]);
  assert.equal(second.route.intents.includes('POLICY'),true);
  assert.equal(isCartChangingAction(second.action?.kind),false);
});

test('zmena témy na storno počas výberu typu nepridá produkt',async()=>{
  const first=await ask('Pridaj 2 ks HP CF280X do košíka.',emptyCommerceState('topic-cancel'));
  const second=await ask('Ako stornujem inú objednávku?',first.state);
  assert.deepEqual(second.state.cart,[]);
  assert.equal(isCartChangingAction(second.action?.kind),false);
});

for(const message of ['Zrušte objednávku pred expedíciou.','Ako stornujem zaplatenú objednávku?','Chcem zmeniť objednávku pred odoslaním.'])test(`storno odpoveď prizná hranice AI: ${message}`,async()=>{
  const result=await buildAssistantAnswer(message);
  const answer=result.answer.join(' ');
  assert.equal(result.intent,'order',message);
  assert.match(answer,/AI Tomáš objednávku sám nezruší ani nezmení/i,message);
  assert.match(answer,/info@tonerymaxim\.sk/i,message);
});

test('hotová katalógová sada zostane jedinou položkou',async()=>{
  const result=await ask('Pridaj 3 ks Brother BT6000/BT5000 CMYK kompatibilnej sady do košíka.',emptyCommerceState('catalog-pack'));
  assert.equal(result.action?.kind,'ADD_TO_CART');
  assert.equal(result.action?.product?.sku,'SET-BRO-BT6000-BT5000-KOM');
  assert.equal(result.action?.quantity,3);
  assert.equal(result.state.cart.length,1);
  assert.equal(result.state.cart[0]?.quantity,3);
});
