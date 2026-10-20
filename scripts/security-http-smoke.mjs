// Post-build verification of the actual production server. Uses isolated data,
// generated fixture credentials and loopback-only outbound HTTP.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = await mkdtemp(join(tmpdir(), 'tm-security-http-'));
const secret = () => randomBytes(32).toString('hex');
const syncSecret = secret();
const fixtures = Array.from({ length: 100 }, (_, index) => ({
  id: index + 1, name: 'HP CF226A bezpečnostná skúška ' + index,
  slug: 'hp-security-' + (index + 1), sku: 'SECURITY-' + (index + 1),
  price: '17.88', regular_price: '17.88', status: 'publish',
  stock_status: 'instock', stock_quantity: 20, attributes: [], categories: [],
  images: [{ src: '/images/logo.png', alt: 'Testovací produkt' }],
}));
let wooCalls = 0;
const woo = http.createServer((req, res) => {
  wooCalls++;
  const path = new URL(req.url || '/', 'http://fixture.invalid').pathname;
  if (path !== '/wp-json/wc/v3/products') {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unexpected fixture request' }));
  }
  res.writeHead(200, { 'content-type': 'application/json', 'x-wp-total': '100', 'x-wp-totalpages': '1' });
  res.end(JSON.stringify(fixtures));
});
let child;
let output = '';
let assertions = 0;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function headersOk(response) {
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(response.headers.get('content-security-policy') || '', /object-src 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assertions += 4;
}
try {
  await new Promise(resolve => woo.listen(0, '127.0.0.1', resolve));
  const wooPort = woo.address().port;
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const preload = join(temporary, 'offline.mjs');
  await writeFile(preload, [
    "import os from 'node:os';",
    "os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});",
    "const original=globalThis.fetch;",
    "globalThis.fetch=async(input,...args)=>{const u=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);if(u.origin!==" + JSON.stringify('http://127.0.0.1:' + wooPort) + ")throw new Error('Security smoke prohibits external HTTP');return original(input,...args);};",
  ].join('\n'));
  const cache = join(temporary, 'cache');
  await mkdir(cache, { recursive: true });
  child = spawn(process.execPath, ['--import', preload, './dist/server/entry.mjs'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production',
      AUTH_SECRET: secret(), TM_PERSISTENCE_SECRET: secret(), ADMIN_API_SECRET: secret(),
      TM_ANALYTICS_ADMIN_KEY: secret(), SYNC_SECRET: syncSecret,
      TM_PERSISTENT_DATA_DIR: temporary, TM_CACHE_DIR: cache,
      TM_TRUSTED_PROXY_CIDRS: '127.0.0.0/8,::1/128',
      TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', TM_TONER_CARE_ENABLED: '0',
      TM_PRICE_HISTORY_ENABLED: '0', OPENAI_ASSISTANT_ENABLED: '0', ABIX_FIRMWARE_ENABLED: '0',
      WOO_URL: 'http://127.0.0.1:' + wooPort, WOO_CONSUMER_KEY: 'ck_fixture', WOO_CONSUMER_SECRET: 'cs_fixture',
      GOPAY_GOID: '123456', GOPAY_RETURN_URL: base + '/platba-dokoncena', GOPAY_NOTIFY_URL: base + '/api/gopay-notify',
      GOPAY_CLIENT_ID: 'fixture', GOPAY_CLIENT_SECRET: 'fixture',
      WOO_SYNC_MIN_PRODUCTS: '1', WOO_SYNC_EXPECTED_MIN_PRODUCTS: '1', WOO_SYNC_PAGE_DELAY_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { output = (output + data).slice(-12000); });
  child.stderr.on('data', data => { output = (output + data).slice(-12000); });
  const exit = new Promise(resolve => child.once('exit', resolve));
  child.on('error', error => { output += String(error); });
  async function call(path, { method = 'GET', headers = {}, body, ip = '198.51.100.250' } = {}) {
    const response = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'x-forwarded-for': ip, ...headers },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    return { response, text };
  }
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Production fixture server exited before readiness');
    try { const { response } = await call('/api/health'); if (response.status === 200) { ready = true; break; } } catch { /* startup */ }
    await delay(100);
  }
  assert.equal(ready, true, 'fixture server starts');
  assertions++;
  for (let round = 1; round <= 10; round++) {
    const ip = '198.51.100.' + round;
    let result = await call('/api/sync-products?force=1', { ip });
    assert.equal(result.response.status, 401, 'missing sync credential is denied, including loopback');
    headersOk(result.response);
    result = await call('/api/sync-products?token=fixture-secret', { ip });
    assert.equal(result.response.status, 400, 'URL token is denied');
    result = await call('/api/sync-products', { ip, headers: { host: 'localhost:' + port, 'x-sync-token': 'wrong' } });
    assert.equal(result.response.status, 401, 'forged localhost Host cannot bypass authentication');
    result = await call('/api/auth/login', { ip, method: 'POST', headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' }, body: {} });
    assert.equal(result.response.status, 403, 'foreign browser origin is denied');
    headersOk(result.response);
    for (const path of ['/api/cache-status', '/api/cache-status/', '/design/product-detail']) {
      result = await call(path, { ip, headers: { host: 'localhost:' + port } });
      assert.equal(result.response.status, 404, 'production test endpoint stays disabled: ' + path);
      headersOk(result.response);
    }
    const beforeLogin = wooCalls;
    for (let attempt = 1; attempt <= 31; attempt++) {
      const path = attempt === 31 ? (round % 2 ? '/api/auth/login/' : '/api/auth/%6cogin') : '/api/auth/login';
      result = await call(path, {
        ip, method: 'POST', body: {},
        headers: {
          origin: 'https://www.tonerymaxim.sk', 'content-type': 'application/json',
          'x-forwarded-for': '192.0.2.' + attempt + ', ' + ip,
          'cf-connecting-ip': '203.0.113.' + attempt, 'x-real-ip': '192.0.2.' + (attempt + 1),
        },
      });
      assert.equal(result.response.status, attempt <= 30 ? 400 : 429, 'IP spoofing must not reset the login rate limit');
      if (attempt === 31) {
        assert.ok(Number(result.response.headers.get('retry-after')) > 0);
        headersOk(result.response);
      }
    }
    assert.equal(wooCalls, beforeLogin, 'invalid login attempts never access WooCommerce');
    result = await call('/api/auth/login', { ip: '198.51.100.' + (100 + round), method: 'POST', body: {}, headers: { origin: 'https://www.tonerymaxim.sk', 'content-type': 'application/json' } });
    assert.equal(result.response.status, 400, 'another legitimate client remains usable');
    result = await call('/api/sync-products', { ip, method: 'POST', body: {}, headers: { 'x-sync-token': syncSecret, 'content-type': 'application/json' } });
    assert.equal(result.response.status, 200, 'scheduled header-authenticated POST still works without Origin');
    const synced = JSON.parse(result.text);
    assert.equal(synced.ok, true);
    assert.equal(synced.total, 100);
    assertions += 44;
    console.log('Production HTTP security round ' + round + '/10 passed');
  }
  let result = await call('/api/sync-products', { ip: '198.51.100.240', headers: { authorization: 'Bearer ' + syncSecret } });
  assert.equal(result.response.status, 200, 'existing header-authenticated GET remains supported');
  const beforePurchase = wooCalls;
  for (const path of ['/api/order-create', '/api/gopay-create']) {
    result = await call(path, { method: 'POST', body: {}, headers: { origin: 'https://www.tonerymaxim.sk', 'content-type': 'application/json' } });
    assert.equal(result.response.status, 400, 'empty purchase is rejected safely: ' + path + ': ' + result.text.slice(0,500));
    headersOk(result.response);
  }
  assert.equal(wooCalls, beforePurchase, 'empty checkout cannot create an external order or payment');
  result = await call('/api/ai-order-status');
  assert.equal(result.response.status, 401, 'private order data requires a session');
  for (const path of ['/', '/prihlasenie', '/kosik', '/pokladna', '/produkty', '/produkt/hp-security-1']) {
    result = await call(path);
    assert.ok([200, 302, 303, 307, 308].includes(result.response.status), path + ' stays usable: ' + result.response.status);
    if (result.response.status !== 200) assert.match(result.response.headers.get('location') || '', /^\/(kosik|prihlasenie|pokladna)/);
  }
  result = await call('/api/auth/login', {
    ip: '198.51.100.239', method: 'POST', body: 'x'.repeat(1_000_001),
    headers: { origin: 'https://www.tonerymaxim.sk', 'content-type': 'application/json' },
  });
  assert.equal(result.response.status, 413, 'oversized declared request body is rejected');
  headersOk(result.response);
  const streamedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"padding":"'));
      for (let index = 0; index < 17; index++) controller.enqueue(new Uint8Array(65536).fill(97));
      controller.enqueue(new TextEncoder().encode('"}'));
      controller.close();
    },
  });
  const streamed = await fetch(base + '/api/auth/login', {
    method: 'POST', body: streamedBody, duplex: 'half',
    headers: { origin: 'https://www.tonerymaxim.sk', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.238' },
    signal: AbortSignal.timeout(20000),
  });
  await streamed.text();
  assert.ok([400, 413].includes(streamed.status), 'oversized chunked body is rejected without Content-Length');
  result = await call('/api/health');
  assert.equal(result.response.status, 200, 'healthcheck remains available after adversarial traffic');
  assert.ok(wooCalls >= 1 && wooCalls <= 3, 'only the intentional fixture catalogue refresh reaches WooCommerce');
  assertions += 13;
  console.log('Production HTTP security smoke passed (' + assertions + '+ checks, 10 rounds, no real credentials, orders, payments or emails).');
  child.kill('SIGTERM');
  await Promise.race([exit, delay(3000)]);
} catch (error) {
  console.error('Production HTTP security smoke failed:', error?.stack || error);
  if (output) console.error('Fixture server log:', output.slice(-5000));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill('SIGKILL');
  woo.closeAllConnections();
  await new Promise(resolve => woo.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
