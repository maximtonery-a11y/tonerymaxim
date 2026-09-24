import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { analyzeCatalogQuery } from '../src/lib/catalog-query.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';

async function ask(message:string,state:any={}){
  const request=new Request('http://localhost/api/ai-tomas',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({message,page:'/',state}),
  });
  const response=await POST({request} as any);
  assert.equal(response.status,200);
  return response.json();
}

test('celá veta HP 305 zachová značku aj presný číselný OEM',()=>{
  const message='Ukáž mi HP 305 originálnu aj kompatibilnú atramentovú náplň. Nič nepridávaj do košíka.';
  assert.deepEqual(analyzeCatalogQuery(message).referenceTokens,['305']);
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.equal(route.productQuery,'HP 305');
  assert.notEqual(route.productQuery,'305');
});

test('HP 305 nevráti Epson, Canon PFI ani laserovú rodinu HP 305A',async()=>{
  const data=await ask('Ukáž mi HP 305 originálnu aj kompatibilnú atramentovú náplň. Nič nepridávaj do košíka.');
  const products=data.commerce?.products||[];
  assert.ok(products.length>0);
  assert.ok(products.every((product:any)=>/^HP\s/i.test(product.name)));
  assert.ok(products.every((product:any)=>{
    const identity=`${product.name||''} ${product.sku||''}`;
    return /(?:^|[^0-9])305(?:XL|XXL)?(?:$|[^a-z0-9])/i.test(identity)&&!/(?:^|[^0-9])305A(?:$|[^a-z0-9])/i.test(identity);
  }));
  assert.equal(products.some((product:any)=>/Epson|Canon|PFI-|305A\s+CMYK|toner/i.test(product.name)),false);
  assert.ok(products.every((product:any)=>['compatible','original'].includes(product.type)));
  const returnedTypes=new Set(products.map((product:any)=>product.type));
  const missingTypes=data.commerce?.presentation?.missingRequestedTypes||[];
  for(const type of ['compatible','original']){
    assert.equal(missingTypes.includes(type),!returnedTypes.has(type));
  }
  assert.deepEqual(data.state.cart,[]);
  assert.equal(data.action,null);
});

test('Brother BT6000 plus BT5000 zachová oba rodinné kódy',()=>{
  const message='Ukáž mi kompletnú Brother BT6000 BK + BT5000 C M Y sadu, kompatibilnú, originálnu aj renovovanú. Nič nepridávaj do košíka.';
  const analysis=analyzeCatalogQuery(message);
  assert.deepEqual(analysis.referenceTokens,['bt6000','bt5000']);
  const route=routeCommerceMessage(message,emptyCommerceState());
  assert.match(route.productQuery||'',/BT6000/i);
  assert.match(route.productQuery||'',/BT5000/i);
});

test('Brother kompletná sada používa iba skutočný katalógový set',async()=>{
  const data=await ask('Ukáž mi kompletnú Brother BT6000 BK + BT5000 C M Y sadu, kompatibilnú, originálnu aj renovovanú. Nič nepridávaj do košíka.');
  const products=data.commerce?.products||[];
  const sets=data.commerce?.presentation?.sets||[];
  assert.ok(products.some((product:any)=>product.sku==='SET-BRO-BT6000-BT5000-KOM'));
  assert.ok(products.every((product:any)=>/^Brother\s/i.test(product.name)));
  assert.ok(products.every((product:any)=>/BT6000|BT5000/i.test(`${product.name} ${product.sku}`)));
  assert.equal(data.commerce.presentation.setIntent,true);
  assert.deepEqual(data.commerce.presentation.requestedTypes,['compatible','original','renovated']);
  assert.deepEqual(data.commerce.presentation.missingRequestedTypes,['renovated']);
  assert.equal(sets.length,1);
  assert.equal(sets[0].packageKind,'catalog');
  assert.equal(sets[0].products.length,1);
  assert.equal(sets[0].products[0].sku,'SET-BRO-BT6000-BT5000-KOM');
  assert.deepEqual(data.state.cart,[]);
  assert.equal(data.action,null);
});

test('Epson EcoTank L3250 zostáva po úprave presným modelom tlačiarne',()=>{
  const route=routeCommerceMessage('Mám Epson EcoTank L3250. Ukáž kompatibilnú náplň.',emptyCommerceState());
  assert.equal(route.productQuery,'Epson EcoTank L3250');
});

test('explicitné číselné SKU a nejednoznačné 711 zostávajú bezpečné',()=>{
  assert.equal(routeCommerceMessage('SKU 123456',emptyCommerceState()).productQuery,'123456');
  assert.equal(routeCommerceMessage('Potrebujem náplň 711',emptyCommerceState()).productQuery,null);
});

test('UI oznamuje chýbajúci typ a používa správny názov atramentových náplní',async()=>{
  const script=await readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
  assert.match(script,/missingRequestedTypes/);
  assert.match(script,/momentálne v katalógu nemáme/);
  assert.match(script,/offerProductNoun/);
  assert.match(script,/atramentové náplne/);
  assert.match(script,/data-ai-singles-panel[^>]*hidden/);
});
