import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { resolveCommerceProducts } from '../src/lib/ai-commerce/catalog.ts';

async function ask(message:string,state:any={}){
  const request=new Request('http://localhost/api/ai-tomas',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,page:'/',state})});
  const response=await POST({request} as any);
  assert.equal(response.status,200);
  return response.json();
}

test('MLT-D111L offer includes compatible, original and renovated products',async()=>{
  const result=await resolveCommerceProducts('MLT-D111L');
  const types=new Set(result.products.map(product=>product.type));
  assert.deepEqual([...types].sort(),['compatible','original','renovated']);
  assert.ok(result.products.some(product=>product.type==='original'&&/MLT-D111S/i.test(product.name)));
});

test('ordinary search shows every available type without a chooser wall',async()=>{
  const data=await ask('Hľadám Samsung MLT-D111L toner, nič nepridávaj do košíka.');
  assert.notEqual(data.action?.kind,'ASK_PRODUCT_TYPE');
  assert.deepEqual([...new Set(data.commerce.products.map((product:any)=>product.type))].sort(),['compatible','original','renovated']);
  assert.equal(data.state.cart.length,0);
});

test('ambiguous purchase still asks for type before cart mutation',async()=>{
  const data=await ask('Pridaj mi 1 ks Samsung MLT-D111L do košíka.');
  assert.equal(data.action?.kind,'ASK_PRODUCT_TYPE');
  assert.deepEqual(data.action.options,['compatible','original','renovated']);
  assert.equal(data.state.cart.length,0);
});

test('711 abandons stale product flow and asks for manufacturer or printer',async()=>{
  const data=await ask('Hľadám 711. Nehádaj podľa interného SKU.',{lastProductQuery:'HP CF280X',pendingQuestion:'product_type',currentType:null,cart:[]});
  assert.equal(data.action?.kind,'CLARIFY_PRODUCT');
  assert.match(data.advisor.answer.join(' '),/výrobcu a model tlačiarne|HP 711/i);
  assert.equal(data.state.lastProductQuery,null);
  assert.equal(data.state.pendingQuestion,null);
});

test('offer UI uses compact rows and keeps desktop plus mobile layouts',async()=>{
  const [script,css]=await Promise.all([
    readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8'),
    readFile(new URL('../src/styles/ai-sales-assistant.css',import.meta.url),'utf8'),
  ]);
  assert.match(script,/tm-ai-card-main/);
  assert.match(script,/tm-ai-card-side/);
  assert.match(script,/Detail produktu/);
  assert.match(css,/grid-template-columns:96px minmax\(0,1fr\) 190px/);
  assert.match(css,/\.tm-ai-discovery:not\(\.is-calendar-list\) \.tm-ai-shop-products\{grid-template-columns:1fr!important/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*grid-template-columns:72px minmax\(0,1fr\)!important/);
});
