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
  assert.notEqual(second.action?.kind,'ASK_PRODUCT_TYPE');
  assert.deepEqual([...new Set(second.commerce.products.map((product:any)=>product.type))],['compatible','original','renovated']);
  assert.equal(second.state.cart.length,0);

  for(const [answer,type] of [['Kompatibilné','compatible'],['Originálne','original'],['Renovované','renovated']] as const){
    const selected=await ask(`Zobraz ${answer.toLocaleLowerCase('sk-SK')}`,second.state);
    assert.equal(selected.state.currentType,type);
    assert.equal(selected.commerce?.queryLabel,'TN2421');
    assert.equal(selected.commerce?.products?.length,1);
    assert.ok(selected.commerce.products.every((product:any)=>product.type===type));
    assert.ok(selected.commerce.products.every((product:any)=>/TN2421/i.test(`${product.name} ${product.sku}`)));
  }
});

test('TN2421 → kalendáre → Potrebujem toner TN2421 zachová čisté označenie',async()=>{
  const toner=await ask('Potrebujem toner TN2421');
  assert.notEqual(toner.action?.kind,'ASK_PRODUCT_TYPE');
  assert.deepEqual([...new Set(toner.commerce.products.map((product:any)=>product.type))],['compatible','original','renovated']);

  const compatible=await ask('Zobraz kompatibilné',toner.state);
  assert.equal(compatible.commerce?.queryLabel,'TN2421');

  // Zmena sortimentu musí starý tonerový kontext vyčistiť.
  const calendars=await ask('Aké máte diáre?',compatible.state);
  assert.equal(calendars.state.lastProductQuery,null);

  const tonerAgain=await ask('Potrebujem toner TN2421',calendars.state);
  assert.notEqual(tonerAgain.action?.kind,'ASK_PRODUCT_TYPE');
  assert.deepEqual([...new Set(tonerAgain.commerce.products.map((product:any)=>product.type))],['compatible','original','renovated']);

  const compatibleAgain=await ask('Zobraz kompatibilné',tonerAgain.state);
  assert.equal(compatibleAgain.commerce?.queryLabel,'TN2421');
  assert.doesNotMatch(JSON.stringify(compatibleAgain),/pre Potrebujem toner TN2421/i);
});
