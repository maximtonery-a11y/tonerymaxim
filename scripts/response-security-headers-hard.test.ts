import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const project = fileURLToPath(new URL('../', import.meta.url));
const cache = join(project, '.tm-cache');
await mkdir(cache, { recursive: true });
const temporary = await mkdtemp(join(cache, 'headers-hard-'));
process.env.TM_PERSISTENT_DATA_DIR = join(temporary, 'data');
process.env.TM_PERSISTENCE_SECRET = 'headers-hard-test-local-persistence-secret-2026';
process.env.AUTH_SECRET = 'headers-hard-test-local-auth-secret-with-32-characters';
after(() => rm(temporary, { recursive: true, force: true }));
(globalThis as any).__tmBackgroundWorkersScheduled = true;

// Compare the complete middleware with the previous implementation. Keeping
// the baseline in this test makes it runnable from a shallow CI checkout.
const currentSource = await readFile(join(project, 'src/middleware.ts'), 'utf8');
const baselineSource = currentSource
  .replace("import { applyResponseSecurityHeaders } from './lib/response-security-headers';\n", '')
  .replace('  applyResponseSecurityHeaders(headers, url);\n', '');
assert.notEqual(currentSource, baselineSource, 'The baseline must omit exactly the header addition.');
const modules: Record<string, any> = {};
for (const [label, contents] of Object.entries({ current: currentSource, baseline: baselineSource })) {
  const outfile = join(temporary, `${label}.mjs`);
  await build({
    stdin: { contents, resolveDir: join(project, 'src'), loader: 'ts' }, outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external',
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'middleware-fixture', setup(builder) {
      builder.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'middleware', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const defineMiddleware = handler => handler;', loader: 'js' }));
    } }],
  });
  modules[label] = await import(pathToFileURL(outfile).href);
}

const csp = "base-uri 'self'; object-src 'none'; frame-ancestors 'self'";
const hosts = ['https://www.tonerymaxim.sk', 'http://www.tonerymaxim.sk', 'https://tonerymaxim.sk', 'https://www.tonerymaxim.info', 'http://localhost:4321', 'https://www.tonerymaxim.sk.attacker.test', 'https://other.tonerymaxim.sk'];
const paths = ['/pokladna', '/kosik', '/platba-dokoncena', '/ucet/objednavky', '/api/gopay-create', '/api/gopay-notify', '/api/gopay-status', '/api/gopay-retry', '/api/gopay-change-payment', '/api/account/invoice/123', '/api/health', '/produkt/test'];
let sequence = 0;

async function invoke(label: string, address: string, factory: () => Response, method = 'GET', extra: Record<string, string> = {}) {
  const url = new URL(address);
  const request = new Request(url, { method, headers: {
    origin: url.origin, 'x-forwarded-for': `192.0.${Math.floor(sequence / 250) % 250}.${sequence % 250 + 1}`, ...extra,
  } });
  let nextCalls = 0; let nextReturned = false;
  const response = await modules[label].onRequest({ request, url }, async () => { nextCalls++; const value = factory(); nextReturned = true; return value; });
  return { response: response as Response, nextCalls, nextReturned };
}

async function equivalent(address: string, factory: () => Response, method = 'GET', extra: Record<string, string> = {}) {
  sequence++;
  const a = await invoke('baseline', address, factory, method, extra);
  const b = await invoke('current', address, factory, method, extra);
  assert.equal(b.nextCalls, a.nextCalls, address);
  assert.equal(b.response.status, a.response.status, address);
  assert.equal(b.response.statusText, a.response.statusText, address);
  assert.equal(await b.response.text(), await a.response.text(), address);
  assert.deepEqual(b.response.headers.getSetCookie(), a.response.headers.getSetCookie(), address);
  const oldHeaders = new Headers(a.response.headers);
  const newHeaders = new Headers(b.response.headers);
  oldHeaders.delete('server-timing'); newHeaders.delete('server-timing');
  for (const [name, expected] of [['content-security-policy', csp], ['strict-transport-security', 'max-age=31536000']]) {
    if (!oldHeaders.has(name) && newHeaders.has(name)) {
      assert.equal(newHeaders.get(name), expected, address);
      newHeaders.delete(name);
    }
  }
  assert.deepEqual([...newHeaders], [...oldHeaders], address);
  if (b.nextReturned && /^text\/html(?:\s*;|\s*$)/i.test(b.response.headers.get('content-type') || '')) assert(b.response.headers.has('content-security-policy'));
  if (b.nextReturned && ['www.tonerymaxim.sk', 'tonerymaxim.sk'].includes(new URL(address).hostname)) assert(b.response.headers.has('strict-transport-security'));
}

