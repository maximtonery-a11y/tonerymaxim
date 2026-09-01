import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, getProductsCache } from '../src/lib/tm-products-cache.ts';
import { resolveCommerceProducts } from '../src/lib/ai-commerce/catalog.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { POST as aiTomasPost } from '../src/pages/api/ai-tomas.ts';

const cases = [
  'Canon CL586',
  'hľadám náplne Canon cl586',
  'CL-586 XL',
  'Canon PG585',
  'PG-585',
  'CLI-581',
  'PGI-580',
  'LC3219XL',
  'TN2421',
  'Brother DCP-L2532DW',
  'HP M110w',
  'Epson WF-6090',
];

test('AI používa rovnaké katalógové zhody ako vyhľadávanie', async () => {
  const cache = await getProductsCache();
  for (const query of cases) {
    const search = filterProducts(cache.products, { search: query });
    const route = routeCommerceMessage(query, emptyCommerceState());
    assert.equal(route.needsProducts, true, query);
    const ai = await resolveCommerceProducts(route.productQuery!);
    assert.ok(search.length > 0, `vyhľadávanie: ${query}`);
    assert.ok(ai.products.length > 0, `AI: ${query}`);
    const searchIds = new Set(search.map(product => String(product.id)));
    assert.ok(ai.products.every(product => searchIds.has(String(product.id))), `parita: ${query}`);
  }
});

test('Canon CL586 prejde celým endpointom a zobrazí správne produkty', async () => {
  const request = new Request('http://localhost/api/ai-tomas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hľadám náplne Canon cl586', page: '/' }),
  });
  const response = await aiTomasPost({ request } as any);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.ok(body.commerce?.products?.length >= 2);
  assert.ok(body.commerce.products.every((product: any) => /CL-586/i.test(product.name)));
  assert.doesNotMatch(body.advisor.answer.join(' '), /nenašiel.*zhodu|napíšte.*model tlačiarne/i);
});

test('servisné čísla a všeobecná tonerová otázka nespustia katalóg', () => {
  for (const query of ['kde je objednávka 123456', 'stav objednávky 300949', 'Máte tonery na sklade?']) {
    const route = routeCommerceMessage(query, emptyCommerceState());
    assert.equal(route.needsProducts, false, query);
    assert.equal(route.productQuery, null, query);
  }
});

test('Epson WF-6090 najprv vyžiada typ a potom zobrazí celú kompatibilnú ponuku',async()=>{
 const firstResponse=await aiTomasPost({request:new Request('http://localhost/api/ai-tomas',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({message:'Hľadám náplne do tlačiarne Epson WF-6090',page:'/'})
 })} as any);
 assert.equal(firstResponse.status,200);
 const first=await firstResponse.json() as any;
 assert.equal(first.route.productQuery,'Epson WF-6090');
 assert.equal(first.action?.kind,'ASK_PRODUCT_TYPE');
 assert.deepEqual(first.action.options,['compatible','original']);
 assert.equal(first.commerce,null);
 assert.match(first.advisor.answer.join(' '),/kompatibilné.*originálne.*atramentové náplne/i);

 const secondResponse=await aiTomasPost({request:new Request('http://localhost/api/ai-tomas',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({message:'Kompatibilné',page:'/',state:first.state})
 })} as any);
 assert.equal(secondResponse.status,200);
 const second=await secondResponse.json() as any;
 assert.equal(second.action,null);
 assert.equal(second.state.currentType,'compatible');
 assert.ok(second.commerce?.products?.length>=4);
 assert.ok(second.commerce.products.every((product:any)=>product.type==='compatible'));
 assert.deepEqual(new Set(second.commerce.products.map((product:any)=>product.color)),new Set(['black','cyan','magenta','yellow']));
 assert.ok(second.commerce.presentation.sets.some((set:any)=>set.type==='compatible'&&set.products.length===4));
 assert.equal(second.state.cart.length,0,'výber typu nesmie automaticky vložiť náhodný produkt');

 const originalResponse=await aiTomasPost({request:new Request('http://localhost/api/ai-tomas',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({message:'Originálne',page:'/',state:first.state})
 })} as any);
 const original=await originalResponse.json() as any;
 assert.equal(originalResponse.status,200);
 assert.ok(original.commerce?.products?.length>=4);
 assert.ok(original.commerce.products.every((product:any)=>product.type==='original'));
 assert.deepEqual(new Set(original.commerce.products.map((product:any)=>product.color)),new Set(['black','cyan','magenta','yellow']));
 assert.ok(original.commerce.presentation.sets.some((set:any)=>set.type==='original'&&set.products.length===4));
 assert.equal(original.state.cart.length,0);
});

test('jednociferné historické modely tlačiarní sa nestratia',()=>{
 for(const model of ['Canon imagePRESS C1','Konica Minolta Page Pro 8','HP LaserJet 5L','Lexmark 3X']){
  const route=routeCommerceMessage(`Hľadám náplne do tlačiarne ${model}`,emptyCommerceState());
  assert.equal(route.needsProducts,true,model);
  assert.ok(route.productQuery,model);
 }
});

test('presné interné SKU nájde presný produkt a číslo v SKU nie je množstvo',async()=>{
 const response=await aiTomasPost({request:new Request('http://localhost/api/ai-tomas',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({message:'GI-41-KOM-14045',page:'/'})
 })} as any);
 assert.equal(response.status,200);
 const body=await response.json() as any;
 assert.equal(body.action,null);
 assert.equal(body.state.cart.length,0);
 assert.ok(body.commerce?.products?.some((product:any)=>product.sku==='GI-41-KOM-14045'));
 assert.ok(body.commerce.products.every((product:any)=>product.sku==='GI-41-KOM-14045'));
});

test('presné SKU optického valca sa neodfiltruje ako tonerová rodina',async()=>{
 const result=await resolveCommerceProducts('DR-1050-KOM-13968');
 assert.deepEqual(result.products.map(product=>product.sku),['DR-1050-KOM-13968']);
 assert.match(result.products[0].name,/optický valec/i);
});
