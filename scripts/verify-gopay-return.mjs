// Real built checkout/cart/receipt scripts with isolated payment transports.
// Every mutation is intercepted. No production order, payment or email is made.
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
Object.assign(process.env, { ASTRO_NODE_AUTOSTART: 'disabled', TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', OPENAI_ASSISTANT_ENABLED: '0' });
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Payment browser fixture prohibits external server traffic'); };
const { handler } = await import(pathToFileURL(resolve('dist/server/entry.mjs')));
const server = http.createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium, webkit } = await import(process.env.TM_PLAYWRIGHT_MODULE || 'playwright');
const product = { id: '123', sku: 'FIXTURE-123', name: 'Testovací kompatibilný toner', qty: 1, price: 20, product_type_key: 'compatible', product_type_label: 'KOMPATIBILNÝ', source: '', stock_status: 'instock', stock_quantity: 99, image: '/images/tm-product-placeholder-box.jpg', url: '/produkt/fixture' };
const extra = { ...product, id: '124', sku: 'NEW-PURCHASE', name: 'Nový nákup', price: 12 };
const reports = [];
const money = text => Math.round(Number(text.replace(/[^0-9,.-]/g, '').replace(',', '.')) * 100);
async function fixture(browser, width, options = {}) {
 const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
 /** @type {Record<string, any>} */
 const state = { create: 0, offline: 0, change: 0, benefits: 0, requests: [], status: 'CANCELED', last: null, preview: null, storedState: 'CREATED', errors: [], ...options };
 await context.addInitScript(({product,empty}) => {
   if(!localStorage.getItem('tm_fixture_seeded')){localStorage.clear();localStorage.setItem('tm_cart_v1',JSON.stringify(empty?[]:[product]));localStorage.setItem('tm_fixture_seeded','1');}
   sessionStorage.setItem('tm_header_account_v1', JSON.stringify({ customer: { id:7 }, expiresAt:Date.now()+300000 }));
 }, { product, empty: options.empty });
 const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
 await context.route('**/*', async route => {
   const req=route.request(), url=new URL(req.url());
   if(url.hostname==='gateway.example.invalid') return route.fulfill({contentType:'text/html',body:`<h1>Testovacia brána</h1><a id="return" href="${origin}/platba-dokoncena?id=1001">Vrátiť sa</a>`});
   if(url.origin!==origin) return route.fulfill({contentType:req.resourceType()==='script'?'application/javascript':'text/plain',body:''});
   if(!url.pathname.startsWith('/api/')) return route.continue();
   if(url.pathname==='/api/cart-benefits'){
     state.benefits++;if(state.benefitsGate)await state.benefitsGate;
     const body=req.postDataJSON();
     return json(route,{ok:true,customerId:7,loyalty:{ok:true,points:0,discountValue:0,paperReward:null},coupon:state.discount&&!body.couponDisabled?{ok:true,code:'TEST5',percent:5,scope:'compatible'}:null});
   }
   if(url.pathname==='/api/gopay-create'){
     state.create++;state.last=req.postDataJSON();
     state.requests.push(state.last);
     if(state.couponRace&&state.create===1){state.discount=false;return json(route,{ok:false,code:'COUPON_UNAVAILABLE',orderCreated:false,error:'Kupón už bol použitý.'},400);}
     if(state.failCreate)return json(route,{ok:false,error:'Testovacia chyba pred prijatím objednávky.'},503);
     state.preview={...state.last,orderNumber:String(301000+state.create),total:23.9};
     return json(route,{ok:true,paymentId:String(1000+state.create),orderNumber:String(301000+state.create),gwUrl:'https://gateway.example.invalid/pay'});
   }
   if(url.pathname==='/api/gopay-status')return json(route,{ok:true,state:state.status,storedState:state.storedState,pending:{orderNumber:'301001',paymentCode:state.preview.payment},payment:{order_number:'301001'},preview:state.preview});
   if(url.pathname==='/api/gopay-change-payment'){
     state.change++;const body=req.postDataJSON();assert.equal(body.paymentId,'1001');
     const paymentPrice=body.payment==='cod'?1.2:0;
     state.preview={...state.preview,payment:body.payment,paymentPrice,total:23.9+paymentPrice};state.storedState='CONVERTED_TO_OFFLINE';
     return json(route,{ok:true,orderId:999,orderNumber:'301001',payment:body.payment,preview:state.preview});
   }
   if(url.pathname==='/api/order-create'){
     assert(state.allowNewOfflineOrder,'Changing an accepted order attempted a new order');
     state.offline++;state.last=req.postDataJSON();state.requests.push(state.last);
     return json(route,{ok:true,orderId:999,orderNumber:'301002'});
   }
   if(url.pathname==='/api/products')return json(route,{ok:true,products:[product,extra]});
   if(url.pathname==='/api/auth/me'||url.pathname==='/api/account/me')return json(route,{ok:true,customer:{id:7,email:'test@example.invalid'}});
   return json(route,{ok:true});
 });
 const page=await context.newPage();page.on('pageerror',error=>state.errors.push(error.message));page.setDefaultTimeout(10000);
 return {context,page,state};
}
async function openCheckout(page){
 await page.goto(origin+'/pokladna');await page.waitForFunction(()=>window.__TM_CHECKOUT_INIT__);
 await page.evaluate(()=>{
   for(const [name,value] of Object.entries({email:'test@example.invalid',phone:'+421900000000',first_name:'Test',last_name:'Zákazník',address:'Test 1',city:'Test',zip:'97401'})){
     const el=document.querySelector(`[name="${name}"]`);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
   }
   document.querySelector('#terms').checked=true;document.querySelector('#tm-cookie-reject')?.click();
 });
}
async function submit(page){await page.evaluate(()=>document.querySelector('[data-submit-order]').click());}
try {
 for(const name of (process.env.TM_BROWSER_ENGINES||'chromium,webkit').split(',')){
  const engine=name==='webkit'?webkit:chromium;
  const browser=await engine.launch(name==='chromium'?{executablePath:process.env.TM_CHROMIUM_PATH,args:process.env.TM_CHROMIUM_ARGS?JSON.parse(process.env.TM_CHROMIUM_ARGS):['--no-sandbox']}:{});
  try{
   for(const width of [390,1280])for(const mode of ['CANCELED','TIMEOUTED','FAILED','CREATED','PAYMENT_METHOD_CHOSEN','PAID','UNKNOWN']){
     const {context,page,state}=await fixture(browser,width,{status:mode});
     try{
       await openCheckout(page);await submit(page);await page.waitForURL('https://gateway.example.invalid/**');
       const other=await context.newPage();await other.goto(origin+'/kosik');
       assert.deepEqual(await other.evaluate(()=>JSON.parse(localStorage.getItem('tm_cart_v1'))),[],'Cart is consumed before the gateway return');
       await other.evaluate(extra=>window.ToneryMaximCart.saveCart([extra]),extra);
       await page.locator('#return').click();
       if(mode==='PAID')await page.locator('[data-title]').getByText('Ďakujeme. Objednávku máme.').waitFor();
       else if(mode==='UNKNOWN')await page.locator('[data-title]').getByText('Stav platby sa nepodarilo overiť.').waitFor();
       else{
         await page.locator('[data-gopay-change]').click();
         const payment=width===390?'cod':'bank_prepaid';await page.locator('#order-payment-method').selectOption(payment);
         await page.locator('[data-order-payment-form] button').click();
         await page.waitForFunction(()=>document.querySelector('[data-title]')?.textContent==='Ďakujeme. Objednávku máme.');
         assert.equal(state.change,1);assert.equal(state.preview.payment,payment);
         assert.equal(money(await page.locator('[data-total]').textContent()),payment==='cod'?2510:2390);
         await page.reload();await page.locator('[data-title]').getByText('Ďakujeme. Objednávku máme.').waitFor();
       }
       assert.equal(state.create,1);assert.deepEqual(await other.evaluate(()=>JSON.parse(localStorage.getItem('tm_cart_v1')).map(({sku,qty,price,source})=>({sku,qty,price,source}))),[{sku:extra.sku,qty:1,price:12,source:''}]);
       assert.equal(await page.locator('[data-gopay-retry]').count(),0);
       assert.deepEqual(state.errors,[]);reports.push(`${name} ${width} ${mode}: one order, empty old cart, preserved new cart`);
     }finally{await context.close();}
   }
   {
     const {context,page,state}=await fixture(browser,390);
     try{
       await openCheckout(page);await submit(page);await page.waitForURL('https://gateway.example.invalid/**');
       await page.goBack();await page.waitForURL('**/platba-dokoncena?id=1001');
       await page.locator('[data-gopay-change]').waitFor();assert.equal(state.create,1);
       assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('tm_cart_v1'))),[]);
       reports.push(`${name}: browser Back returns to the saved order`);
     }catch(error){
       console.error('Back navigation fixture:',page.url(),await page.evaluate(()=>({cart:localStorage.getItem('tm_cart_v1'),receipt:localStorage.getItem('tm_submitted_gopay_v1'),errors:document.querySelector('[data-order-status]')?.textContent})),state.errors);
       throw error;
     }finally{await context.close();}
   }
   {
     const {context,page,state}=await fixture(browser,1280,{failCreate:true});
     try{await openCheckout(page);await submit(page);await page.getByText('Testovacia chyba pred prijatím objednávky.',{exact:true}).waitFor();
       assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tm_cart_v1')).length),1);
       assert.equal(await page.evaluate(()=>localStorage.getItem('tm_submitted_gopay_v1')),null);assert.deepEqual(state.errors,[]);
       reports.push(`${name}: failed creation preserves the cart`);
     }finally{await context.close();}
   }
   {
     const {context,page,state}=await fixture(browser,390);
     try{
       await openCheckout(page);await submit(page);await page.waitForURL('https://gateway.example.invalid/**');
       const next=await context.newPage();await next.goto(origin+'/kosik');await next.evaluate(product=>window.ToneryMaximCart.saveCart([product]),product);
       await openCheckout(next);await submit(next);await next.waitForURL('https://gateway.example.invalid/**');
       assert.equal(state.create,2);assert.equal(await next.goto(origin+'/kosik').then(()=>next.evaluate(()=>JSON.parse(localStorage.getItem('tm_submitted_gopay_v1')).paymentId)),'1002');
       assert.equal(await next.evaluate(()=>JSON.parse(localStorage.getItem('tm_cart_v1')).length),0);
       reports.push(`${name}: a new identical purchase is independent of the previous unpaid order`);
     }finally{await context.close();}
   }
   for(const payment of ['gopay','cod','bank_prepaid']) {
     const {context,page,state}=await fixture(browser,390,{allowNewOfflineOrder:true});
     try{
       await openCheckout(page);
       await page.evaluate(product=>{
         const old='legacy-already-submitted';
         const cartSignature=JSON.stringify([{id:String(product.id),sku:product.sku,qty:product.qty,price:product.price,source:product.source}]);
         localStorage.setItem('tm_submitted_gopay_v1',JSON.stringify({requestId:old,paymentId:'old-payment',submittedAt:Date.now(),cartSignature}));
         localStorage.setItem('tm_checkout_intent_v2',JSON.stringify({requestId:old,cartSignature}));sessionStorage.setItem('tm_checkout_request_id',old);
         localStorage.setItem('cart',JSON.stringify([product]));
         window.ToneryMaximCart.clearCart();window.ToneryMaximCart.addToCart(product);
       },product);
       await openCheckout(page);
       await page.evaluate(payment=>document.querySelector(`[name="payment"][value="${payment}"]`).click(),payment);
       await submit(page);await page.waitForURL(payment==='gopay'?'https://gateway.example.invalid/**':'**/platba-dokoncena?order=**');
       assert.notEqual(state.last.requestId,'legacy-already-submitted');assert.equal(state.last.payment,payment);assert.equal(state.change,0);
       assert.equal(state.create+state.offline,1);assert.deepEqual(state.errors,[]);
       reports.push(`${name}: clearing/refilling an identical cart resets old order blockers for ${payment}`);
     }finally{await context.close();}
   }
   {
     const {context,page,state}=await fixture(browser,1280,{discount:true});
     try{
       await openCheckout(page);await page.locator('[data-summary-coupon-line]').waitFor({state:'visible'});
       await page.getByRole('button',{name:'Nepoužiť kupón',exact:true}).click();
       await page.locator('[data-summary-coupon-line]').waitFor({state:'hidden'});
       assert.equal(await page.evaluate(()=>localStorage.getItem('tm_coupon_disabled_v1')),'1');
       await page.reload();await page.getByRole('button',{name:'Použiť automatickú zľavu',exact:true}).waitFor();
       await page.goto(origin+'/kosik');await page.getByRole('button',{name:'Použiť automatickú zľavu',exact:true}).waitFor();
       await openCheckout(page);await submit(page);await page.waitForURL('https://gateway.example.invalid/**');
       assert.equal(state.last.coupon,null);assert.deepEqual(state.errors,[]);
       reports.push(`${name}: a customer can remove the automatic coupon through reload, cart and checkout`);
     }finally{await context.close();}
   }
   {
     const {context,page,state}=await fixture(browser,390,{discount:true,couponRace:true});
     try{
       await openCheckout(page);await submit(page);
       await page.locator('[data-order-status]').getByText('Kupón už nie je dostupný.',{exact:false}).waitFor();
       assert.equal(state.create,1);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tm_cart_v1')).length),1);
       await page.waitForFunction(()=>!document.querySelector('[data-submit-order]').disabled);
       await submit(page);await page.waitForURL('https://gateway.example.invalid/**');
       assert.equal(state.create,2);assert.equal(state.last.coupon,null);
       assert.equal(state.requests[0].requestId,state.requests[1].requestId,'Pre-creation coupon rejection can retry the same safe submission');
       assert.deepEqual(state.errors,[]);
       reports.push(`${name}: a coupon redeemed during checkout refreshes totals and allows a new confirmed submission`);
     }finally{await context.close();}
   }
   {
     let release;const gate=new Promise(resolve=>{release=resolve});const {context,page,state}=await fixture(browser,390,{benefitsGate:gate});
     try{
       await openCheckout(page);await page.evaluate(()=>{for(let n=0;n<100;n++)document.querySelector('[data-submit-order]').click()});
       assert.equal(state.create,0);release();await page.waitForURL('https://gateway.example.invalid/**');assert.equal(state.create,1);
       reports.push(`${name}: 100 clicks while personal discounts load create one order`);
     }finally{release();await context.close();}
   }
   {
     let release;const gate=new Promise(resolve=>{release=resolve});
     const {context,page,state}=await fixture(browser,1280,{empty:true,benefitsGate:gate,discount:true});
     try{
       await page.goto(origin+'/kosik');await page.waitForFunction(()=>window.ToneryMaximCart);
       await page.evaluate(product=>{window.ToneryMaximCart.addToCart({...product,qty:4});window.ToneryMaximCart.renderCartPage();window.ToneryMaximCart.showAddCartDrawer(product)},product);
       await page.locator('[data-add-cart-drawer]').waitFor({state:'visible'});
       await page.locator('[data-add-cart-summary]').getByText('60,00 € s DPH',{exact:true}).waitFor();
       assert.ok(state.benefits<=1);assert.equal(money(await page.locator('[data-cart-total]').textContent()),6000);
       await page.evaluate(()=>{window.__cartRow=document.querySelector('[data-cart-list] article')});
       release();await page.waitForFunction(()=>document.querySelector('[data-cart-total]')?.textContent.includes('57,00'));
       assert(await page.evaluate(()=>window.__cartRow===document.querySelector('[data-cart-list] article')),'Personal discounts must not rebuild product rows');
       await page.goto(origin+'/pokladna');await page.waitForFunction(()=>document.querySelector('[data-summary-total]')?.textContent.includes('57,00'));
       assert.equal(state.benefits,1,'Checkout reuses the verified benefits from cart');assert.deepEqual(state.errors,[]);
       reports.push(`${name}: immediate quantity price during slow benefits, stable rows and one lookup across checkout`);
     }finally{release();await context.close();}
   }
  }finally{await browser.close();}
 }
 console.log(JSON.stringify({ok:true,checks:reports.length,reports,realOrders:0,realPayments:0,emails:0}));
}finally{globalThis.fetch=savedFetch;server.closeAllConnections();await new Promise(r=>server.close(r));}
