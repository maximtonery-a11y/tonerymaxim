// Built Astro/API integration with disposable customer fixtures. External HTTP and SMTP are disabled.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'tm-guard-render-'));
const secret = randomBytes(32).toString('hex');
const payload = Buffer.from(JSON.stringify({ id: 7, email: 'test@example.invalid', first_name: 'Test', last_name: 'Zákazník', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const cookie = 'tm_customer_session=' + payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
const port = Number(process.env.PORT || 4397);
const printer = (title, enabled = true) => ({ title, brand: title.split(' ')[0], url: '/produkty', product_count: 34,
  added_at: '2026-10-01T09:00:00Z', custom_label: 'Kancelária', care_enabled: enabled, installed_at: '2026-09-20', expected_months: 3,
  expected_replacement_at: '2026-12-20', reminder_days: 30, preferred_type: 'compatible',
  customer_reminder_sent_for: '', admin_reminder_sent_for: '', last_reminder_at: '', care_cycle_id: title, care_ended_at: '', care_reminders: [], care_history: [] });
const customer = { id: 7, email: 'test@example.invalid', first_name: 'Test', last_name: 'Zákazník',
  billing: { first_name: 'Test', last_name: 'Zákazník', address_1: 'Testovacia 12', city: 'Testovacie mesto', postcode: '12345', country: 'SK', phone: '0900000000' },
  shipping: { address_1: 'Testovacia 34', city: 'Iné mesto', postcode: '54321', country: 'SK' },
  meta_data: [
    { key: 'tm_saved_printers', value: JSON.stringify([printer('Brother DCP-L3517CDW'), printer('HP LaserJet M110w', false)]) },
    { key: 'tm_saved_products', value: JSON.stringify([{ id: 11, sku: 'TEST-11', title: 'Uložený toner' }]) },
    { key: 'tm_saved_shipping_addresses', value: JSON.stringify([{ id: 'office', address_1: 'Testovacia 34' }]) },
    { key: 'tm_loyalty_points', value: 250 }, { key: 'tm_loyalty_lifetime_points', value: 250 },
    { key: 'tm_customer_preference_fixture', value: 'zachovať' },
  ],
};
await writeFile(join(directory, 'products.json'), JSON.stringify({ ok: true, version: 4, total: 0, generated_at: new Date().toISOString(), products: [] }));
const preload = join(directory, 'preload.mjs');
await writeFile(preload, `
import os from 'node:os';import {Server} from 'node:http';
os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
const original=${JSON.stringify(customer)};let customer=structuredClone(original);const writes=[];
const emit=Server.prototype.emit;Server.prototype.emit=function(name,...args){if(name==='request'){
  if(args[0].url.startsWith('/__guard_fixture_mobile')){const width=Number(new URL(args[0].url,'http://fixture.local').searchParams.get('width')||375);const safe=[320,375,768].includes(width)?width:375;args[1].writeHead(200,{'Content-Type':'text/html; charset=utf-8'});args[1].end('<!doctype html><html lang="sk"><meta charset="utf-8"><title>Test mobilného účtu</title><style>body{font:16px Arial;background:#eef2f7;padding:15px}nav{margin:0 0 14px;display:flex;gap:14px}iframe{display:block;width:'+safe+'px;height:812px;border:1px solid #ccd6e3;border-radius:12px;background:#fff}</style><nav><a href="/__guard_fixture_mobile?width=320">320 px</a><a href="/__guard_fixture_mobile?width=375">375 px</a><a href="/__guard_fixture_mobile?width=768">768 px</a><a href="/__guard_fixture_session">Desktop</a></nav><iframe title="Mobilný zákaznícky účet" src="/__guard_fixture_session"></iframe></html>');return true}
  if(args[0].url==='/__guard_fixture_session'||args[0].url==='/'){args[1].writeHead(302,{'Set-Cookie':${JSON.stringify(cookie + '; Path=/; HttpOnly; SameSite=Lax')},Location:'/ucet/tlaciarne'});args[1].end();return true}
  if(args[0].url==='/__guard_fixture_customer'){args[1].writeHead(200,{'Content-Type':'application/json'});args[1].end(JSON.stringify({customer,writes}));return true}
  if(args[0].url==='/__guard_fixture_reset'){customer=structuredClone(original);writes.length=0;args[1].writeHead(200);args[1].end('ok');return true}
}return emit.call(this,name,...args)};
globalThis.fetch=async(input,options={})=>{const url=new URL(String(input));if(url.hostname!=='woo.example.invalid')throw new Error('Fixture blocks external HTTP');
if(url.pathname.endsWith('/customers/7')){if((options.method||'GET')==='GET')return Response.json(customer);
if(options.method==='PUT'){const update=JSON.parse(options.body);writes.push(update);for(const field of ['first_name','last_name','billing','shipping'])if(field in update)customer[field]=update[field];
for(const item of update.meta_data||[]){const old=customer.meta_data.find(entry=>entry.key===item.key);if(old)old.value=item.value;else customer.meta_data.push(item)}return Response.json(customer)}}
if(url.pathname.endsWith('/customers'))return Response.json([customer]);
if(url.pathname.endsWith('/orders')||url.pathname.endsWith('/products')||url.pathname.endsWith('/coupons'))return Response.json([],{headers:{'X-WP-Total':'0','X-WP-TotalPages':'0'}});
if(url.pathname.endsWith('/invoices'))return Response.json({ok:true,documents:[],page:1,has_more:false});
return Response.json([])};
`);
const env = { PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), AUTH_SECRET: secret,
  WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
  TM_CACHE_DIR: directory, TM_PERSISTENT_DATA_DIR: directory, TM_TONER_CARE_ENABLED: '0',
  TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', OPENAI_ASSISTANT_ENABLED: '0' };
const child = spawn(process.execPath, ['--import', preload, './dist/server/entry.mjs'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => { logs += data; if (process.argv.includes('--serve')) process.stdout.write(data); }); child.stderr.on('data', data => logs += data);
function request(path, body, method = 'GET') {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { Cookie: cookie, Origin: 'http://127.0.0.1:' + port,
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
try {
  for (let i = 0; i < 100 && !logs.includes('Server listening'); i++) { if (child.exitCode != null) throw new Error(logs); await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.match(logs, /Server listening/);
  const page = await request('/ucet/tlaciarne'); assert.equal(page.status, 200);
  assert.match(page.text, /Vypnúť strážcu/); assert.match(page.text, /account-mobile-drawer/); assert.match(page.text, /Rýchle menu účtu/);
  assert.match(page.text, /Prvý e-mail mesiac vopred/);
  const paths = ['/ucet', '/ucet/objednavky', '/ucet/faktury', '/ucet/tlaciarne', '/ucet/produkty', '/ucet/reklamacie', '/ucet/vernost', '/ucet/odmeny', '/ucet/adresy', '/ucet/newsletter', '/ucet/profil'];
  for (const path of paths) assert.ok(page.text.includes(`href="${path}"`), 'Existing account route missing: ' + path);
  const before = JSON.parse((await request('/__guard_fixture_customer')).text).customer;
  assert.equal(JSON.parse((await request('/__guard_fixture_customer')).text).writes.length, 0);
  const disabled = await request('/api/account/saved-printers', { title: 'Brother DCP-L3517CDW', action: 'disable' }, 'PUT');
  assert.equal(disabled.status, 200);
  const after = JSON.parse((await request('/__guard_fixture_customer')).text).customer;
  for (const field of ['billing', 'shipping', 'email', 'first_name', 'last_name']) assert.deepEqual(after[field], before[field], field);
  for (const item of before.meta_data.filter(item => item.key !== 'tm_saved_printers')) assert.deepEqual(after.meta_data.find(entry => entry.key === item.key), item, item.key);
  const saved = JSON.parse(after.meta_data.find(item => item.key === 'tm_saved_printers').value);
  assert.equal(saved.length, 2); assert.equal(saved[0].care_enabled, false); assert.equal(saved[0].care_history.length, 1);
  assert.equal(saved[0].custom_label, 'Kancelária');
  assert.deepEqual(saved[1], JSON.parse(before.meta_data.find(item => item.key === 'tm_saved_printers').value)[1]);
  const refreshed = await request('/ucet/tlaciarne'); assert.match(refreshed.text, /Brother DCP-L3517CDW/); assert.match(refreshed.text, /Vypnutý ručne/);
  const guide = await request('/toner-bez-starosti'); assert.equal(guide.status, 200); assert.match(guide.text, /každých 7 dní/);
  console.log(JSON.stringify({ ok: true, existingRoutes: paths.length, unrelatedCustomerSettingsPreserved: true, otherPrinterUnchanged: true, disableSurvivesReload: true, historyRetained: true }));
  if (process.argv.includes('--serve')) {
    await request('/__guard_fixture_reset');
    console.log('Guard fixture ready at http://127.0.0.1:' + port + '/');
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} catch (error) { console.error(logs); throw error; }
finally { child.kill('SIGTERM'); await rm(directory, { recursive: true, force: true }); }