test('2016 combinations preserve status, content, redirects, cookies, cache and endpoint policies', async () => {
  const statuses = [200, 201, 202, 204, 206, 301, 302, 303, 307, 308, 400, 401, 403, 404, 409, 413, 429, 500, 502, 503, 504, 304, 410, 422];
  const types = ['text/html; charset=utf-8', 'text/html', 'application/json', 'application/pdf', 'text/plain', 'application/octet-stream'];
  let count = 0;
  for (const host of hosts) for (const status of statuses) for (const type of types) for (const method of ['GET', 'POST']) {
    const path = paths[count % paths.length]; const custom = count % 5 === 0;
    await equivalent(host + path + '?unicode=%C5%BE&query=%3Ctest%3E', () => {
      const headers = new Headers({ 'content-type': type, 'cache-control': 'private, no-store', 'x-test-response': String(count), etag: '"fixture"' });
      headers.append('set-cookie', 'tm_customer_session=test; Secure; HttpOnly; SameSite=Lax; Path=/');
      headers.append('set-cookie', 'tm_gopay_access=test; Secure; HttpOnly; SameSite=Lax; Path=/');
      if (status >= 300 && status < 400) headers.set('location', 'https://gate.gopay.cz/mock-payment?id=123');
      if (custom) headers.set('content-security-policy', "sandbox; default-src 'none'");
      if (count % 11 === 0) headers.set('strict-transport-security', 'max-age=86400');
      return new Response([204, 304].includes(status) ? null : 'Žluťoučký test — 123 €', { status, headers });
    }, method);
    count++;
  }
  assert.equal(count, 2016);
});

test('origin rejection, notification exceptions, body limits, thrown handlers and rate limits match the baseline', async () => {
  let count = 0;
  for (const path of paths.filter(path => path.startsWith('/api/'))) {
    for (const origin of ['https://www.tonerymaxim.sk', 'https://attacker.test', 'null']) {
      await equivalent('https://www.tonerymaxim.sk' + path, () => Response.json({ ok: true }), 'POST', { origin }); count++;
    }
    await equivalent('https://www.tonerymaxim.sk' + path, () => Response.json({ ok: true }), 'POST', { 'content-length': '1000001' }); count++;
  }
  for (const path of ['/pokladna', '/api/gopay-create']) {
    await equivalent('https://www.tonerymaxim.sk' + path, () => { throw new Error('simulated upstream failure'); }, 'GET'); count++;
  }
  const address = 'https://www.tonerymaxim.sk/api/gopay-retry';
  sequence = 100000;
  for (let attempt = 0; attempt < 16; attempt++) {
    const a = await invoke('baseline', address, () => Response.json({ ok: true }), 'POST');
    const b = await invoke('current', address, () => Response.json({ ok: true }), 'POST');
    assert.equal(a.response.status, b.response.status);
    assert.equal(b.response.status, attempt < 10 ? 200 : 429);
    assert.equal(a.response.headers.get('retry-after'), b.response.headers.get('retry-after'));
  }
  console.log(`Compared ${count} failure/authorization cases and 16 rate-limit requests.`);
});

test('large streaming responses keep exact bytes, preserve backpressure and propagate interrupted streams', async () => {
  const chunks = Array.from({ length: 32 }, (_, i) => new Uint8Array(256 * 1024).fill(i));
  const expected = createHash('sha256'); for (const chunk of chunks) expected.update(chunk);
  const digest = expected.digest('hex');
  for (const label of ['baseline', 'current']) {
    let pulls = 0;
    const { response } = await invoke(label, 'https://www.tonerymaxim.sk/ucet/faktury', () => new Response(new ReadableStream({
      pull(controller) { if (pulls === chunks.length) controller.close(); else controller.enqueue(chunks[pulls++]); },
    }), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="fixture.pdf"' } }));
    assert(pulls <= 2, 'Middleware must not buffer an eight-megabyte download.');
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.byteLength, 8 * 1024 * 1024);
    assert.equal(createHash('sha256').update(body).digest('hex'), digest);
    const broken = await invoke(label, 'https://www.tonerymaxim.sk/pokladna', () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('interrupted-body')); } }), { headers: { 'content-type': 'text/html' } }));
    await assert.rejects(broken.response.text(), /interrupted-body/);
  }
});

test('10000 concurrent responses never mix hosts, policies, cookies or bodies', async () => {
  const started = performance.now(); const memoryBefore = process.memoryUsage().heapUsed;
  for (let offset = 0; offset < 10000; offset += 32) {
    await Promise.all(Array.from({ length: Math.min(32, 10000 - offset) }, async (_, position) => {
      const i = offset + position; const host = i % 2 ? hosts[0] : hosts[3];
      const { response } = await invoke('current', host + '/pokladna', () => new Response(`body-${i}`, { headers: { 'content-type': 'text/html', 'set-cookie': `fixture=${i}; HttpOnly; SameSite=Lax` } }));
      assert.equal(await response.text(), `body-${i}`);
      assert.equal(response.headers.get('set-cookie'), `fixture=${i}; HttpOnly; SameSite=Lax`);
      assert.equal(response.headers.get('content-security-policy'), csp);
      assert.equal(response.headers.has('strict-transport-security'), Boolean(i % 2));
    }));
  }
  console.log(JSON.stringify({ middlewareResponses: 10000, concurrency: 32, durationMs: Math.round(performance.now() - started), heapGrowthBytes: process.memoryUsage().heapUsed - memoryBefore }));
});

