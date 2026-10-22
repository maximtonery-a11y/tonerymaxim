import test from 'node:test';
import assert from 'node:assert/strict';
import { printerSelectionAdvice, POST } from '../src/pages/api/ai-tomas.ts';

const page='/produkt/brother-tn-2421-cierny-kompatibilny-toner';
async function ask(message:string,state:any={}){
  const response=await POST({request:new Request('http://localhost/api/ai-tomas',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message,page,state})
  })} as any);
  assert.equal(response.status,200);
  return response.json() as Promise<any>;
}

test('Recommended printer is NOT a toner price question',async()=>{
  const response=await ask('Vieš mi odporučiť tlačiareň kde je najlacnejšia cena za vytlačenú stranu?',{
    lastProductQuery:'TN2421',history:[
      {role:'user',content:'Koľko zaplatím za 2 tonery s DPD a dobierkou?',topic:'product',productReference:'SKU: TN2421'},
      {role:'assistant',content:'28,59 €',topic:'product',productReference:'SKU: TN2421'}
    ],cart:[]
  });
  assert.equal(response.advisor.intent,'printer_selection');
  assert.equal(response.route.productQuery,null);
  assert.equal(response.commerce,null);
  assert.match(response.advisor.answer.join(' '),/čiernobielu alebo farebnú/);
  assert.equal(response.state.cart.length,0);
});

test('Explicit correction is not interpreted as return to toner',async()=>{
  const response=await ask('Nie, myslím či mi vieš odporučiť tlačiareň, nie toner',{
    lastProductQuery:'TN2421',history:[
      {role:'user',content:'Vieš mi odporučiť tlačiareň kde je najlacnejšia cena za vytlačenú stranu?',topic:'product'},
      {role:'assistant',content:'Myslíte produkt TN2421?',topic:'product'}
    ],cart:[]
  });
  assert.equal(response.advisor.intent,'printer_selection');
  assert.equal(response.route.productQuery,null);
  assert.match(response.advisor.answer.join(' '),/tlačiareň/);
  assert.doesNotMatch(response.advisor.answer.join(' '),/ku ktorému produktu/);
});

test('Ordinary toner request remains unchanged',()=>{
  assert.equal(printerSelectionAdvice('Koľko zaplatím za 4 kusy TN2421?'),null);
  assert.equal(printerSelectionAdvice('Do akej tlačiarne pasuje tento toner?'),null);
  assert.equal(printerSelectionAdvice('Akú tlačiareň odporúčaš na lacnú tlač?')!==null,true);
});
