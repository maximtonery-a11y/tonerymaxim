import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCommerce } from '../src/lib/ai-commerce/engine.ts';
import { priceForQuantity } from '../src/lib/ai-commerce/pricing.ts';
import { POST } from '../src/pages/api/ai-tomas.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
const g=globalThis as any;
let generation=0;
function product(id:number, name:string, sku:string, color:string, type='compatible',price=17.88,stock=10){return {id,name,sku,slug:`test-${id}`,price,stock_status:stock?'instock':'outofstock',stock_quantity:stock,product_type_key:type,color,compatible_printers:[]};}
function install(products:any[], stamp?:string){
 g.__TM_PRODUCTS_FILE_CACHE__={ok:true,version:4,runtime_compact:true,generated_at:stamp||`v2-test-${++generation}`,total:products.length,products};
 delete g.__TM_PUBLIC_PRODUCTS_CACHE__;delete g.__TM_PRODUCTS_LOOKUP_INDEX__;
}
async function ask(message:string,state:any=emptyCommerceState('stability-v2')){
 const response=await POST({request:new Request('http://localhost/api/ai-tomas',{method:'POST',body:JSON.stringify({message,state})})} as any);
 assert.equal(response.status,200);return response.json();
}
test('catalogue generation refreshes cached prices and stock immediately',async()=>{
 install([product(1,'HP CF226A čierny kompatibilný toner','TEST1234','black')]);
 const a=await searchCommerce('TEST1234');assert.equal(a.products[0].price,17.88);
 assert.strictEqual(await searchCommerce('TEST1234'),a);
 install([product(1,'HP CF226A čierny kompatibilný toner','TEST1234','black','compatible',22.51,3)]);
 const b=await searchCommerce('TEST1234');assert.equal(b.products[0].price,22.51);assert.equal(b.products[0].stock_quantity,3);assert.notStrictEqual(a,b);
});
test('replacement array with equal timestamp does not reuse old AI results',async()=>{
 install([product(1,'HP CF226A čierny toner','TEST1234','black')],'same');await searchCommerce('TEST1234');
 install([product(1,'HP CF226A čierny toner','TEST1234','black','compatible',25)],'same');
 assert.equal((await searchCommerce('TEST1234')).products[0].price,25);
});
test('concurrent identical queries share results within one generation',async()=>{
 install([product(1,'HP CF226A čierny toner','TEST1234','black')]);
 const answers=await Promise.all(Array.from({length:20},()=>searchCommerce('TEST1234')));
 for(const answer of answers)assert.strictEqual(answer,answers[0]);
});
test('Ricoh black request never adds the magenta OEM in a following turn',async()=>{
 install([product(41165,'Ricoh 841297 purpurový originálny toner','027303','magenta','original')]);
 const a=await ask('Hľadám Ricoh 841297 presný čierny toner. Nič nepridávaj do košíka.');
 assert.equal(a.commerce.products.length,0);assert.match(a.advisor.answer.join(' '),/farbe|farbu/);
 const b=await ask('Pridaj 1 kus.',a.state);
 assert.notEqual(b.action?.kind,'ADD_TO_CART');assert.equal(b.state.cart.length,0);
});
test('correct colour remains buyable; old selected ID cannot override colour',async()=>{
 install([product(1,'HP CF226A čierny kompatibilný toner','CF226A-K','black')]);
 const a=await ask('HP CF226A čierny kompatibilný toner');
 const b=await ask('Pridaj 2 kusy.',a.state);assert.equal(b.action?.kind,'ADD_TO_CART');assert.equal(b.action.product.id,1);assert.equal(b.action.quantity,2);
 install([product(1,'HP CF226A čierny kompatibilný toner','CF226A-K','magenta')]);
 const c=await ask('Pridaj 1 kus.',a.state);assert.notEqual(c.action?.kind,'ADD_TO_CART');assert.equal(c.state.cart.length,0);
});
test('missing requested type is never replaced by a different type',async()=>{
 install([product(1,'HP CF226A čierny kompatibilný toner','CF226A-K','black')]);
 const a=await ask('Pridaj 1 ks originálneho HP CF226A čierneho toneru.');
 assert.notEqual(a.action?.kind,'ADD_TO_CART');assert.equal(a.state.cart.length,0);
});
test('short unbranded codes clarify; explicit SKU and quantity remain allowed',async()=>{
 install([product(1,'Samsung MLT-R116 kompatibilný valec','116','black')]);
 for(const text of ['116','Hľadám toner 116','711']){
  const a=await ask(text);assert.equal(a.action?.kind,'CLARIFY_PRODUCT',text);assert.equal(a.commerce,null);assert.match(a.advisor.answer.join(' '),/značku.*OEM/);
 }
 const explicit=await ask('SKU 116');assert.notEqual(explicit.commerce,null);assert.ok(explicit.commerce.products.length);
 const state=explicit.state;state.pendingQuestion='quantity';state.currentType='compatible';
 const b=await ask('2',state);assert.notEqual(b.advisor?.answer?.[0]?.includes('Označenie'),true);
});
test('quantity totals follow checkout line rounding including half-cent cases',()=>{
 for(const price of [0.05,0.15,2.88,17.88,19.99,99.95])for(const type of ['compatible','original','renovated'])for(const q of [1,2,3,4,7,99]){
  const original=Math.round(price*q*100)/100;const rate=type==='compatible'?(q>=4?.25:q>=2?.1:0):0;
  const expected=Math.max(0,Math.round((original-Math.round(original*rate*100)/100)*100)/100);
  assert.equal(priceForQuantity(price,type,q).totalPrice,expected,`${price}/${type}/${q}`);
 }
 assert.deepEqual([2,3,4].map(q=>priceForQuantity(17.88,'compatible',q).totalPrice),[32.18,48.28,53.64]);
 assert.equal(priceForQuantity(10,'calendar',3).totalPrice,28.5);
});
test('requested 2/3/4-piece prices are explicitly stated without cart mutation',async()=>{
 install([product(1,'HP CF226A čierny kompatibilný toner','CF226A-K','black')]);
 const a=await ask('Koľko stojí kompatibilný HP CF226A za 2 ks, 3 ks a 4 ks so zľavou? Nič nepridávaj do košíka.');
 const text=a.advisor.answer.join(' ');
 for(const amount of ['32,18','48,28','53,64'])assert.ok(text.includes(amount),text);
 assert.equal(a.state.cart.length,0);assert.notEqual(a.action?.kind,'ADD_TO_CART');
});

test('audit reads commerce cards even when advisor products is empty',async()=>{
 const {displayedProducts}=await import('./audit-ai-stability-v2.mjs');
 assert.deepEqual(displayedProducts({advisor:{products:[]},commerce:{products:[{id:1}]}}),[{id:1}]);
 assert.deepEqual(displayedProducts({advisor:{products:[{id:2}]},commerce:null}),[{id:2}]);
 assert.deepEqual(displayedProducts({advisor:{products:[]},commerce:{products:[]}}),[]);
});

test('an old in-flight generation cannot replace the latest result',async()=>{
 install([product(1,'HP CF226A čierny toner','TEST1234','black','compatible',10)]);
 const old=searchCommerce('TEST1234');
 await Promise.resolve();
 install([product(1,'HP CF226A čierny toner','TEST1234','black','compatible',30)]);
 const current=searchCommerce('TEST1234');
 await Promise.all([old,current]);
 assert.equal((await searchCommerce('TEST1234')).products[0].price,30);
});