test('100 concurrent checkout submissions plus replays perform one payment side effect', async () => {
  const { withCheckoutSubmission } = await import('../src/lib/checkout-submission.ts');
  let effects = 0;
  const body = { requestId: 'headers-stress-payment', payment: 'gopay', cart: [{ sku: 'LOCAL-TEST', qty: 1 }], total: 23.9 };
  const work = async () => { effects++; await new Promise(resolve => setTimeout(resolve, 100)); return Response.json({ ok: true, paymentId: '123', orderNumber: 'TEST-123' }); };
  const submit = async (payload = body, endpoint: 'gopay' | 'order' = 'gopay') => {
    const url = new URL('https://www.tonerymaxim.sk/api/gopay-create');
    const request = new Request(url, { method: 'POST', headers: { origin: url.origin, 'x-forwarded-for': `198.51.100.${++sequence % 250 + 1}` } });
    return modules.current.onRequest({ request, url }, () => withCheckoutSubmission(body.requestId, endpoint, payload, work)) as Promise<Response>;
  };
  const results = await Promise.all(Array.from({ length: 100 }, () => submit()));
  assert.equal(effects, 1);
  for (const response of results) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, paymentId: '123', orderNumber: 'TEST-123' });
  }
  assert.equal((await submit({ ...body, total: 999 })).status, 409);
  assert.equal((await submit(body, 'order')).status, 409);
  assert.equal(effects, 1);
});

test('GoPay rejects mismatched payment identity, amount, currency, merchant and unpaid state', async () => {
  const outfile = join(temporary, 'gopay-client.mjs');
  await build({ entryPoints: ['src/lib/gopay-client.ts'], outfile, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { verifyGoPayPaymentAgainstOrder } = await import(pathToFileURL(outfile).href);
  Object.assign(process.env, { GOPAY_ENV: 'sandbox', GOPAY_CLIENT_ID: 'fixture', GOPAY_CLIENT_SECRET: 'fixture', GOPAY_GOID: '12345' });
  const originalFetch = globalThis.fetch;
  let oauthRequests = 0;
  let payment: any = { id: '123', state: 'PAID', order_number: 'TEST-123', amount: 2390, currency: 'EUR', target: { goid: 12345 } };
  globalThis.fetch = async input => {
    const url = new URL(String(input)); assert.equal(url.hostname, 'gw.sandbox.gopay.com');
    if (url.pathname.endsWith('/token')) { oauthRequests++; await new Promise(resolve => setTimeout(resolve, 20)); return Response.json({ access_token: 'local-token', expires_in: 1800 }); }
    return Response.json(payment);
  };
  const expected = { orderNumber: 'TEST-123', amountCents: 2390, currency: 'EUR', requirePaid: true };
  try {
    await Promise.all(Array.from({ length: 100 }, () => verifyGoPayPaymentAgainstOrder('123', expected)));
    assert.equal(oauthRequests, 1, 'OAuth refresh must be shared by simultaneous requests.');
    const valid = structuredClone(payment);
    for (const patch of [{ id: '999' }, { order_number: 'OTHER' }, { amount: 2391 }, { amount: -1 }, { currency: 'USD' }, { target: { goid: 777 } }, { state: 'CREATED' }, { state: 'CANCELED' }, { state: 'TIMEOUTED' }, { state: 'FAILED' }]) {
      payment = { ...valid, ...patch };
      await assert.rejects(verifyGoPayPaymentAgainstOrder('123', expected), /GoPay overenie zlyhalo/);
    }
    payment = { ...valid, state: 'AUTHORIZED' }; await verifyGoPayPaymentAgainstOrder('123', expected);
  } finally { globalThis.fetch = originalFetch; }
});

test('payment access rejects a foreign order, modified signatures, altered payloads and expired links', async () => {
  const outfile = join(temporary, 'payment-access.mjs');
  await build({ entryPoints: ['src/lib/payment-access.ts'], outfile, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { makePaymentAccessToken, verifyPaymentAccessToken } = await import(pathToFileURL(outfile).href);
  const token = makePaymentAccessToken('TEST-123');
  assert.equal(verifyPaymentAccessToken(token, 'TEST-123'), true);
  assert.equal(verifyPaymentAccessToken(token, 'TEST-OTHER'), false);
  const [payload, signature] = token.split('.');
  assert.equal(verifyPaymentAccessToken(`${payload}.${signature.slice(0, -2)}xx`, 'TEST-123'), false);
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); data.orderNumber = 'TEST-OTHER';
  assert.equal(verifyPaymentAccessToken(`${Buffer.from(JSON.stringify(data)).toString('base64url')}.${signature}`, 'TEST-OTHER'), false);
  for (const invalid of ['', '.', 'bad.token', null, undefined]) assert.equal(verifyPaymentAccessToken(invalid, 'TEST-123'), false);
  const clock = Date.now;
  try { Date.now = () => clock() + 86401 * 1000; assert.equal(verifyPaymentAccessToken(token, 'TEST-123'), false); }
  finally { Date.now = clock; }
});
