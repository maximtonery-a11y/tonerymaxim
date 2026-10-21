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

test('snímka: po zľavách vypočíta cenu za kus pri kúpe štyroch bez nového hľadania',async()=>{
 globals.__TM_PRODUCTS_FILE_CACHE__.products[0].sku='13264';
 const first=await ask('koľko stojí tento toner?');
 const discounts=await ask('Aké sú možnosti zliav pri tomto toneri?',first.state);
 for(const question of ['takze ked kupim 4 kusy aka cena bude za jeden kus?','Takže keď kúpim štyri kusy, aká bude cena za jeden kus?','Aká bude cena za 1 ks, keď kúpim 4 ks?']){
  const result=await ask(question,discounts.state,'/doprava-a-platba');
  assert.equal(result.quote?.sku,'13264',text(result));
  assert.equal(result.quote.quantity,4);assert.equal(result.quote.discountedUnitPrice,25.29);assert.equal(result.quote.goodsTotal,101.16);assert.equal(result.quote.quantityDiscountPercent,25);
  assert.match(text(result),/25,29.*za kus/);assert.match(text(result),/101,16/);assert.doesNotMatch(text(result),/náplň nenašiel|model tlačiarne|V našej ponuke/);
  assert.equal(result.commerce,null);assert.equal(result.action,null);
 }
});

test('jednotková cena si zapamätá štyri kusy aj po odbočke k doprave',async()=>{
 const first=await ask('Koľko stojí tento toner?');
 const four=await ask('Aká bude cena za 1 ks, keď kúpim 4 ks?',first.state,'/');
 assert.equal(four.quote.quantity,4);
 const unit=await ask('Aká je cena za kus?',four.state,'/');
 assert.equal(unit.quote.quantity,4);assert.equal(unit.quote.discountedUnitPrice,25.29);
 const shipping=await ask('Koľko stojí doprava?',unit.state,'/doprava-a-platba');
 const total=await ask('A koľko zaplatím spolu aj s dopravou?',shipping.state,'/doprava-a-platba');
 assert.equal(total.quote.sku,'259-C');assert.equal(total.quote.quantity,4);assert.equal(total.quote.goodsTotal,101.16);
 assert.ok(total.quote.options.every((option:any)=>option.total===101.16));
});

test('nové množstvo a originálny variant majú vlastnú cenu bez zľavy na kompatibilné',async()=>{
 const first=await ask('Koľko stojí tento toner?');
 const three=await ask('Aká bude cena za jeden kus pri troch?',(await ask('Koľko stoja 3 ks?',first.state)).state);
 assert.equal(three.quote.quantity,3);assert.equal(three.quote.discountedUnitPrice,30.35);assert.equal(three.quote.goodsTotal,91.04);assert.match(text(three),/približne/);
 const original=await ask('Aká bude cena za 4 ks originálneho HP CF259X?',three.state,'/');
 assert.equal(original.quote.sku,'259-O');assert.equal(original.quote.quantityDiscountPercent,0);assert.equal(original.quote.goodsTotal,516);assert.equal(original.quote.discountedUnitPrice,129);
});

test('nový otvorený produkt ani neznámy kód nezdedia cenu starého tonera',async()=>{
 const first=await ask('Koľko stojí tento toner?');
 const brother=await ask('Aká bude cena za 4 ks tohto tonera?',first.state,'/produkt/brother-tn2421-kompatibilny');
 assert.equal(brother.quote.sku,'BRO-C');assert.equal(brother.quote.discountedUnitPrice,7.5);assert.equal(brother.quote.goodsTotal,30);
 const unknown=await ask('Aká bude cena za 4 ks HP CF999999?',first.state);
 assert.equal(unknown.quote,null);assert.doesNotMatch(text(unknown),/25,29|101,16|33,72/);assert.equal(unknown.action.kind,'CLARIFY_PRODUCT');
});

test('jednotková cena odmietne neplatný počet a načíta novú cenu namiesto starej odpovede',async()=>{
 const first=await ask('Koľko stojí tento toner?');
 for(const amount of ['0','-4','4,5','100']){
  const invalid=await ask(`Keď kúpim ${amount} ks, aká bude cena za jeden kus?`,first.state);
  assert.equal(invalid.quote,null,amount);assert.match(text(invalid),/celé číslo od 1 do 99/);
 }
 globals.__TM_PRODUCTS_FILE_CACHE__.products[0].price=40;globals.__TM_PRODUCTS_FILE_CACHE__.generated_at='new-unit-price';delete globals.__TM_PUBLIC_PRODUCTS_CACHE__;
 const fresh=await ask('Keď kúpim 4 ks, aká bude cena za jeden kus?',first.state);
 assert.equal(fresh.quote.discountedUnitPrice,30);assert.equal(fresh.quote.goodsTotal,120);assert.doesNotMatch(text(fresh),/25,29|101,16/);
});
