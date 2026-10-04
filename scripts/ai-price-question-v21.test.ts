import test from 'node:test';
import assert from 'node:assert/strict';
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

for(const wording of [
 'Koľko zaplatím za', 'Koľko ma to vyjde za', 'Koľko budem platiť za',
 'Aká bude cena za', 'Vypočítaj cenu za', 'Naceň mi', 'Koľko stoja'
]) test(`product quote: ${wording}`,async()=>{
 install([product(1,'HP CF226A čierny kompatibilný toner','CF226A-K','black')]);
 const a=await ask(`${wording} 2 ks, 3 ks a 4 ks kompatibilného HP CF226A po množstevnej zľave? Nič nepridávaj do košíka.`);
 const answer=a.advisor.answer.join(' ');
 for(const amount of ['32,18','48,28','53,64'])assert.ok(answer.includes(amount),answer);
 assert.doesNotMatch(answer,/Možnosti platby/);assert.equal(a.state.cart.length,0);assert.equal(a.action,null);
});
test('quote continuation keeps selected product without fulfilling pending purchase',async()=>{
 install([product(1,'HP CF226A čierny kompatibilný toner','CF226A-K','black')]);
 const first=await ask('HP CF226A kompatibilný toner');
 first.state.pendingQuestion='quantity';
 const a=await ask('Koľko ma to vyjde za 3 ks po množstevnej zľave?',first.state);
 assert.match(a.advisor.answer.join(' '),/48,28/);assert.equal(a.state.cart.length,0);assert.equal(a.action,null);
});
import {routeCommerceMessage} from '../src/lib/ai-commerce/router.ts';
import {isProductPriceQuestion} from '../src/lib/ai-commerce/price-question.ts';
for(const message of ['Ako môžem zaplatiť?', 'Môžem 3 ks zaplatiť kartou?', 'Koľko zaplatím za dopravu 3 ks?', 'Koľko stojí dobierka pri 3 ks?', 'Vráťte platbu za 3 ks.', 'Kedy bude objednávka 3 ks odoslaná?'])test(`service preserved: ${message}`,()=>{
 const state=emptyCommerceState('price-service');state.lastProductQuery='HP CF226A';state.pendingQuestion='quantity';
 assert.equal(isProductPriceQuestion(message),false);
 assert.equal(routeCommerceMessage(message,state).needsProducts,false);
});
