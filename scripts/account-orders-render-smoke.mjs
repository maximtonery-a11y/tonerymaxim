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
const port = 4398;
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
  variant(41, 'original', 42, 'TN-2010')];
const orders = Array.from({ length: 61 }, (_, index) => ({ id: 701 - index, number: String(300000 + index), customer_id: 7, status: index === 1 ? 'cancelled' : 'completed',
  date_created: new Date(Date.UTC(2026, 10, 17 - index)).toISOString(), currency: 'EUR', total: '180.00', total_tax: '30.00', refunds: index === 0 ? [{ id: 900, total: '-12.00' }] : [],
  line_items: [{ id: 1, product_id: 11, sku: 'SKU-11', name: product.name, quantity: 4, total: '100.00', total_tax: '20.00' },
    { id: 2, product_id: 99, sku: 'DELETED', name: 'Vyradený toner', quantity: 1, total: '50.00', total_tax: '10.00' }] }));
await writeFile(join(directory, 'products.json'), JSON.stringify({ ok: true, version: 4, total: products.length, generated_at: new Date().toISOString(), products }));
const shim = `
import os from 'node:os';import {Server} from 'node:http';
os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const orders=${JSON.stringify(orders)}, product=${JSON.stringify(product)};
const emit=Server.prototype.emit;Server.prototype.emit=function(name,...args){if(name==='request'&&args[0].url==='/__account_fixture_session'){args[1].writeHead(302,{'Set-Cookie':${JSON.stringify(cookie + '; Path=/; HttpOnly; SameSite=Lax')},Location:'/ucet/objednavky'});args[1].end();return true}return emit.call(this,name,...args)};
globalThis.fetch=async(input,options={})=>{const url=new URL(String(input));if(url.hostname!=='woo.example.invalid'||(options.method||'GET')!=='GET')throw new Error('Fixture blocks external requests and Woo writes');
if(url.pathname.endsWith('/customers/7'))return Response.json({id:7,email:'test@example.invalid',first_name:'Test',last_name:'Zákazník',billing:{city:'Testovacie mesto'},meta_data:[]});
if(url.pathname.endsWith('/orders')){const page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('per_page')||20);if(page>Math.ceil(orders.length/size))return Response.json({}, {status:400});return Response.json(orders.slice((page-1)*size,page*size),{headers:{'X-WP-Total':String(orders.length),'X-WP-TotalPages':String(Math.ceil(orders.length/size))}})}
if(url.pathname.endsWith('/orders/701'))return Response.json(orders[0]);if(url.pathname.endsWith('/orders/999'))return Response.json({...orders[0],id:999,customer_id:8});
if(url.pathname.endsWith('/products'))return Response.json([{...product,status:'publish',price:'13.05'}]);return Response.json({}, {status:404})};
`;
const preload = join(directory, 'preload.mjs'); await writeFile(preload, shim);
const env = { PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), AUTH_SECRET: secret,
  WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
  TM_CACHE_DIR: directory, TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', OPENAI_ASSISTANT_ENABLED: '0' };
const child = spawn(process.execPath, ['--import', preload, './dist/server/entry.mjs'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
function request(path, signedIn = true, body) { return new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : '';
  const req = http.request({ hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers: { ...(signedIn ? { Cookie: cookie } : {}),
    ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: 'http://127.0.0.1:' + port } : {}) }, timeout: 10_000 }, res => {
    let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers })); });
  req.on('timeout', () => req.destroy(new Error('Fixture request timed out'))); req.on('error', reject); if (data) req.write(data); req.end();
}); }
try {
  for (let i = 0; i < 100 && !logs.includes('Server listening'); i++) { if (child.exitCode != null) throw new Error(logs); await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.match(logs, /Server listening/);
  const home = await request('/ucet'); assert.equal(home.status, 200); assert.match(home.text, /10\s*788|10&nbsp;788|10&#160;788/); assert.match(home.text, />61</);
  const history = await request('/ucet/objednavky'); assert.equal(history.status, 200); assert.match(history.text, /Objednať znova/); assert.match(history.text, /Stránka 1 z 4/);
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
