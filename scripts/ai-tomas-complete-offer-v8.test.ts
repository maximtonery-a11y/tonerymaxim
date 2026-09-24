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
  assert.match(css,/grid-template-columns:96px minmax\(0,1fr\) 210px/);
  assert.match(css,/\.tm-ai-discovery:not\(\.is-calendar-list\) \.tm-ai-product-card>div\{margin-top:0!important\}/);
  assert.match(css,/\.tm-ai-card-side \.tm-ai-card-actions\{display:grid;width:100%;grid-template-columns:1fr 1fr/);
  assert.match(css,/\.tm-ai-discovery:not\(\.is-calendar-list\) \.tm-ai-shop-products\{grid-template-columns:1fr!important/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*grid-template-columns:72px minmax\(0,1fr\)!important/);
});

test('offer summary does not call orderable products in-stock products',async()=>{
  const script=await readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
  assert.match(script,/V ponuke máme <strong>\$\{suitableProductsText\(available\.length\)\}<\/strong>\. Produkty skladom/);
  assert.doesNotMatch(script,/Na sklade máme <strong>\$\{suitableProductsText\(available\.length\)\}/);
});

test('V9 renders only real catalog sets and never assembled four-color bundles',async()=>{
  const [script,api]=await Promise.all([
    readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8'),
    readFile(new URL('../src/pages/api/ai-tomas.ts',import.meta.url),'utf8'),
  ]);
  assert.match(script,/set\?\.packageKind==='catalog'&&Array\.isArray\(set\.products\)&&set\.products\.length===1/);
  assert.doesNotMatch(script,/set\.products\.length===4\|\|/);
  assert.doesNotMatch(api,/ADD_BUNDLE_TO_CART/);
  assert.match(api,/Jednotlivé farby som nespojil do falošnej sady/);
});

test('V9 API never exposes an assembled set in presentation data',async()=>{
  const data=await ask('Hľadám Brother BT6000/BT5000 CMYK kompatibilnú sadu, nič nepridávaj do košíka.');
  const sets=data.commerce?.presentation?.sets||[];
  assert.ok(sets.length>0,'BT6000/BT5000 má obsahovať reálnu katalógovú sadu');
  assert.ok(sets.every((set:any)=>set.packageKind==='catalog'&&set.products.length===1));
  assert.equal(sets.some((set:any)=>set.products.length===4),false);
  assert.equal(data.state.cart.length,0);
});

test('V9 locks mobile panel to visual viewport and compacts frequent purchases',async()=>{
  const [script,css]=await Promise.all([
    readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8'),
    readFile(new URL('../src/styles/ai-sales-assistant.css',import.meta.url),'utf8'),
  ]);
  assert.match(script,/visualViewport\.offsetTop/);
  assert.match(script,/--tm-ai-visual-top/);
  assert.match(script,/setTimeout\(updateViewportState,260\)/);
  assert.match(css,/top:var\(--tm-ai-visual-top,0px\)!important/);
  assert.match(css,/\.tm-ai-assistant\.has-keyboard \.tm-ai-livecart\{display:none!important\}/);
  assert.match(css,/\.tm-ai-frequent>div\{display:flex!important/);
  assert.match(css,/flex:0 0 min\(76vw,270px\)!important/);
});
