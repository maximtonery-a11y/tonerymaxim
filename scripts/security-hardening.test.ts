import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { clientIp, normalizeIp, rememberRequestPeer, requestOriginAllowed, safeLoginRedirect, securityPath, secureTokenEqual } from '../src/lib/request-security.ts';
import { requestRateRule } from '../src/lib/rate-policy.ts';
import { validateSyncAccess } from '../src/lib/sync-access.ts';
import { isAdminLocked } from '../src/lib/admin-access.ts';

const base = 'https://www.tonerymaxim.sk';
function request(path = '/api/sync-products', headers: Record<string, string | undefined> = {}, method = 'GET') {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) if (value !== undefined) sanitized[key] = value;
  return new Request(base + path, { method, headers: sanitized });
}
function withEnv(values: Record<string, string>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try { Object.assign(process.env, values); fn(); }
  finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

for (let round = 1; round <= 10; round++) {
  test('security adversarial and compatibility scenarios, round ' + round, async t => {
    await t.test('direct public clients cannot override their network address', () => {
      for (const headers of [
        { 'cf-connecting-ip': '192.0.2.91' },
        { 'x-real-ip': '192.0.2.92' },
        { 'x-forwarded-for': '192.0.2.93, 192.0.2.94' },
      ]) {
        assert.equal(clientIp(request('/', headers), '198.51.100.7'), '198.51.100.7');
        assert.equal(clientIp(request('/', headers)), 'unknown');
      }
    });
    await t.test('one Traefik hop ignores arbitrary prepended identities', () => {
      withEnv({ TM_TRUSTED_PROXY_CIDRS: '172.18.0.0/16,127.0.0.0/8,::1/128' }, () => {
        for (let i = 0; i < 40; i++) {
          const req = request('/', { 'x-forwarded-for': '203.0.113.' + i + ', 198.51.100.17', 'cf-connecting-ip': '192.0.2.' + i, 'x-real-ip': '192.0.2.' + (i + 1) });
          rememberRequestPeer(req, '172.18.0.2');
          assert.equal(clientIp(req), '198.51.100.17');
        }
        assert.equal(clientIp(request('/', { 'x-forwarded-for': '198.51.100.18' }), '172.18.0.2'), '198.51.100.18');
      });
    });
    await t.test('invalid addresses, untrusted proxies and oversized headers fail closed', () => {
      withEnv({ TM_TRUSTED_PROXY_CIDRS: '172.18.0.0/16' }, () => {
        assert.equal(clientIp(request('/', { 'x-forwarded-for': '1.2.3.4' }), '10.1.2.3'), '10.1.2.3');
        for (const forwarded of ['unknown', '1.2.3.4, garbage', '1.2.3.4,', 'x'.repeat(5000)]) {
          assert.equal(clientIp(request('/', { 'x-forwarded-for': forwarded }), '172.18.0.2'), '172.18.0.2');
        }
      });
      for (const cidrs of ['', '0.0.0.0/0', 'invalid', '172.18.0.0/16,bad-entry']) {
        withEnv({ TM_TRUSTED_PROXY_CIDRS: cidrs }, () => assert.equal(clientIp(request('/', { 'x-forwarded-for': '1.2.3.4' }), '172.18.0.2'), '172.18.0.2'));
      }
    });
    await t.test('IPv6 and mapped IPv4 cannot create alternate identities', () => {
      assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
      assert.equal(normalizeIp('::ffff:c000:0201'), '192.0.2.1');
      assert.equal(normalizeIp('[2001:0db8:0:0:0:0:0:1]'), '2001:db8::1');
      assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
      assert.equal(normalizeIp('1.2.3.4:1234'), '');
      withEnv({ TM_TRUSTED_PROXY_CIDRS: '::1/128' }, () => assert.equal(clientIp(request('/', { 'x-forwarded-for': '2001:0db8::1' }), '::1'), '2001:db8::1'));
    });
    await t.test('rate rules cover encoded and trailing-slash paths without changing storefront limits', () => {
      for (const path of ['/api/auth/login', '/api/auth/login/', '/api/auth/%6Cogin', '/api/auth/login///']) {
        assert.equal(securityPath(path), '/api/auth/login');
        assert.equal(requestRateRule(path, 'post')?.limit, 30);
      }
      for (const path of ['/api/contact', '/api/customer-care/claim', '/api/account/change-password', '/api/auth/logout', '/api/sync-products']) assert.ok(requestRateRule(path, 'POST'));
      assert.equal(requestRateRule('/api/products', 'GET')?.limit, 600);
      assert.equal(requestRateRule('/api/gopay-status', 'GET')?.limit, 180);
      assert.equal(requestRateRule('/api/health', 'GET'), undefined);
      assert.equal(requestRateRule('/produkt/test', 'GET'), undefined);
      assert.equal(requestRateRule('/api/gopay-notify', 'POST'), undefined);
    });
    await t.test('sync accepts only consistent header credentials for GET and POST', () => {
      const secret = randomBytes(32).toString('hex');
      for (const method of ['GET', 'POST']) for (const headers of [
        { 'x-sync-token': secret }, { 'x-sync-secret': secret }, { authorization: 'Bearer ' + secret },
        { 'x-sync-token': secret, authorization: 'Bearer ' + secret },
      ]) {
        const req = request('/api/sync-products?force=1', headers, method);
        assert.deepEqual(validateSyncAccess(new URL(req.url), req, secret), { ok: true });
        assert.equal(requestOriginAllowed(req, new URL(req.url)), true);
      }
      const conflict = request('/api/sync-products', { 'x-sync-token': secret, authorization: 'Bearer wrong' });
      assert.equal(validateSyncAccess(new URL(conflict.url), conflict, secret).ok, false);
    });
    await t.test('sync denies URL credentials, missing tokens and localhost host spoofing', () => {
      const secret = randomBytes(32).toString('hex');
      for (const url of [base + '/api/sync-products', 'http://localhost:3000/api/sync-products', 'http://127.0.0.1:3000/api/sync-products']) {
        const req = new Request(url, { headers: { host: 'localhost:3000' } });
        const access = validateSyncAccess(new URL(url), req, secret);
        assert.equal(access.ok, false);
        if (!access.ok) assert.equal(access.status, 401);
      }
      for (const headers of [{}, { 'x-sync-token': secret }]) {
        const req = request('/api/sync-products?token=' + secret, headers);
        const result = validateSyncAccess(new URL(req.url), req, secret);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.status, 400);
      }
      for (const secret of ['', 'short', 'SEM_VLOZTE_DLHY_NAHODNY_TAJNY_RETAZEC']) {
        const req = request();
        const result = validateSyncAccess(new URL(req.url), req, secret);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.status, 503);
      }
      for (const headers of [{ 'x-sync-token': 'wrong' }, { authorization: 'Basic test' }, { authorization: 'Bearer a b' }]) {
        const req = request('/api/sync-products', headers);
        assert.equal(validateSyncAccess(new URL(req.url), req, secret).ok, false);
      }
    });
    await t.test('production admin never trusts a local hostname as authentication', () => {
      withEnv({ NODE_ENV: 'production' }, () => {
        for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]', 'www.tonerymaxim.sk']) {
          assert.equal(isAdminLocked({ adminKey: '', suppliedKey: '', allowLocal: true, hostname }), true);
          assert.equal(isAdminLocked({ adminKey: 'valid-key', suppliedKey: 'bad', allowLocal: true, hostname }), true);
          assert.equal(isAdminLocked({ adminKey: 'valid-key', suppliedKey: 'valid-key', allowLocal: true, hostname }), false);
        }
      });
      assert.equal(secureTokenEqual('é', 'e'), false);
      assert.equal(secureTokenEqual('', ''), false);
    });
    await t.test('external origins fail while normal forms and provider callbacks remain usable', () => {
      for (const origin of ['https://evil.invalid', 'null', 'https://tonerymaxim.sk.evil.invalid']) {
        const req = request('/api/auth/login', { origin }, 'POST');
        assert.equal(requestOriginAllowed(req, new URL(req.url)), false);
      }
      for (const origin of [base, 'https://tonerymaxim.sk']) {
        const req = request('/api/auth/login', { origin }, 'POST');
        assert.equal(requestOriginAllowed(req, new URL(req.url)), true);
      }
      const bare = request('/api/auth/login', {}, 'POST');
      assert.equal(requestOriginAllowed(bare, new URL(bare.url)), false);
      const callback = request('/api/gopay-notify', {}, 'POST');
      assert.equal(requestOriginAllowed(callback, new URL(callback.url)), true);
    });
    await t.test('login redirects stay on this shop and preserve valid return paths', () => {
      for (const path of ['//evil.invalid', '/\\evil.invalid', 'https://evil.invalid', 'javascript:alert(1)', '/%2fevil.invalid', '/%5cevil.invalid', '/%0devil', '/\tevil.invalid']) assert.equal(safeLoginRedirect(path), '/ucet');
      for (const path of ['/ucet', '/pokladna', '/ucet?tab=objednavky', '/produkty?q=HP%20220A']) assert.equal(safeLoginRedirect(path), path);
    });
  });
}
