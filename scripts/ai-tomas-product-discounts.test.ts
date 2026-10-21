import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../src/pages/api/ai-tomas.ts';
import {emptyCommerceState} from '../src/lib/ai-commerce/domain.ts';
process.env.OPENAI_ASSISTANT_ENABLED='0';
const globals=globalThis as any;let generation=0;
const page='/produkt/hp-cf259x-kompatibilny';
beforeEach(()=>{
 globals.__TM_PRODUCTS_FILE_CACHE__={ok:true,version:4,runtime_compact:true,generated_at:`product-discounts-${++generation}`,total:3,products:[
  {id:259,sku:'259-C',name:'HP CF259X (59X) čierny kompatibilný toner',slug:'hp-cf259x-kompatibilny',price:33.72,product_type_key:'compatible'},
  {id:260,sku:'259-O',name:'HP CF259X (59X) čierny originálny toner',slug:'hp-cf259x-originalny',price:129,product_type_key:'original'},
  {id:2421,sku:'BRO-C',name:'Brother TN2421 čierny kompatibilný toner',slug:'brother-tn2421-kompatibilny',price:10,product_type_key:'compatible'},
 ].map(product=>({...product,stock_status:'instock',stock_quantity:20,compatible_printers:['HP LaserJet Pro M404dn']}))};
 delete globals.__TM_PUBLIC_PRODUCTS_CACHE__;delete globals.__TM_PRODUCTS_LOOKUP_INDEX__;
});
async function ask(message:string,state:any=emptyCommerceState(),currentPage=page){
 const response=await POST({request:new Request('http://localhost/api/ai-tomas',{method:'POST',body:JSON.stringify({message,state,page:currentPage})})} as any);
 assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.state.cart,state.cart);assert.notEqual(data.action?.kind,'ADD_TO_CART');return data;
}
const text=(data:any)=>data.advisor.answer.join(' ');

test('snímka CF259X: otázka na možnosti zliav pozná toner aj bez zopakovania kódu',async()=>{
 const first=await ask('kolko stoji tento toner?');assert.match(text(first),/33,72/);
 for(const question of ['ake su moznosti zliav pri tomto tonery?','Aké možnosti zliav mám na tento toner?','Akú zľavu mám pri tomto toneri?']){
  const result=await ask(question,first.state);
  assert.equal(result.advisor.faq,'product-discounts',question);assert.match(text(result),/HP CF259X/);
  assert.equal(result.discounts.sku,'259-C');assert.deepEqual(result.discounts.offers.map((offer:any)=>[offer.quantity,offer.discountPercent,offer.totalPrice]),[[2,10,60.7],[4,25,101.16]]);
  for(const pattern of [/60,70/,/101,16/,/5 %/,/7 %/,/platnú/,/nesčítavajú/,/Moje odmeny/,/Vernostný program/,/Množstevná \/ sadová zľava/,/Kupónová zľava/,/Vernostná zľava/,/Menu účtu/,/Objednávka/])assert.match(text(result),pattern);
  assert.doesNotMatch(text(result),/napíšte.*model|podľa katalógu|overil som/i);assert.equal(result.action,null);
  assert.ok(result.state.conversationHistory.slice(-2).every((turn:any)=>turn.productReference==='SKU: 259-C'));
 }
});
test('zľava po vyhľadaní a odbočke k doprave zostáva pri vybranom produkte',async()=>{
 const first=await ask('Ukáž mi kompatibilný HP CF259X.',undefined,'/');
 const shipping=await ask('Koľko stojí doprava?',first.state,'/');
 const discount=await ask('Aké sú možnosti zliav pri tomto toneri?',shipping.state,'/');
 assert.equal(discount.discounts.sku,'259-C');
 const total=await ask('Koľko bude stáť toner aj s dopravou?',discount.state,'/');
 assert.equal(total.quote.sku,'259-C');assert.equal(total.quote.quantity,1);assert.ok(total.quote.options.every((option:any)=>option.total===33.72));
});
test('nový detail a výslovný iný produkt majú prednosť pred starým tonerom',async()=>{
 const first=await ask('Koľko stojí tento toner?');
 const brother=await ask('Aké sú možnosti zliav pri tomto toneri?',first.state,'/produkt/brother-tn2421-kompatibilny');
 assert.equal(brother.discounts.sku,'BRO-C');assert.equal(brother.discounts.offers[0].totalPrice,18);
 const original=await ask('Aké zľavy mám pri originálnom HP CF259X?',brother.state);
 assert.equal(original.discounts.sku,'259-O');assert.deepEqual(original.discounts.offers,[]);
 assert.match(text(original),/7 %.*nevzťahujú/);assert.doesNotMatch(text(original),/môžete ju využiť aj na tento kompatibilný/);
});
test('neznámy alebo nejednoznačný toner si nevypožičia cenu z predchádzajúceho',async()=>{
 const first=await ask('Koľko stojí tento toner?');
 for(const question of ['Aké sú možnosti zliav na HP CF259X?','Aké zľavy mám na HP CF999999?']){
  const result=await ask(question,first.state,'/');assert.equal(result.discounts,null,question);assert.equal(result.action.kind,'CLARIFY_PRODUCT');assert.doesNotMatch(text(result),/60,70|101,16/);
 }
 const unclear=await ask('Aké sú možnosti zliav na tento toner?',emptyCommerceState(),'/');
 const chosen=await ask('tento',unclear.state);assert.equal(chosen.discounts.sku,'259-C');
});
test('registračná zľava a konkrétny kupón zostávajú servisnými otázkami',async()=>{
 const first=await ask('Koľko stojí tento toner?');
 assert.equal((await ask('Ako uplatním zľavu za registráciu na tento toner?',first.state)).advisor.faq,'registracia-zlava');
 assert.equal((await ask('Ako použijem tento zľavový kupón?',first.state)).advisor.faq,'kupony-uplatnenie');
 const general=await ask('Aké možnosti zliav máte?',first.state);assert.equal(general.advisor.faq,'zlavy-prehlad');assert.equal(general.discounts,undefined);
});
test('ceny zliav sa načítajú nanovo a nepreberajú sa z odpovede v histórii',async()=>{
 const first=await ask('Aké možnosti zliav mám pri tomto toneri?');
 globals.__TM_PRODUCTS_FILE_CACHE__.products[0].price=40;globals.__TM_PRODUCTS_FILE_CACHE__.generated_at='new-price';delete globals.__TM_PUBLIC_PRODUCTS_CACHE__;
 const next=await ask('Aké možnosti zliav mám pri tomto toneri?',first.state);
 assert.equal(next.discounts.offers[0].totalPrice,72);assert.equal(next.discounts.offers[1].totalPrice,120);
});
test('počet kusov sa nezabudne pri odbočke od cenovej ponuky k zľavám',async()=>{
 const two=await ask('Koľko budú stáť 2 ks tohto tonera aj s dopravou?');assert.equal(two.quote.quantity,2);
 const discounts=await ask('Aké možnosti zliav mám pri tomto toneri?',two.state);
 const total=await ask('A koľko zaplatím spolu aj s dopravou?',discounts.state);
 assert.equal(total.quote.sku,'259-C');assert.equal(total.quote.quantity,2);assert.equal(total.quote.goodsTotal,60.7);
});
