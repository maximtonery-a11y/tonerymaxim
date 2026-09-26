import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, requestedQuantity } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { hasExplicitCartAddCommand, isCartChangingAction } from '../src/lib/ai-cart-safety.ts';
import { filterProducts } from '../src/lib/tm-products-cache.ts';

async function ask(message:string,state:any=emptyCommerceState(`v13-${Math.random()}`)){
  const request=new Request('http://localhost/api/ai-tomas',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({message,page:'/',state}),
  });
  const response=await POST({request} as any);
  assert.equal(response.status,200,message);
  return response.json() as Promise<any>;
}

const answer=(result:any)=>(result.advisor?.answer||[]).join(' ');

const passiveProductRequests=[
  'Chcem originálnu Epson 104 CMYK sadu.',
  'Potrebujem 2 ks HP CF230X.',
  'Hľadám kompatibilný Canon CRG-069H toner.',
  'Ukáž mi Epson 104 CMYK sadu.',
  'Ponúkni Brother WT-223CL.',
  'Mám tlačiareň Epson EcoTank L3250 a chcem originálnu kompletnú CMYK sadu atramentov Epson 104.',
];

for(const message of passiveProductRequests)test(`želanie nie je príkaz na košík: ${message}`,async()=>{
  assert.equal(hasExplicitCartAddCommand(message),false,message);
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(route.intents.includes('BUY_INTENT'),false,message);
  const result=await ask(message);
  assert.deepEqual(result.state.cart,[],message);
  assert.equal(isCartChangingAction(result.action?.kind),false,message);
});

const explicitCommands=[
  'Pridaj 1 ks HP CF230X do košíka.',
  'Objednaj kompatibilný HP CF230X.',
  'Chcem kúpiť kompatibilný HP CF230X.',
  'Vlož kompatibilný HP CF230X do košíka.',
  'Daj mi kompatibilný HP CF230X do nákupu.',
];

for(const message of explicitCommands)test(`výslovný nákupný príkaz zostáva povolený: ${message}`,()=>{
  assert.equal(hasExplicitCartAddCommand(message),true,message);
  assert.equal(routeCommerceMessage(message,emptyCommerceState()).intents.includes('BUY_INTENT'),true,message);
});

test('presná rodina Epson 104 má prednosť pred modelom L3250 aj zakázanou 101',()=>{
  const message='Mám tlačiareň Epson EcoTank L3250 a chcem originálnu kompletnú CMYK sadu atramentov Epson 104. Ponúkni iba hotovú katalógovú sadu, nie sériu 101 a nie štyri samostatné fľaše.';
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(route.productQuery,'Epson 104');
  assert.equal(route.intents.includes('BUY_INTENT'),false);
});

test('produkčná veta Epson 104 nikdy nenahradí rodinu 103/101 ani nezmení košík',async()=>{
  const message='Mám tlačiareň Epson EcoTank L3250 a chcem originálnu kompletnú CMYK sadu atramentov Epson 104. Ponúkni iba hotovú katalógovú sadu, nie sériu 101 a nie štyri samostatné fľaše.';
  const result=await ask(message);
  assert.deepEqual(result.state.cart,[]);
  assert.equal(isCartChangingAction(result.action?.kind),false);
  assert.doesNotMatch(answer(result),/Epson\s+10[13]\b/i);
  assert.match(answer(result),/nenašiel.*(?:origináln|bezpečnú zhodu)/i);
});

test('existujúca kompatibilná Epson 104 katalógová sada sa nájde bez virtuálnej sady',async()=>{
  const result=await ask('Hľadám presne kompatibilnú Epson 104 CMYK sadu. Ukáž iba hotovú katalógovú sadu.');
  assert.deepEqual(result.state.cart,[]);
  assert.equal(isCartChangingAction(result.action?.kind),false);
  const products=result.commerce?.products||[];
  // Git repozitár nemusí mať lokálny runtime katalóg z produkčného
  // persistentného disku. Ak je v testovacom snapshote Epson 104 prítomná,
  // musí to byť reálny produkt sady. Ak v ňom nie je, AI musí bezpečne
  // odmietnuť akciu a nesmie vyrobiť virtuálnu sadu zo štyroch fliaš.
  const epson104=products.filter((product:any)=>/Epson\s+104/i.test(product.name));
  if(epson104.length){
    assert.ok(epson104.some((product:any)=>/CMYK/i.test(product.name)&&product.package_shape==='set'));
  }else{
    assert.ok(result.action?.kind===undefined||result.action?.kind==='CLARIFY_PRODUCT');
    assert.ok(!(result.commerce?.presentation?.sets||[]).some((set:any)=>set.packageKind==='synthetic'));
  }
  assert.equal(products.some((product:any)=>/Epson\s+10[13]\b/i.test(product.name)),false);
  assert.ok((result.commerce?.presentation?.sets||[]).every((set:any)=>set.packageKind==='catalog'&&set.products?.length===1));
});

