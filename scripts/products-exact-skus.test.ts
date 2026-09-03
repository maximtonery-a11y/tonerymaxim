import test from 'node:test';
import assert from 'node:assert/strict';

(globalThis as any).__TM_PRODUCTS_FILE_CACHE__={
  ok:true,version:4,generated_at:new Date().toISOString(),total:3,products:[
    {id:1,sku:'15048',name:'Brother TN-2421 čierny kompatibilný toner',slug:'brother-tn-2421-cierny-kompatibilny-toner',price:14.01,stock_status:'outofstock',stock_quantity:0},
    {id:2,sku:'039860',name:'Brother TN-2421 čierny originálny toner',slug:'brother-tn-2421-cierny-originalny-toner',price:104.66,stock_status:'instock',stock_quantity:46},
    {id:3,sku:'INÉ',name:'Iný produkt',slug:'iny-produkt',price:1,stock_status:'instock',stock_quantity:1},
  ],
};

const {GET}=await import('../src/pages/api/products.ts');

test('košíkový API dotaz vráti jedinou odpoveď s presnými SKU',async()=>{
  const response=await GET({url:new URL('http://localhost/api/products?skus=15048%2C039860')} as any);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json() as any;
  assert.equal(data.source,'local-products-cache-exact-skus');
  assert.deepEqual(data.products.map((product:any)=>product.sku),['15048','039860']);
  assert.equal(data.products[0].stock_status,'outofstock');
  assert.equal(data.products[0].stock_quantity,0);
  assert.equal(data.products[0].detail_url,'/produkt/brother-tn-2421-cierny-kompatibilny-toner');
});
