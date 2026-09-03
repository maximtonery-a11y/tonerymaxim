import test from 'node:test';
import assert from 'node:assert/strict';

const generatedAt = new Date().toISOString();
const fixture = (id:number, type:string, suffix:string, label:string, price:number) => ({
  id,
  sku:`TN2421-${suffix}`,
  name:`Brother TN2421 ${label} toner`,
  slug:`brother-tn2421-${suffix.toLowerCase()}`,
  price,
  stock_status:'instock',
  stock_quantity:5,
  product_type_key:type,
  product_type_label:'Toner',
});

// Samostatný testovací proces používa malý deterministický katalóg. Test tak
// overí celý endpoint bez produkčných Woo kľúčov a bez zásahu do e-shopu.
(globalThis as any).__TM_PRODUCTS_FILE_CACHE__ = {
  ok:true,
  version:4,
  generated_at:generatedAt,
  total:3,
  products:[
    fixture(1,'compatible','KOM','kompatibilný',12.9),
    fixture(2,'original','OEM','originálny',79.9),
    fixture(3,'renovated','REN','renovovaný',19.9),
  ],
};

const { POST: aiTomasPost } = await import('../src/pages/api/ai-tomas.ts');

async function ask(message:string,state:any={}){
  const response=await aiTomasPost({request:new Request('http://localhost/api/ai-tomas',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message,page:'/',state}),
  })} as any);
  assert.equal(response.status,200,message);
  return response.json() as Promise<any>;
}

test('Máte tonery na sklade → Potrebujem toner TN2421',async()=>{
  const first=await ask('Máte tonery na sklade?');
  assert.equal(first.route.productQuery,null);
  assert.equal(first.route.needsProducts,false);

  const second=await ask('Potrebujem toner TN2421',first.state);
  // Katalóg stále dostáva celý pôvodný dopyt; oprava mení iba text odpovede.
  assert.equal(second.route.productQuery,'Potrebujem toner TN2421');
  assert.equal(second.action?.kind,'ASK_PRODUCT_TYPE');
  assert.deepEqual(second.action.options,['compatible','original','renovated']);
  assert.deepEqual(second.action.counts,{compatible:1,original:1,renovated:1});
  assert.match(second.advisor.answer.join(' '),/^Pre TN2421 máme v ponuke kompatibilné, originálne alebo renovované tonery\./);
  assert.doesNotMatch(second.advisor.answer.join(' '),/Pre Potrebujem toner/i);

  for(const [answer,type] of [['Kompatibilné','compatible'],['Originálne','original'],['Renovované','renovated']] as const){
    const selected=await ask(answer,second.state);
    assert.equal(selected.state.currentType,type);
    assert.match(selected.advisor.answer.join(' '),/pre TN2421\./i);
    assert.doesNotMatch(selected.advisor.answer.join(' '),/pre Potrebujem toner/i);
    assert.equal(selected.commerce?.products?.length,1);
    assert.ok(selected.commerce.products.every((product:any)=>product.type===type));
    assert.ok(selected.commerce.products.every((product:any)=>/TN2421/i.test(`${product.name} ${product.sku}`)));
  }
});

test('TN2421 → kalendáre → Potrebujem toner TN2421 zachová čisté označenie',async()=>{
  const toner=await ask('Potrebujem toner TN2421');
  assert.equal(toner.action?.kind,'ASK_PRODUCT_TYPE');

  const compatible=await ask('Kompatibilné',toner.state);
  assert.equal(compatible.commerce?.queryLabel,'TN2421');

  // Zmena sortimentu musí starý tonerový kontext vyčistiť.
  const calendars=await ask('Aké máte diáre?',compatible.state);
  assert.equal(calendars.state.lastProductQuery,null);

  const tonerAgain=await ask('Potrebujem toner TN2421',calendars.state);
  assert.equal(tonerAgain.action?.kind,'ASK_PRODUCT_TYPE');
  assert.match(tonerAgain.advisor.answer.join(' '),/^Pre TN2421 /);

  const compatibleAgain=await ask('Kompatibilné',tonerAgain.state);
  assert.equal(compatibleAgain.commerce?.queryLabel,'TN2421');
  assert.match(compatibleAgain.advisor.answer.join(' '),/pre TN2421\./i);
  assert.doesNotMatch(JSON.stringify(compatibleAgain),/pre Potrebujem toner TN2421/i);
});
