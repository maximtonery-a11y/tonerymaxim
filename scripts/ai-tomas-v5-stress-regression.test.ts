import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { forbidsCartMutation } from '../src/lib/ai-cart-safety.ts';
import { isOrderStatusQuestion } from '../src/lib/ai-order-question.ts';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
import { searchCommerce } from '../src/lib/ai-commerce/engine.ts';

async function ask(message:string,state:any=emptyCommerceState('v5-stress')){
  const request=new Request('http://localhost/api/ai-tomas',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,page:'/',state})});
  const response=await POST({request} as any);
  assert.equal(response.status,200,message);
  return response.json() as Promise<any>;
}

const cartProhibitions=[
  'Ukáž mi HP CF280X, ale nič mi nepridávaj do košíka.',
  'Chcem kúpiť HP CF280X, no nedávaj ho do košíka.',
  'Zobraz HP CF280X bez pridania do košíka.',
  'HP CF280X iba ukáž, zakazujem manipuláciu s košíkom.',
  'Potrebujem HP CF280X, neobjednávaj ho.',
  'Nič neobjednávaj, iba mi ukáž HP CF280X.',
  'Nechcem HP CF280X pridať do košíka, iba ho porovnaj.',
  'Ukáž kompatibilný HP CF280X bez vloženia do nákupu.',
  'Chcem vidieť HP CF280X, neupravuj môj nákup.',
  'HP CF280X áno, ale nevkladaj žiadnu položku.',
];

for(const [index,message] of cartProhibitions.entries())test(`zákaz košíka ${index+1}: ${message}`,async()=>{
  assert.equal(forbidsCartMutation(message),true);
  const initial=[{id:'keep-1',sku:'KEEP',quantity:3}];
  const result=await ask(message,{...emptyCommerceState(`cart-${index}`),cart:initial});
  assert.deepEqual(result.state.cart,initial);
  assert.notEqual(result.action?.kind,'ADD_TO_CART');
  assert.notEqual(result.action?.kind,'ADD_BUNDLE_TO_CART');
  assert.equal(result.route.intents.includes('BUY_INTENT'),false);
});

const syntheticSetRequests=[
  'Pridaj 1 kompletnú kompatibilnú vysokokapacitnú Canon CRG-069H CMYK sadu do košíka.',
  'Objednaj mi jednu kompatibilnú CMYK sadu Canon CRG-069H.',
  'Chcem kúpiť kompletný set BK C M Y Canon CRG-069H kompatibilný.',
  'Daj mi do košíka všetky štyri farby CRG-069H, kompatibilné.',
  'Pridaj kompletnú 4-farebnú kompatibilnú sadu CRG-069H.',
];

const crg069Catalog=await searchCommerce('Canon CRG-069H');
const realCrg069Set=crg069Catalog.products.find((product:any)=>product.sku==='SET-CAN-CRG-069H-KOM-4PK'&&product.package_shape==='set');

function assertRealCrg069SetOrSafeAbsence(result:any,message:string,quantity=1){
  assert.notEqual(result.action?.kind,'ADD_BUNDLE_TO_CART',message);
  if(realCrg069Set){
    assert.equal(result.action?.kind,'ADD_TO_CART',message);
    assert.equal(result.action?.product?.sku,realCrg069Set.sku,message);
    assert.equal(result.action?.product?.package_shape,'set',message);
    assert.equal(result.action?.quantity,quantity,message);
    assert.equal(result.state.cart.length,1,message);
  }else{
    assert.equal(result.action?.kind,undefined,message);
    assert.deepEqual(result.state.cart,[],message);
  }
}

for(const [index,message] of syntheticSetRequests.entries())test(`CRG-069H sa pridá iba ako reálny katalógový produkt ${index+1}`,async()=>{
  const result=await ask(message,emptyCommerceState(`set-${index}`));
  assertRealCrg069SetOrSafeAbsence(result,message);
});

