import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { resolveCommerceProducts } from '../src/lib/ai-commerce/catalog.ts';
import { analyzeCatalogQuery } from '../src/lib/catalog-query.ts';

async function ask(message:string,state:any={}){
  const request=new Request('http://localhost/api/ai-tomas',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({message,page:'/',state}),
  });
  const response=await POST({request} as any);
  assert.equal(response.status,200);
  return response.json();
}

const compact=(value:unknown)=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');

test('explicit request for compatible, original and renovated keeps every type',async()=>{
  const data=await ask('Ukáž mi kompatibilný, originálny aj renovovaný Samsung MLT-D111L toner, nič nepridávaj.');
  const types=[...new Set((data.commerce?.products||[]).map((product:any)=>product.type))].sort();
  assert.deepEqual(types,['compatible','original','renovated']);
  assert.equal(data.state.currentType,null);
  assert.equal(data.state.cart.length,0);
});

test('compound OEM references do not degrade to their numeric fragment',()=>{
  assert.deepEqual(analyzeCatalogQuery('HP 305').referenceTokens,['305']);
  for(const query of ['CRG-054','Canon CRG 054','CRG-054 kompletná CMYK sada']){
    const tokens=analyzeCatalogQuery(query).referenceTokens;
    assert.ok(tokens.some(token=>token.includes('crg054')),`${query}: missing CRG-054 token`);
    assert.equal(tokens.includes('054'),false,`${query}: leaked generic 054 token`);
  }
});

test('CRG-054 search never leaks HP CN054AE',async()=>{
  for(const query of ['CRG-054','Canon CRG-054','CRG-054 kompletná CMYK sada']){
    const result=await resolveCommerceProducts(query);
    assert.ok(result.products.length>0,`${query}: expected catalog results`);
    assert.equal(result.products.some(product=>compact(`${product.name} ${product.sku} ${product.url}`).includes('cn054ae')),false);
    assert.ok(result.products.every(product=>compact(`${product.name} ${product.sku} ${product.url}`).includes('crg054')),`${query}: contains another product family`);
  }
});

test('complete-set intent is explicit and API exposes catalog packages only',async()=>{
  const data=await ask('Ukáž mi CRG-054 kompletnú CMYK sadu, kompatibilnú, originálnu aj renovovanú. Nič nepridávaj.');
  const sets=data.commerce?.presentation?.sets||[];
  assert.equal(data.commerce?.presentation?.setIntent,true);
  assert.ok(sets.every((set:any)=>set.packageKind==='catalog'&&set.products.length===1));
  assert.equal(data.state.cart.length,0);
});

test('complete-set UI hides singles initially and states missing catalog variants',async()=>{
  const script=await readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
  assert.match(script,/data-ai-show-singles/);
  assert.match(script,/data-ai-singles-panel[^>]*hidden/);
  assert.match(script,/kompletný katalógový produkt momentálne nie je v katalógu/i);
  assert.match(script,/setIntent/);
});

test('V10 guards mismatched product links and stabilizes the mobile keyboard layout',async()=>{
  const [script,css]=await Promise.all([
    readFile(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8'),
    readFile(new URL('../src/styles/ai-sales-assistant.css',import.meta.url),'utf8'),
  ]);
  assert.match(script,/function safeProductUrl\(/);
  assert.match(script,/safeProductUrl\(p\)/);
  assert.match(css,/\.tm-ai-assistant__form input\{[^}]*font-size:16px!important/);
  assert.match(css,/\.tm-ai-assistant\.has-keyboard \.tm-ai-assistant__tools\{display:none!important\}/);
  assert.match(css,/\.tm-ai-assistant__panel\{[^}]*width:100%!important[^}]*max-width:100%!important/);
});
