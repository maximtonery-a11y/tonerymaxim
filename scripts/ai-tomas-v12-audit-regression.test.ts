import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { analyzeCatalogQuery } from '../src/lib/catalog-query.ts';
import { resolveCommerceProducts } from '../src/lib/ai-commerce/catalog.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { filterProducts, getProductsCache } from '../src/lib/tm-products-cache.ts';

async function ask(message:string,state:any={}){
  const request=new Request('http://localhost/api/ai-tomas',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({message,page:'/',state}),
  });
  const response=await POST({request} as any);
  assert.equal(response.status,200);
  return response.json();
}

const advisorText=(data:any)=>(data.advisor?.answer||[]).join(' ');

test('MC-G02 a MCG02 zostanú jedným presným referenčným kódom',()=>{
  assert.deepEqual(analyzeCatalogQuery('MC-G02').referenceTokens,['mcg02']);
  assert.deepEqual(analyzeCatalogQuery('MCG02').referenceTokens,['mcg02']);
});

test('neexistujúci MC-G02 nevráti CRG-029 ani Konica A0WG02H',async()=>{
  const cache=await getProductsCache();
  for(const query of ['MC-G02','MCG02']){
    const products=filterProducts(cache.products,{search:query});
    assert.equal(products.some((product:any)=>/CRG.?029|A0WG02H/i.test(`${product.name} ${product.sku}`)),false);
  }
});

test('Epson 104 uprednostní viditeľnú rodinu 104 pred čistou rodinou 101',async()=>{
  const cache=await getProductsCache();
  const products=filterProducts(cache.products,{search:'Epson 104'});
  assert.ok(products.length>0);
  assert.match(products[0].name,/(?:^|[^0-9])104(?:$|[^0-9])/i);
  const exact104=products.findIndex((product:any)=>/^Epson 104\b/i.test(product.name));
  const pure101=products.findIndex((product:any)=>/^Epson 101\b/i.test(product.name)&&!/(?:^|[^0-9])104(?:$|[^0-9])/i.test(product.name));
  if(exact104>=0&&pure101>=0)assert.ok(exact104<pure101);
  const commerce=await resolveCommerceProducts('Epson 104');
  assert.ok(commerce.products.length>0);
  assert.ok(commerce.products.every((product:any)=>/(?:^|[^0-9])104(?:$|[^0-9])/i.test(product.name)));
  assert.equal(commerce.products.some((product:any)=>/^Epson 101\b/i.test(product.name)&&!/(?:^|[^0-9])104(?:$|[^0-9])/i.test(product.name)),false);
});

test('presné odpadové nádoby sa nezamenia za tonery',async()=>{
  const brother=await resolveCommerceProducts('Brother WT-223CL odpadová nádoba');
  assert.ok(brother.products.length>0);
  assert.ok(brother.products.every((product:any)=>/WT.?223CL/i.test(`${product.name} ${product.sku}`)&&/odpad|nádob/i.test(product.name)));
  assert.equal(brother.products.some((product:any)=>/TN.?24[37]/i.test(`${product.name} ${product.sku}`)),false);

  const xerox=await resolveCommerceProducts('Xerox 008R13325 odpadová nádoba');
  assert.ok(xerox.products.length>0);
  assert.ok(xerox.products.every((product:any)=>/008R13325/i.test(`${product.name} ${product.sku}`)&&/odpad|nádob/i.test(product.name)));
  assert.equal(xerox.products.some((product:any)=>/006R/i.test(`${product.name} ${product.sku}`)),false);
});

test('produkt s otázkou na zľavu zachová katalógové vyhľadávanie',()=>{
  const route=routeCommerceMessage('Nájdi HP CF230X, cenu, sklad a množstevné zľavy',emptyCommerceState());
  assert.equal(route.needsProducts,true);
  assert.match(route.productQuery||'',/CF230X/i);
});

test('AI odpovie na toner verzus valec a diagnostiku bez fakturácie',async()=>{
  const comparison=await ask('Aký je rozdiel medzi tonerom a optickým valcom?');
  assert.equal(comparison.advisor?.faq,'toner-opticky-valec');
  assert.match(advisorText(comparison),/toner/i);
  assert.match(advisorText(comparison),/optick.*valec/i);
  assert.doesNotMatch(advisorText(comparison),/faktur/i);

  const diagnostic=await ask('Papier sa krúti a toner sa rozmazáva na okraji. Čo mám robiť?');
  assert.equal(diagnostic.advisor?.faq,'krutenie-rozmazavanie');
  assert.match(advisorText(diagnostic),/papier/i);
  assert.match(advisorText(diagnostic),/fixačn/i);
  assert.doesNotMatch(advisorText(diagnostic),/faktur/i);
});

test('AI uvedie návratovú adresu a pri CF230X aj ceny, sklad a zľavy',async()=>{
  const returns=await ask('Kam mám poslať tovar pri odstúpení do 14 dní?');
  assert.match(advisorText(returns),/Tajov 265, 976 34 Tajov/i);
  assert.match(advisorText(returns),/neposielajte na dobierku/i);

  const product=await ask('Nájdi HP CF230X, cenu, sklad a množstevné zľavy');
  assert.ok((product.commerce?.products||[]).some((item:any)=>/CF230X/i.test(`${item.name} ${item.sku}`)));
  assert.match(advisorText(product),/10 %/);
  assert.match(advisorText(product),/25 %/);
  assert.deepEqual(product.state?.cart,[]);
  assert.equal(product.action,null);
});

test('Hatona sa nezobrazuje v štandardnom bloku ďalších variantov',async()=>{
  const source=await readFile(new URL('../src/components/CatalogInitialRows.astro',import.meta.url),'utf8');
  assert.match(source,/chip\.key !== "hatona"/);
  assert.doesNotMatch(source,/key: "hatona", label: "Hatona"/);
});