test('4 ks v názve balenia znamená jednu sadu, nie štyri sady',async()=>{
  assert.equal(requestedQuantity('Objednaj kompatibilnú Epson 104 CMYK sadu atramentov (4 ks).'),null);
  const result=await ask('Objednaj kompatibilnú Epson 104 CMYK sadu atramentov (4 ks).');
  assert.notEqual(result.action?.kind,'ADD_BUNDLE_TO_CART');
  if(result.action?.kind==='ADD_TO_CART'){
    assert.equal(result.action?.quantity,1);
    assert.equal(result.state.cart.length,1);
    assert.equal(result.state.cart[0]?.quantity,1);
    assert.match(result.action?.product?.name||'',/Epson\s+104/i);
    assert.doesNotMatch(result.action?.product?.name||'',/Epson\s+10[13]\b/i);
  }else{
    assert.ok(result.action?.kind===undefined||result.action?.kind==='CLARIFY_PRODUCT');
    assert.deepEqual(result.state.cart,[]);
  }
});

test('výslovné množstvo pred sadou sa zachová',async()=>{
  assert.equal(requestedQuantity('Objednaj 3 ks kompatibilnej Epson 104 CMYK sady atramentov.'),3);
  const result=await ask('Objednaj 3 ks kompatibilnej Epson 104 CMYK sady atramentov.');
  assert.notEqual(result.action?.kind,'ADD_BUNDLE_TO_CART');
  if(result.action?.kind==='ADD_TO_CART'){
    assert.equal(result.action?.quantity,3);
    assert.equal(result.state.cart[0]?.quantity,3);
  }else{
    assert.ok(result.action?.kind===undefined||result.action?.kind==='CLARIFY_PRODUCT');
    assert.deepEqual(result.state.cart,[]);
  }
});

for(const message of [
  'Chcem do 14 dní vrátiť nepoužitý toner. Kto platí dopravu späť a na akú presnú adresu ho mám poslať?',
  'Odstupujem od zmluvy do 14 dní. Napíš presnú adresu ToneryMaxim, kam mám nepoužitý tovar vrátiť, a kto hradí spätnú prepravu. Nejde o cenu dopravy novej objednávky.',
  'Aká je návratová adresa a kto platí spätné poštovné?',
])test(`vrátenie má prednosť pred cenníkom dopravy: ${message}`,async()=>{
  const result=await ask(message);
  assert.equal(result.advisor?.faq,'vratenie-tovaru',message);
  assert.match(answer(result),/Tajov 265, 976 34 Tajov/i,message);
  assert.match(answer(result),/náklad na vrátenie znáša spotrebiteľ/i,message);
  assert.doesNotMatch(answer(result),/Doprava kuriérom GLS alebo DPD stojí/i,message);
  assert.deepEqual(result.state.cart,[],message);
});

test('bez výslovného príkazu zostane existujúci košík bitovo nezmenený',async()=>{
  const initial=[{id:'keep',sku:'KEEP',quantity:7}];
  const result=await ask('Chcem originálnu Epson 104 CMYK sadu.',{...emptyCommerceState('keep-cart'),cart:initial});
  assert.deepEqual(result.state.cart,initial);
  assert.equal(isCartChangingAction(result.action?.kind),false);
});

const epson604NoAction=[
  'Ponúkni jedinú kompatibilnú Epson 604XL CMYK sadu. Výslovne zakazujem akúkoľvek nákupnú akciu.',
  'Chcem iba zobraziť Epson 604XL CMYK sadu, bez nákupnej akcie a bez ADD_TO_CART.',
  'Epson 604XL CMYK sada – nič nepridávaj, nevykonaj BUY_INTENT ani ADD TO CART.',
  'Ukáž mi Epson 604XL CMYK sadu. Košík sa nesmie zmeniť.',
];
for(const message of epson604NoAction)test(`Epson 604XL rešpektuje zákaz nákupnej akcie: ${message}`,async()=>{
  const initial=[{id:'keep-604',sku:'KEEP-604',quantity:2}];
  assert.equal(hasExplicitCartAddCommand(message),false,message);
  const result=await ask(message,{...emptyCommerceState(`epson-604-${Math.random()}`),cart:initial});
  assert.deepEqual(result.state.cart,initial,message);
  assert.equal(isCartChangingAction(result.action?.kind),false,message);
  assert.doesNotMatch(answer(result),/^Pridal som|Vybral som.*pridal/im,message);
});

