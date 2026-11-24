// Runs the real built Astro pages against disposable fixtures. No production credentials or traffic.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'tm-account-render-'));
const secret = randomBytes(32).toString('hex');
const payload = Buffer.from(JSON.stringify({ id: 7, email: 'test@example.invalid', first_name: 'Test', last_name: 'Zákazník', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const token = payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
const cookie = 'tm_customer_session=' + token;
const port = Number(process.env.PORT || 4398);
const product = { id: 11, sku: 'SKU-11', name: 'Brother TN-2421 čierny kompatibilný toner', slug: 'brother-tn-2421-cierny-kompatibilny-toner', price: 13.05,
  product_type_key: 'compatible', product_type_label: 'Kompatibilný', product_brand: 'Brother', image: '/images/tm-product-placeholder-box.jpg', stock_status: 'instock', stock_quantity: 20, page_yield: '3 000 strán', color: 'Čierna' };
product.compatible_printers = ['Brother DCP-L2512D', 'Brother HL-L2352DW'];
function variant(id, type, price, code = 'TN-2421', pages = 3000) {
  const label = { original: 'originálny', renovated: 'renovovaný', compatible: 'kompatibilný' }[type];
  return { ...product, id, sku: 'SKU-' + id, name: `Brother ${code} čierny ${label} toner`, slug: 'fixture-toner-' + id,
    product_type_key: type, product_type_label: label, page_yield: pages + ' strán', price };
}
const products = [product, variant(12, 'original', 104.66), variant(13, 'renovated', 41.27),
  variant(14, 'renovated', 58.71, 'TN-2411', 1200),
  variant(21, 'compatible', 10, 'TN-1030'), { ...variant(22, 'original', 27, 'TN-1030'), compatible_printers: ['Brother DCP-L2512D'] },
  variant(31, 'compatible', 10, 'TN-3430'), variant(32, 'original', 32, 'TN-3430'), variant(33, 'renovated', 23, 'TN-3430'),
  { ...variant(41, 'original', 42, 'TN-2010'),
    description_html: '<h2>TN-2010</h2><p>Originálny toner pre testovanú tlačiareň.</p><h3>Obsah balenia</h3><ul><li>Jedna kazeta</li></ul><h3>Pokyny</h3><p>Posledný odsek pôvodného popisu.</p>' },
  { ...variant(51, 'compatible', 10.17, 'CE285A', 2000), product_brand: 'HP', name: 'HP CE285A čierny kompatibilný toner', compatible_printers: ['HP LaserJet P1102'] },
  ...['CMY azúrový', 'CMY purpurový', 'CMY žltý', 'BK čierny'].map((tone, i) => ({ ...variant(61+i, 'compatible', 35),
    name: `Brother DR-241CL ${tone} kompatibilný optický valec`, oem_codes: 'DR-241CL '+tone.split(' ')[0], compatible_printers: ['Brother DCP-9020CDW'] })),
  ...['kompatibilný','originálny'].map((type, i) => ({ ...variant(71+i, i ? 'original':'compatible', 28),
    name: `Brother TN-245Y žltý ${type} toner`, oem_codes:'TN-245Y', compatible_printers: ['Brother DCP-9020CDW'] })),
  ...[
    ['HP', 'CF283X', 'HP LaserJet Pro M201dw'], ['Canon', 'CRG-737', 'Canon i-SENSYS MF211'],
    ['Brother', 'TN-243BK', 'Brother DCP-L3510CDW'], ['OKI', '44469803', 'OKI C530dn'],
    ['Lexmark', 'C5240KH', 'Lexmark C530DN'],
  ].map(([brand, oem, printer], i) => ({ ...variant(901+i, 'compatible', 19),
    name: brand + ' ' + oem + ' čierny kompatibilný toner', product_brand: brand,
    oem_codes: oem, compatible_printers: [printer] })),
  { id: 91, sku: 'PAPER', slug: 'kancelarsky-papier-a4-80g-500-harkov', name: 'Kancelársky papier A4', price: 6,
    product_type_key: 'product', stock_status: 'instock', stock_quantity: 30, compatible_printers: [] }];
const orders = Array.from({ length: 61 }, (_, index) => ({ id: 701 - index, number: String(701 - index), customer_id: 7, status: index === 1 ? 'cancelled' : 'completed',
  meta_data: index === 1 ? [] : [{ key: 'tm_order_number', value: String(312345 + index) }],
  date_created: new Date(Date.UTC(2026, 10, 17 - index)).toISOString(), currency: 'EUR', total: '180.00', total_tax: '30.00', refunds: index === 0 ? [{ id: 900, total: '-12.00' }] : [],
  line_items: [{ id: 1, product_id: 11, sku: 'SKU-11', name: product.name, quantity: 4, total: '100.00', total_tax: '20.00' },
    { id: 2, product_id: 99, sku: 'DELETED', name: 'Vyradený toner', quantity: 1, total: '50.00', total_tax: '10.00' }] }));
await writeFile(join(directory, 'products.json'), JSON.stringify({ ok: true, version: 4, total: products.length, generated_at: new Date().toISOString(), products }));
const shim = `
${process.argv.includes('--purchase') ? `import ${JSON.stringify(new URL('./purchase-prepublish-shim.mjs', import.meta.url).href)};` : ''}
import os from 'node:os';import {Server} from 'node:http';
os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const orders=${JSON.stringify(orders)}, product=${JSON.stringify(product)};
let invoiceTemporarilyUnavailable = true;
const emit=Server.prototype.emit;Server.prototype.emit=function(name,...args){if(name==='request'&&args[0].url==='/__account_fixture_session'){args[1].writeHead(302,{'Set-Cookie':${JSON.stringify(cookie + '; Path=/; HttpOnly; SameSite=Lax')},Location:'/ucet/objednavky'});args[1].end();return true}return emit.call(this,name,...args)};
globalThis.fetch=async(input,options={})=>{const url=new URL(String(input));if(url.hostname!=='woo.example.invalid'||(options.method||'GET')!=='GET')throw new Error('Fixture blocks external requests and Woo writes');
if(url.pathname.endsWith('/customers/7'))return Response.json({id:7,email:'test@example.invalid',first_name:'Test',last_name:'Zákazník',billing:{city:'Testovacie mesto'},meta_data:[
  {key:'tm_loyalty_credited_orders',value:orders.map(order=>String(order.id))}, {key:'tm_loyalty_lifetime_points',value:10},
  {key:'tm_loyalty_history',value:[{orderId:701,title:'Objednávka #701',points:10},{orderId:700,title:'Použitá zľava pri objednávke #700',points:-2}]}]});
if(url.pathname.endsWith('/invoices')){
  const orderId=Number(url.searchParams.get('order_id')), page=Number(url.searchParams.get('page'));
  if(orderId===699 && invoiceTemporarilyUnavailable){invoiceTemporarilyUnavailable=false;return Response.json({}, {status:503})}
  if(orderId!==701||url.searchParams.get('customer_id')!=='7')return Response.json({ok:true,documents:[],page,has_more:false});
  return Response.json({ok:true,page,has_more:page===1,documents:[
    {id:'b871932e-5bb4-4d77-a0f6-000000000001',customer_id:7,order_id:701,order_number:'701',number:page===1?'INV-100':'INV-101',date:'2026-11-16',type:'invoice',pdf:true,xml:false}]});
}
if(url.pathname.endsWith('/orders')){const page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('per_page')||20);if(page>Math.ceil(orders.length/size))return Response.json({}, {status:400});return Response.json(orders.slice((page-1)*size,page*size),{headers:{'X-WP-Total':String(orders.length),'X-WP-TotalPages':String(Math.ceil(orders.length/size))}})}
if(url.pathname.endsWith('/orders/701'))return Response.json(orders[0]);if(url.pathname.endsWith('/orders/999'))return Response.json({...orders[0],id:999,customer_id:8});
if(url.pathname.endsWith('/products'))return Response.json([{...product,status:'publish',price:'13.05'}]);return Response.json({}, {status:404})};
`;
const preload = join(directory, 'preload.mjs'); await writeFile(preload, shim);
const env = { PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), AUTH_SECRET: secret,
  WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
  TM_CACHE_DIR: directory, TM_TONER_CARE_ENABLED: '0', TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', OPENAI_ASSISTANT_ENABLED: '0' };
const child = spawn(process.execPath, ['--import', preload, './dist/server/entry.mjs'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
function request(path, signedIn = true, body) { return new Promise((resolve, reject) => {
  const form = body instanceof URLSearchParams;
  const data = form ? body.toString() : body ? JSON.stringify(body) : '';
  const req = http.request({ hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers: { ...(signedIn ? { Cookie: cookie } : {}),
    ...(body ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: 'http://127.0.0.1:' + port } : {}) }, timeout: 10_000 }, res => {
    let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers })); });
  req.on('timeout', () => req.destroy(new Error('Fixture request timed out'))); req.on('error', reject); if (data) req.write(data); req.end();
}); }
try {
  for (let i = 0; i < 100 && !logs.includes('Server listening'); i++) { if (child.exitCode != null) throw new Error(logs); await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.match(logs, /Server listening/);
  const home = await request('/ucet'); assert.equal(home.status, 200); assert.match(home.text, /10\s*788|10&nbsp;788|10&#160;788/); assert.match(home.text, />61</);
  const history = await request('/ucet/objednavky'); assert.equal(history.status, 200); assert.match(history.text, /Objednať znova/); assert.match(history.text, /Stránka 1 z 4/);
  for (const page of [home, history]) {
    assert.match(page.text, />#312345</);
    assert.doesNotMatch(page.text, />#(?:701|700)</);
  }
  assert.doesNotMatch(history.text, /href="[^"]*faktury\?order=/);
  const invoiceLinks = [...history.text.matchAll(/href="(\/ucet\/faktury\?ref=[A-Za-z0-9_.-]+)"/g)].map(match => match[1]);
  assert.equal(invoiceLinks.length, 20);
  const invoices = await request(invoiceLinks[0]);
  assert.equal(invoices.status, 200); assert.match(invoices.text, /INV-100/); assert.match(invoices.text, />312345</);
  assert.doesNotMatch(invoices.text, />701</);
  const follow = (html, label) => {
    const href = html.match(new RegExp('<a [^>]*href="([^"]+)"[^>]*>' + label + '</a>'))?.[1];
    assert.ok(href, 'Missing link: ' + label);
    return href.replaceAll('&amp;', '&');
  };
  const next = follow(invoices.text, 'Ďalšia strana');
  const firstRef = new URL(invoiceLinks[0], 'http://fixture.local').searchParams.get('ref');
  const nextParams = new URL(next, 'http://fixture.local').searchParams;
  assert.equal(nextParams.get('ref'), firstRef); assert.equal(nextParams.get('page'), '2');
  const second = await request(next);
  assert.equal(second.status, 200); assert.match(second.text, /INV-101/); assert.doesNotMatch(second.text, /INV-100/);
  assert.match((await request(follow(second.text, 'Predchádzajúca strana'))).text, /INV-100/);
  const noTm = await request(invoiceLinks[1]);
  assert.equal(noTm.status, 200); assert.match(noTm.text, /Zatiaľ tu nie sú žiadne faktúry/);
  const failed = await request(invoiceLinks[2]); assert.equal(failed.status, 503);
  const retry = follow(failed.text, 'Skúsiť znova');
  assert.equal(new URL(retry, 'http://fixture.local').searchParams.get('ref'), new URL(invoiceLinks[2], 'http://fixture.local').searchParams.get('ref'));
  const recovered = await request(retry); assert.equal(recovered.status, 200); assert.match(recovered.text, /Zatiaľ tu nie sú žiadne faktúry/);
  assert.equal((await request(invoiceLinks[0], false)).status, 302);
  const invalidRef = await request('/ucet/faktury?ref=&order=701');
  assert.equal(invalidRef.status, 400); assert.doesNotMatch(invalidRef.text, /INV-100/);
  for (const previous of [await request('/ucet/faktury?order=701'), await request('/ucet/faktury', true, new URLSearchParams({ order: '701' }))]) {
    assert.equal(previous.status, 200); assert.match(previous.text, /INV-100/);
  }
  const loyalty = await request('/ucet/vernost');
  assert.equal(loyalty.status, 200); assert.match(loyalty.text, /Objednávka #312345/);
  assert.doesNotMatch(loyalty.text, /#(?:701|700)\b/);
  assert.match(history.text, /30,00/); assert.doesNotMatch(history.text, /DPH 23 %/);
  const oldest = await request('/ucet/objednavky?page=4'); assert.equal(oldest.status, 200); assert.match(oldest.text, /Stránka 4 z 4/);
  const missing = await request('/ucet/objednavky?page=5'); assert.equal(missing.status, 404); assert.match(missing.text, /neexistuje/);
  const guest = await request('/ucet/objednavky', false); assert.equal(guest.status, 302); assert.match(guest.headers.location, /prihlasenie/);
  const plan = await request('/api/account/reorder', true, { orderId: 701 }); assert.equal(plan.status, 200);
  const data = JSON.parse(plan.text); assert.equal(data.plan.items[0].price, 13.05); assert.equal(data.plan.items[0].qty, 4); assert.equal(data.plan.skipped.length, 1);
  assert.equal((await request('/api/account/reorder', false, { orderId: 701 })).status, 401);
  assert.equal((await request('/api/account/reorder', true, { orderId: 999 })).status, 404);
  for (const path of ['/', '/kosik', '/pokladna', '/api/health']) assert.equal((await request(path, false)).status, 200);
  console.log(JSON.stringify({ ok: true, orders: 61, pages: 4, taxFromOrder: true, authenticatedPreview: true, guestRejected: true, foreignOrderRejected: true, publicRoutes: 4 }));
  if (process.argv.includes('--responsive')) {
    const { verifyResponsivePurchase } = await import('./verify-responsive-purchase.mjs');
    await verifyResponsivePurchase('http://127.0.0.1:' + port);
  }
  if (process.argv.includes('--serve')) { console.log('Fixture browser preview: http://127.0.0.1:' + port + '/__account_fixture_session'); await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); }); }
} finally { child.kill('SIGTERM'); await rm(directory, { recursive: true, force: true }); }
