// Isolated HTTP checkout integration with mocked Woo and GoPay transports.
// It never contacts a real gateway, creates a Woo order, or sends an email.
// node scripts/verify-predeploy-purchase.mjs --catalog /abs/products.json --output /abs/report.json
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, createHash, createHmac, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2), option = name => args[args.indexOf('--' + name) + 1];
assert.ok(args.includes('--catalog') && args.includes('--output'));
const root = resolve(args.includes('--root') ? option('root') : process.cwd());
const output = resolve(option('output'));
const catalog = JSON.parse(await readFile(resolve(option('catalog')), 'utf8'));
const byId = new Map(catalog.products.map(p => [Number(p.id), p]));
const set = byId.get(52830), hp = byId.get(37637); assert.ok(set && hp);
assert.equal(Number(set.price), 75.20); assert.equal(Number(hp.price), 12.39);
const temp = await mkdtemp(join(tmpdir(), 'tm-purchase-http-')), cache = join(temp, 'product-cache'); await mkdir(cache);
await writeFile(join(cache, 'products.json'), JSON.stringify(catalog));
const secret = randomBytes(48).toString('hex');
let paymentMode = 'ok', livePrice = null, removed = false, wooWrites = 0, otherOutbound = 0;
const payments = [], transports = [], checks = [], gatewayStates = new Map();
const mock = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost'); let body = '';
  for await (const chunk of request) body += chunk;
  transports.push({ method: request.method, path: url.pathname });
  if (url.pathname === '/wp-json/wc/v3/products' && request.method === 'GET') {
    const ids = String(url.searchParams.get('include') || '').split(',').map(Number);
    const rows = removed ? [] : ids.map(id => byId.get(id)).filter(Boolean).map(p => ({ id: p.id, sku: p.sku, name: p.name, price: livePrice ?? p.price, status: 'publish' }));
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(rows)); return;
  }
  if (url.pathname === '/gopay/api/oauth2/token') { response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"access_token":"local-test-token","expires_in":3600}'); return; }
  if (url.pathname.startsWith('/gopay/api/payments/payment/') && request.method === 'GET') {
    const id = Number(url.pathname.split('/').at(-1)), original = payments[id - 900001];
    assert.ok(original);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...original, id, state: gatewayStates.get(id) || 'CREATED', gw_url: `https://example.invalid/test-payment/${id}` })); return;
  }
  if (url.pathname === '/gopay/api/payments/payment') {
    const data = JSON.parse(body); payments.push(data);
    if (paymentMode === 'failure') { response.writeHead(503, { 'Content-Type': 'application/json' }).end('{"errors":[{"message":"Local simulated gateway failure"}]}'); return; }
    const id = 900000 + payments.length;
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, state: 'CREATED', gw_url: `https://example.invalid/test-payment/${id}` })); return;
  }
  wooWrites++; response.writeHead(500).end('Unexpected local transport request');
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${mock.address().port}`, port = 4482, base = `http://127.0.0.1:${port}`;
const shim = join(temp, 'transport.mjs');
await writeFile(shim, `import os from 'node:os';os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});const original=globalThis.fetch;globalThis.fetch=async(input,...args)=>{const url=new URL(String(input));if(url.origin===${JSON.stringify(origin)})return original(input,...args);if(url.origin==='https://gw.sandbox.gopay.com')return original(${JSON.stringify(origin)}+'/gopay'+url.pathname+url.search,...args);console.log('PURCHASE_BLOCKED_OUTBOUND');throw new Error('Offline purchase fixture rejects external requests');};`);
const child = spawn(process.execPath, ['--import', shim, join(root, 'dist/server/entry.mjs')], { cwd: root,
  env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', TM_PERSISTENT_DATA_DIR: temp, TM_CACHE_DIR: cache,
    AUTH_SECRET: secret, TM_PERSISTENCE_SECRET: secret, TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', TM_ASYNC_WOO_INITIAL_DELAY_MS: '3600000',
    WOO_URL: origin, WOO_CONSUMER_KEY: 'ck_local', WOO_CONSUMER_SECRET: 'cs_local', GOPAY_ENV: 'sandbox', GOPAY_GOID: '999999',
    GOPAY_CLIENT_ID: 'local-client', GOPAY_CLIENT_SECRET: 'local-secret', GOPAY_RETURN_URL: 'https://example.invalid/return', GOPAY_NOTIFY_URL: 'https://example.invalid/notify', OPENAI_ASSISTANT_ENABLED: '0' },
  stdio: ['ignore','pipe','pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
const exited = new Promise(r => child.once('exit', r));
const delay = ms => new Promise(r => setTimeout(r, ms));
const empty = { contact: { email: 'fixture@example.invalid', phone: '+421900000000' }, billing: { firstName: 'Test', lastName: 'Fixture', address: 'Testovacia 1', city: 'Test', zip: '97401' }, delivery: {}, termsAccepted: true,
  shipping: { method: 'dpd_courier' }, payment: 'cod', cart: [] };
function payload(id, cart, overrides = {}) { return { ...structuredClone(empty), requestId: id, cart, ...overrides }; }
async function post(path, body, status, label, extraHeaders = {}) {
  const started = performance.now();
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type':'application/json', Origin:base, ...extraHeaders }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json(); assert.equal(response.status, status, `${label}: ${JSON.stringify(data)}`);
  checks.push({ label, path, status, elapsedMs: Math.round(performance.now()-started), ok:data.ok }); return data;
}
async function jobs() { return (await readdir(join(temp,'async-orders','pending')).catch(()=>[])).filter(f=>f.endsWith('.json')); }
async function source(number) {
  const envelope = JSON.parse(await readFile(join(temp, 'async-orders', 'pending', number + '.json'), 'utf8'));
  assert.equal(envelope.signature, createHmac('sha256', secret).update(`${envelope.iv}.${envelope.tag}.${envelope.ciphertext}`).digest('hex'));
  const key = createHash('sha256').update('tonerymaxim:persistence:v2:' + secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64')); decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8')).source;
}
try {
  for(let i=0;i<100&&!logs.includes('Server listening');i++){ assert.equal(child.exitCode,null,logs);await delay(100); }
  assert.ok(logs.includes('Server listening'), logs);
  for(const [path,payment] of [['/api/order-create','cod'],['/api/gopay-create','gopay']]) {
    const d=await post(path,payload('empty-'+payment,[],{payment}),400,'empty-cart-'+payment); assert.match(d.error,/Košík je prázdny/);
    await post(path,payload('no-terms-'+payment,[{id:52830,sku:set.sku,qty:1}],{payment,termsAccepted:false}),400,'missing-consent-'+payment);
  }
  await post('/api/order-create',payload('no-point',[{id:52830,sku:set.sku,qty:1}],{shipping:{method:'dpd_box'}}),400,'missing-pickup-point');
  await post('/api/order-create',payload('unknown',[{sku:'DOES-NOT-EXIST',qty:1}]),409,'unknown-product');
  assert.equal((await jobs()).length,0);assert.equal(payments.length,0);
  const cart=[{id:52830,sku:set.sku,qty:3,price:0.01,name:'Untrusted client name'}];
  const body=payload('canon-three',cart);
  const created=await post('/api/order-create',body,202,'three-sets-cod');
  const three=await source(created.orderNumber);assert.equal(three.subtotal,203.04);assert.equal(three.total,204.24);assert.equal(three.shippingPrice,0);assert.equal(three.paymentPrice,1.2);assert.equal(three.cart[0].price,75.2);assert.equal(three.cart[0].name,set.name);
  const duplicate=await post('/api/order-create',body,202,'same-order-retry');assert.equal(duplicate.orderNumber,created.orderNumber);assert.equal((await jobs()).length,1);
  await post('/api/order-create',{...body,cart:[{...cart[0],qty:4}]},409,'changed-cart-same-request');
  await post('/api/gopay-create',{...body,payment:'gopay'},409,'same-request-different-payment');assert.equal(payments.length,0);
  const four=await post('/api/gopay-create',payload('canon-four',[{id:52830,sku:set.sku,qty:4,price:0.01}],{payment:'gopay'}),200,'four-sets-gopay');
  assert.equal(payments.length,1);assert.equal(payments[0].amount,22560);assert.equal(payments[0].items.reduce((sum,item)=>sum+item.amount,0),22560);
  const fourSource=await source(four.orderNumber);assert.equal(fourSource.subtotal,225.6);assert.equal(fourSource.total,225.6);assert.equal(fourSource.shippingPrice,0);assert.equal(fourSource.paymentState,'CREATED');
  const retry=await post('/api/gopay-create',payload('canon-four',[{id:52830,sku:set.sku,qty:4,price:0.01}],{payment:'gopay'}),200,'same-gopay-retry');assert.equal(retry.paymentId,four.paymentId);assert.equal(payments.length,1);
  const access={Cookie:`tm_gopay_access=${four.accessToken}`};
  const stillCreated=await post('/api/gopay-retry',{paymentId:four.paymentId,access:four.accessToken},200,'reuse-unfinished-gateway');assert.equal(String(stillCreated.paymentId),String(four.paymentId));assert.equal(stillCreated.reused,true);assert.equal(payments.length,1);
  await post('/api/gopay-change-payment',{paymentId:four.paymentId,payment:'cod'},403,'payment-change-requires-access');
  gatewayStates.set(Number(four.paymentId),'CANCELED');
  const newAttempt=await post('/api/gopay-retry',{paymentId:four.paymentId,access:four.accessToken},200,'cancelled-gateway-retry');assert.equal(newAttempt.orderNumber,four.orderNumber);assert.equal(payments.length,2);assert.equal((await jobs()).length,2);
  const repeatedAttempt=await post('/api/gopay-retry',{paymentId:four.paymentId,access:four.accessToken},200,'cancelled-gateway-retry-idempotent');assert.equal(String(repeatedAttempt.paymentId),String(newAttempt.paymentId));assert.equal(payments.length,2);
  gatewayStates.set(Number(newAttempt.paymentId),'CANCELED');
  const changed=await post('/api/gopay-change-payment',{paymentId:newAttempt.paymentId,payment:'cod'},200,'cancelled-gateway-change-to-cod',access);assert.equal(changed.orderNumber,four.orderNumber);assert.equal((await jobs()).length,2);
  const converted=await source(four.orderNumber);assert.equal(converted.total,226.8);assert.equal(converted.paymentCode,'cod');assert.equal(converted.paymentState,'CONVERTED_TO_OFFLINE');
  const changedAgain=await post('/api/gopay-change-payment',{paymentId:newAttempt.paymentId,payment:'cod'},200,'same-payment-change-retry',access);assert.equal(changedAgain.orderNumber,four.orderNumber);assert.equal((await jobs()).length,2);
  await post('/api/gopay-retry',{paymentId:newAttempt.paymentId,access:four.accessToken},409,'offline-order-cannot-reopen-gateway');
  const paid=await post('/api/gopay-create',payload('paid-probe',[{id:52830,sku:set.sku,qty:1}],{payment:'gopay'}),200,'paid-state-fixture');gatewayStates.set(Number(paid.paymentId),'PAID');assert.equal(payments.length,3);
  await post('/api/gopay-retry',{paymentId:paid.paymentId,access:paid.accessToken},409,'paid-order-cannot-retry-gateway');
  await post('/api/gopay-change-payment',{paymentId:paid.paymentId,payment:'cod'},409,'paid-order-cannot-change-payment',{Cookie:`tm_gopay_access=${paid.accessToken}`});assert.equal(payments.length,3);
  const single=await post('/api/order-create',payload('small',[{id:37637,sku:hp.sku,qty:1}],{payment:'bank_prepaid',shipping:{method:'gls_courier'}}),202,'small-order-paid-shipping');
  const singleSource=await source(single.orderNumber);assert.equal(singleSource.subtotal,12.39);assert.equal(singleSource.shippingPrice,3.9);assert.equal(singleSource.total,16.29);
  livePrice='14.50';
  const live=await post('/api/order-create',payload('live-price',[{id:37637,sku:hp.sku,qty:1,price:0.01}],{payment:'bank_prepaid'}),202,'woo-price-overrides-old-cache-and-client');
  assert.equal((await source(live.orderNumber)).total,18.4);livePrice=null;
  removed=true;const jobsBefore=(await jobs()).length;
  await post('/api/order-create',payload('removed',[{id:37637,sku:hp.sku,qty:1}]),409,'product-unpublished-in-woo');assert.equal((await jobs()).length,jobsBefore);removed=false;
  paymentMode='failure';
  const failedBody=payload('failed-payment',[{id:52830,sku:set.sku,qty:4}],{payment:'gopay'});
  await post('/api/gopay-create',failedBody,502,'gateway-failure');assert.equal((await jobs()).length,jobsBefore);
  await post('/api/gopay-create',failedBody,502,'gateway-failure-retry');assert.equal(payments.length,4);
  assert.equal(wooWrites,0,'Test attempted an unexpected Woo write');
  otherOutbound=[...logs.matchAll(/PURCHASE_BLOCKED_OUTBOUND/g)].length;assert.equal(otherOutbound,0,'Unexpected external transport');
  const report={ok:true,checks,queuedLocalFixtures:(await jobs()).length,mockedGatewayCreates:payments.length,mockedWooReads:transports.filter(t=>t.path==='/wp-json/wc/v3/products').length,realWooOrders:0,realPayments:0,emailsSent:0,otherOutbound,
    verifiedTotals:{threeSetsCod:three.total,fourSetsGoPay:fourSource.total,cancelledGoPayConvertedToCod:converted.total,smallOrder:singleSource.total,changedLivePrice:18.4}};
  await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error) { console.error(logs.slice(-2500));throw error; }
finally {child.kill('SIGTERM');await exited;mock.closeAllConnections();await new Promise(r=>mock.close(r));await rm(temp,{recursive:true,force:true});}
