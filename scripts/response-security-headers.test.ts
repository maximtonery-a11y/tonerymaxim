import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { applyResponseSecurityHeaders } from '../src/lib/response-security-headers.ts';

const cache = fileURLToPath(new URL('../.tm-cache/', import.meta.url));
await mkdir(cache, { recursive: true });
const temporary = await mkdtemp(join(cache, 'response-headers-'));
after(() => rm(temporary, { recursive: true, force: true }));
const outfile = join(temporary, 'middleware.mjs');
await build({
  entryPoints: ['src/middleware.ts'], outfile, bundle: true,
  platform: 'node', format: 'esm', packages: 'external',
  define: { 'import.meta.env': '{}' }, logLevel: 'silent',
  plugins: [{ name: 'astro-middleware-test-adapter', setup(builder) {
    builder.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'middleware', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
      contents: 'export const defineMiddleware = (handler) => handler;', loader: 'js',
    }));
  } }],
});
(globalThis as any).__tmBackgroundWorkersScheduled = true;
const { onRequest } = await import(pathToFileURL(outfile).href);

async function throughMiddleware(path: string, source: Response, method = 'GET') {
  const url = new URL(path, 'https://www.tonerymaxim.sk');
  const request = new Request(url, {
    method, headers: method === 'GET' ? {} : { origin: url.origin },
  });
  return onRequest({ request, url }, async () => source) as Promise<Response>;
}

test('checkout documents gain a non-blocking baseline without changing their body or cookies', async () => {
  for (const path of ['/kosik', '/pokladna', '/platba-dokoncena', '/ucet']) {
    const html = '<!doctype html><html><body><script>window.checkout=true</script><iframe src="https://api.dpd.cz/widget/latest/index.html"></iframe></body></html>';
    const result = await throughMiddleware(path, new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': 'tm_test=retained; Path=/; HttpOnly; Secure; SameSite=Lax',
    } }));
    assert.equal(result.status, 200);
    assert.equal(await result.text(), html);
    assert.equal(result.headers.get('set-cookie'), 'tm_test=retained; Path=/; HttpOnly; Secure; SameSite=Lax');
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(result.headers.get('strict-transport-security'), 'max-age=31536000');
    const policy = result.headers.get('content-security-policy') || '';
    assert.match(policy, /frame-ancestors 'self'/);
    assert.doesNotMatch(policy, /(?:default|script|style|connect|frame|worker|img|font)-src|form-action|sandbox|upgrade-insecure-requests/);
    assert.equal(result.headers.get('permissions-policy'), null);
    assert.equal(result.headers.get('cross-origin-opener-policy'), null);
  }
});

test('GoPay API payloads, return redirects and notifications keep their behavior', async () => {
  for (const [path, method] of [
    ['/api/gopay-create', 'POST'], ['/api/gopay-status?id=123', 'GET'],
    ['/api/gopay-retry', 'POST'], ['/api/gopay-change-payment', 'POST'],
    ['/api/gopay-notify', 'POST'], ['/api/gopay-notify?id=123', 'GET'],
  ]) {
    const result = await throughMiddleware(path, Response.json({ ok: true, gwUrl: 'https://gate.gopay.cz/mock-payment', orderNumber: 'TEST-123' }), method);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { ok: true, gwUrl: 'https://gate.gopay.cz/mock-payment', orderNumber: 'TEST-123' });
    assert.equal(result.headers.get('content-security-policy'), null);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  const redirect = await throughMiddleware('/platba-dokoncena', new Response(null, {
    status: 303, headers: { location: '/platba-dokoncena?id=123', 'Set-Cookie': 'tm_gopay_access=test; SameSite=Lax' },
  }));
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), '/platba-dokoncena?id=123');
  assert.equal(redirect.headers.get('set-cookie'), 'tm_gopay_access=test; SameSite=Lax');
});

test('server-to-server GoPay notifications remain exempt from browser origin checks', async () => {
  const url = new URL('https://www.tonerymaxim.sk/api/gopay-notify');
  let called = false;
  const result = await onRequest({ request: new Request(url, { method: 'POST' }), url }, async () => {
    called = true; return Response.json({ ok: true });
  });
  assert.equal(called, true);
  assert.equal(result.status, 200);
});

test('invoice downloads retain their separate sandbox and download headers', async () => {
  const result = await throughMiddleware('/api/account/invoice/123', new Response('pdf-bytes', { headers: {
    'Content-Type': 'application/pdf', 'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Disposition': 'attachment; filename="invoice.pdf"',
  } }));
  assert.equal(result.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  assert.equal(result.headers.get('content-disposition'), 'attachment; filename="invoice.pdf"');
  assert.equal(await result.text(), 'pdf-bytes');
});

test('HSTS covers HTTPS production behind an HTTP proxy, but excludes staging and unrelated hosts', () => {
  for (const address of ['https://www.tonerymaxim.info', 'http://localhost:4321', 'https://other.tonerymaxim.sk']) {
    const headers = new Headers({ 'Content-Type': 'text/html' });
    applyResponseSecurityHeaders(headers, new URL(address));
    assert.equal(headers.has('Strict-Transport-Security'), false, address);
  }
  for (const address of ['https://tonerymaxim.sk', 'https://www.tonerymaxim.sk', 'http://www.tonerymaxim.sk']) {
    const headers = new Headers(); applyResponseSecurityHeaders(headers, new URL(address));
    assert.equal(headers.get('Strict-Transport-Security'), 'max-age=31536000');
  }
  const existing = new Headers({ 'Content-Type': 'text/html', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Strict-Transport-Security': 'max-age=86400' });
  applyResponseSecurityHeaders(existing, new URL('https://www.tonerymaxim.sk'));
  assert.equal(existing.get('Content-Security-Policy'), "sandbox; default-src 'none'");
  assert.equal(existing.get('Strict-Transport-Security'), 'max-age=86400');
});