test('množstvo 2 pridá dva kusy jedného reálneho produktu sady',async()=>{
  const result=await ask('Pridaj 2 kompletné kompatibilné Canon CRG-069H CMYK sady do košíka.');
  assertRealCrg069SetOrSafeAbsence(result,'množstvo 2 musí zostať jedným reálnym produktom',2);
  if(realCrg069Set)assert.equal(result.state.cart[0]?.quantity,2);
});

test('hotová katalógová CMYK sada sa pridá ako jeden reálny produkt',async()=>{
  const result=await ask('Pridaj 1 Brother BT6000/BT5000 CMYK kompatibilnú sadu atramentových náplní do košíka.');
  assert.equal(result.action?.kind,'ADD_TO_CART');
  assert.equal(result.action.product.sku,'SET-BRO-BT6000-BT5000-KOM');
  assert.equal(result.state.cart.length,1);
  assert.equal(result.state.cart[0].sku,'SET-BRO-BT6000-BT5000-KOM');
});

const ambiguous711=['711','Máte 711?','Hľadám 711','Ukáž mi 711','Potrebujem produkt 711'];
for(const message of ambiguous711)test(`711 sa neháda: ${message}`,()=>{
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(route.productQuery,null,message);
  assert.equal(route.needsProducts,false,message);
});

for(const message of ['SKU 711','sku: 711','Nájdi SKU-711'])test(`711 s prefixom SKU je jednoznačné: ${message}`,()=>{
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(route.productQuery,'711',message);
  assert.equal(route.needsProducts,true,message);
});

const cancellationQuestions=[
  'Chcem zrušiť zaplatenú objednávku pred expedíciou. Kedy dostanem peniaze späť?',
  'Prosím o storno objednávky, ešte nebola odoslaná.',
  'Zrušte objednávku pred odovzdaním kuriérovi a vráťte platbu.',
  'Ako stornujem online zaplatenú objednávku?',
  'Chcem zmeniť objednávku pred expedíciou.',
];
for(const message of cancellationQuestions)test(`storno nejde do stavu objednávky: ${message}`,async()=>{
  assert.equal(isOrderStatusQuestion(message),false,message);
  const result=await buildAssistantAnswer(message);
  assert.ok(['order','claim'].includes(String(result.intent)),message);
  assert.match(result.answer.join(' '),/info@tonerymaxim\.sk|zákaznícku podporu/i,message);
});

for(const message of ['Kde je moja objednávka?','Zisti stav objednávky 301007','Kde nájdem tracking zásielky?','Bola už objednávka odoslaná?'])test(`skutočný stav objednávky zostáva stavom: ${message}`,()=>{
  assert.equal(isOrderStatusQuestion(message),true,message);
});

for(const message of ['Aké je vaše IČO?','Prosím IČO firmy ToneryMAXIM.','Kto je predávajúci a aké má IČO?','Aké je DIČ prevádzkovateľa?'])test(`identita predávajúceho: ${message}`,async()=>{
  const result=await buildAssistantAnswer(message);
  assert.equal(result.faq,'predavajuci-firma',message);
  assert.match(result.answer.join(' '),/IČO 37 328 344/,message);
});

for(const message of ['Na papieri sa opakujú čierne bodky.','Výtlačok má pravidelné bodky.','Prečo toner robí bodky na papieri?'])test(`diagnostika bodiek: ${message}`,async()=>{
  const result=await buildAssistantAnswer(message);
  assert.equal(result.intent,'diagnostic',message);
  assert.match(result.answer.join(' '),/optický valec|poškodený toner/i,message);
});

test('zakázaná sada v už naplnenom košíku nezmení žiadny riadok',async()=>{
  const initial=[{id:'a',sku:'A',quantity:1},{id:'b',sku:'B',quantity:4}];
  const result=await ask('Ukáž kompletnú Canon CRG-069H CMYK sadu, ale nič nepridávaj ani nemeň v košíku.',{...emptyCommerceState('filled-cart'),cart:initial});
  assert.deepEqual(result.state.cart,initial);
  assert.equal(result.action,null);
});