for(const message of ['Canon PFI-120','pfi-120','Canon PFI120','Canon pfi102'])test(`PFI je atramentový OEM kód, nie kalendár: ${message}`,async()=>{
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(route.intents.includes('PRODUCT_SEARCH'),true,message);
  assert.equal(route.productQuery!==null,true,message);
  const result=await ask(message);
  assert.notEqual(result.commerce?.source,'calendar',message);
  assert.doesNotMatch(answer(result),/nástenný|stolový|denný|týždenný|mesačný|minidiár/i,message);
  assert.deepEqual(result.state.cart,[],message);
});

test('bežné výsledky M455dn úplne skryjú bezčipové, OEM-čipové a Hatona varianty',()=>{
  const base={price:10,stock_status:'instock',product_type_key:'compatible',compatible_printers:['HP Color LaserJet Enterprise M455dn']};
  const products:any[]=[
    {...base,id:1,sku:'W2030A',name:'HP W2030A kompatibilný toner s čipom',slug:'hp-w2030a'},
    {...base,id:2,sku:'W2030A-NC',name:'HP W2030A kompatibilný toner bez čipu',slug:'hp-w2030a-no-chip'},
    {...base,id:3,sku:'W2030A-OEM',name:'HP W2030A renovovaný toner s OEM čipom',slug:'hp-w2030a-oem-chip',product_type_key:'renovated'},
    {...base,id:4,sku:'W2030A-H',name:'Hatona HP W2030A renovovaný toner',slug:'hatona-hp-w2030a',product_type_key:'renovated'},
  ].map(product=>({...product,search_text:`${product.name} ${product.sku}`.toLowerCase()}));
  const ordinary=filterProducts(products,{printer:'HP Color LaserJet Enterprise M455dn'});
  assert.deepEqual(ordinary.map(product=>product.id),[1]);
  assert.equal(ordinary.some(product=>/bez čipu|oem čip|hatona/i.test(product.name)),false);
  const explicit=filterProducts(products,{search:'W2030A bez čipu'});
  assert.equal(explicit.some(product=>product.id===2),true);
});

for(const message of [
  'Zásielka je v trackingu označená ako doručená, ale balík nemám. Čo mám urobiť?',
  'Kuriér označil balík za doručený, no zásielka mi neprišla.',
])test(`doručená, ale chýbajúca zásielka má reklamačný postup: ${message}`,async()=>{
  const result=await ask(message);
  assert.equal(result.advisor?.faq,'zasielka-oznacena-dorucena',message);
  assert.match(answer(result),/dopravcu|GPS|záznamu o odovzdaní/i,message);
  assert.match(answer(result),/info@tonerymaxim\.sk|917 859 206/i,message);
  assert.doesNotMatch(answer(result),/^Cena dopravy:/i,message);
});

for(const message of [
  'Podávač papiera cvaká. Aké bezpečné kontroly papiera, zásobníka a vodiacich líšt mám spraviť?',
  'Tlačiareň pri podávaní papiera klepe a papier neberie.',
])test(`cvakanie podávača dostane bezpečný diagnostický postup: ${message}`,async()=>{
  const result=await ask(message);
  assert.equal(result.advisor?.faq,'cvakanie-podavaca',message);
  assert.match(answer(result),/odpojte od elektriny/i,message);
  assert.match(answer(result),/vodiace lišty/i,message);
  assert.match(answer(result),/nerozoberajte|nepoužívajte silu/i,message);
});

test('úplný prehľad dopravy vždy obsahuje aj dobierku 1,20 €',async()=>{
  const result=await ask('Uveď presne cenu kuriéra, výdajného miesta, hranicu dopravy zdarma a poplatok za dobierku.');
  assert.equal(result.advisor?.faq,'doprava-ceny');
  assert.match(answer(result),/3,90 €/);
  assert.match(answer(result),/2,90 €/);
  assert.match(answer(result),/29 €/);
  assert.match(answer(result),/dobierk.*1,20 €/i);
});
