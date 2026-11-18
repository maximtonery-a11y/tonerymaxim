import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { claimConfirmation, claimSubmissionId, clearClaimSubmission } from '../src/scripts/claim-submission.ts';

const root = process.cwd();
await mkdir(join(root, '.tm-cache'), { recursive: true });
const temporary = await mkdtemp(join(root, '.tm-cache', 'claims-integration-'));
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const globals = globalThis as any;
after(async () => {
  globalThis.fetch = originalFetch;
  delete globals.__claimSmtp;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  await rm(temporary, { recursive: true, force: true });
});

const publicPayload = { orderNumber: '301092', email: 'customer@example.invalid', name: 'Test zákazník', phone: '+421900000000', product: 'C731BK', reason: 'Produkt netlačí správne', message: 'Na výtlačku vznikajú čierne pásy.', iban: 'SK-TEST', submissionId: 'test-submission-00001' };
const accountPayload = { order_id: 101, product_id: 201, reason: publicPayload.reason, message: publicPayload.message, submissionId: 'account-submission-0001' };
let fixtureNumber = 0;

async function fixture(options: any = {}) {
  const directory = join(temporary, String(++fixtureNumber));
  const outgoing: any[] = [], requests: any[] = [];
  const claims: any[] = [];
  const order: any = {
    id: 101, number: '101', customer_id: options.guest ? 0 : 7, status: 'completed', total: '29.90',
    billing: { email: 'customer@example.invalid', first_name: 'Test', last_name: 'Zákazník' },
    shipping_lines: [{ method_id: 'dpd_box', total: '2.36', total_tax: '0.54' }], payment_method: 'gopay',
    meta_data: [{ key: 'tm_order_number', value: '301092' }, { key: 'gopay_state', value: 'PAID' }],
    line_items: [{ id: 301, product_id: 201, variation_id: 0, name: 'Canon CRG-731 čierny kompatibilný toner', sku: 'C731BK', quantity: 2 }],
  };
  const originalOrder = structuredClone(order);
  Object.assign(process.env, {
    TM_PERSISTENT_DATA_DIR: directory,
    TM_PERSISTENCE_SECRET: 'claims-integration-unique-persistence-secret-more-than-32-characters',
    AUTH_SECRET: 'claims-integration-unique-session-secret-more-than-32-characters',
    WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'ck_fixture', WOO_CONSUMER_SECRET: 'cs_fixture',
    SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'test@tonerymaxim.sk', SMTP_PASS: 'fixture-only', NODE_ENV: 'test',
  });
  globals.__claimSmtp = async (input: any) => {
    outgoing.push(structuredClone(input));
    if (options.failAllMail || options.failCustomer && input.to === publicPayload.email || options.failAdmin && input.to === 'info@tonerymaxim.sk') throw new Error('Fixture SMTP outage');
    return options.rejectRecipient ? { accepted: [], rejected: [input.to] } : { accepted: [input.to], rejected: [] };
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'woo.example.invalid', 'tests cannot contact a live host');
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, url: url.toString(), body, headers: new Headers(init?.headers) });
    assert.match(String(new Headers(init?.headers).get('authorization')), /^Basic /);
    if (url.pathname.startsWith('/wp-json/wc/v3/')) {
      assert.equal(method, 'GET', 'claims must never modify Woo orders, stock, payment or shipping');
      if (url.pathname === '/wp-json/wc/v3/orders') return Response.json(options.noOrder ? [] : [order]);
      if (url.pathname === '/wp-json/wc/v3/orders/101') return Response.json(order);
      if (url.pathname === '/wp-json/wc/v3/customers/7') return Response.json({ id: 7, email: publicPayload.email, first_name: 'Test', last_name: 'Zákazník', billing: { phone: '+421900000000' } });
      throw new Error(`Unexpected Woo path: ${url.pathname}`);
    }
    assert.equal(url.pathname, '/wp-json/tonerymaxim/v1/reklamacie');
    if (options.pluginOffline) return Response.json({ ok: false }, { status: 503 });
    if (method === 'GET') {
      if (options.badList) return Response.json({ ok: true, claims: null });
      if (options.failReadBack && claims.length) return Response.json({ ok: false }, { status: 503 });
      const email = url.searchParams.get('customer_email');
      const customerId = url.searchParams.get('customer_id');
      return Response.json({ ok: true, claims: claims.filter(claim => (!email || claim.customer_email === email) && (!customerId || claim.customer_id === Number(customerId))) });
    }
    assert.equal(method, 'POST');
    assert.equal(new Headers(init?.headers).get('x-tonerymaxim-suppress-emails'), '1');
    if (options.rejectGuest && body.customer_id === 0) return Response.json({ ok: false, error: 'Guest not supported' }, { status: 400 });
    if (options.badSuccess) return new Response('<html>Login</html>', { status: 200 });
    const claim = { ...body, id: body.claim_number, wp_id: 1001 + claims.length, created_at: new Date().toISOString() };
    claims.push(claim);
    if (options.loseCreateResponse) { options.loseCreateResponse = false; throw new Error('Response lost after WordPress commit'); }
    if (options.wrongResponse) return Response.json({ ok: true, claim: { ...claim, order_id: 999 } });
    return Response.json({ ok: true, claim });
  };
  const outfile = join(directory, 'server.mjs');
  await build({
    stdin: { contents: `export { POST as publicPOST } from './src/pages/api/customer-care/reklamacia.ts'; export { GET as accountGET, POST as accountPOST } from './src/pages/api/account/claims.ts'; export { POST as withdrawalPOST } from './src/pages/api/customer-care/odstupenie.ts'; export { retryOnlineClaims } from './src/lib/online-claims.ts'; export { makeCustomerSession } from './src/lib/auth-session.ts'; export { readSignedJson } from './src/lib/secure-persistence.ts';`, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24', outfile,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'offline-smtp', setup(builder) {
      builder.onResolve({ filter: /^nodemailer$/ }, () => ({ path: 'smtp', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default { createTransport: () => ({ sendMail: (input) => globalThis.__claimSmtp(input) }) };', loader: 'js' }));
    } }],
  });
  const server = await import(pathToFileURL(outfile).href);
  const token = server.makeCustomerSession({ id: 7, email: publicPayload.email });
  const cookies = { get: () => ({ value: token }) };
  async function submit(kind = 'public', patch: any = {}, auth = true) {
    const body = { ...(kind === 'public' ? publicPayload : accountPayload), ...patch };
    const response = await server[kind === 'public' ? 'publicPOST' : 'accountPOST']({ cookies: auth ? cookies : { get: () => undefined }, request: new Request('https://shop.example.invalid/claim', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) });
    return { status: response.status, data: await response.json() };
  }
  const diskRecords = async () => {
    let files: string[] = [];
    try { files = await readdir(join(directory, 'online-claims')); } catch { return []; }
    return Promise.all(files.filter(file => /^R.*\.json$/.test(file)).map(file => server.readSignedJson(join(directory, 'online-claims', file))));
  };
  return { options, directory, server, submit, outgoing, requests, claims, order, originalOrder, cookies, diskRecords };
}

test('guest claim is written and read back in Woo before both complete confirmation emails', async () => {
  const f = await fixture({ guest: true }); const r = await f.submit();
  assert.equal(r.status, 200); assert.equal(r.data.wooSaved, true); assert.equal(r.data.emailSent, true);
  assert.equal('claim' in r.data, false); assert.equal('customer_id' in r.data, false);
  assert.equal(f.claims.length, 1); assert.equal(f.claims[0].customer_id, 0);
  assert.equal(f.claims[0].order_number, '301092'); assert.equal(f.claims[0].product_id, 201);
  assert.match(f.claims[0].message, /IBAN.*SK-TEST/); assert.match(f.claims[0].message, /Telefón.*421900000000/);
  assert.equal(f.outgoing.length, 2);
  for (const outgoing of f.outgoing) { assert.match(outgoing.text, /čierne pásy/); assert.match(outgoing.subject, new RegExp(r.data.caseNumber)); }
  assert.deepEqual(f.order, f.originalOrder);
  const [record] = await f.diskRecords(); assert.equal(record.wooClaim.wp_id, f.claims[0].wp_id);
  const encrypted = await readFile(join(f.directory, 'online-claims', `${record.caseNumber}.json`), 'utf8');
  assert.ok(!encrypted.includes(publicPayload.email)); assert.ok(!encrypted.includes(publicPayload.iban));
});

test('Woo, account and both emails use a short number while retries retain the original internal hash', async () => {
  const f = await fixture(); const r = await f.submit('account');
  assert.equal(r.data.caseNumber, 'R-1001'); assert.equal(r.data.claim.id, 'R-1001');
  const [record] = await f.diskRecords();
  assert.match(record.caseNumber, /^R[A-F0-9]{24}$/);
  assert.equal(f.claims[0].id, record.caseNumber);
  assert.equal(record.payload.claim_number, record.caseNumber);
  assert.ok(f.requests.filter(request => request.method === 'GET' && request.url.includes('/tonerymaxim/')).every(request => new URL(request.url).searchParams.get('claim_number') === record.caseNumber));
  for (const mail of f.outgoing) {
    for (const field of ['subject', 'text', 'html']) {
      assert.match(mail[field], /R-1001/); assert.ok(!mail[field].includes(record.caseNumber));
    }
  }
  const data = await (await f.server.accountGET({ cookies: f.cookies })).json();
  assert.equal(data.claims[0].id, 'R-1001');
  await f.submit('account'); assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
});

test('a pending case gets its short number after Woo recovery without renaming the outbox record', async () => {
  const f = await fixture({ guest: true, pluginOffline: true }); const r = await f.submit();
  assert.equal(r.data.caseNumber, null);
  assert.doesNotMatch(claimConfirmation(r.data), /null|R[A-F0-9]{24}/);
  const [before] = await f.diskRecords();
  f.options.pluginOffline = false; await f.server.retryOnlineClaims();
  const [after] = await f.diskRecords(); assert.equal(after.caseNumber, before.caseNumber);
  assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
  assert.match(f.outgoing[0].subject, /R-1001/);
  assert.equal((await f.submit()).data.caseNumber, 'R-1001');
});

test('historical readable claim numbers are preserved', async () => {
  const f = await fixture();
  f.claims.push({ id: 'R20261019-1234', wp_id: 2002, customer_id: 7, customer_email: publicPayload.email, created_at: new Date().toISOString() });
  const data = await (await f.server.accountGET({ cookies: f.cookies })).json();
  assert.equal(data.claims[0].id, 'R20261019-1234');
});

test('account claim history and the order selector show only the linked order’s TM reference', async () => {
  for (const hasNumber of [true, false]) {
    const f = await fixture();
    if (!hasNumber) f.order.meta_data = [];
    const expected = hasNumber ? '301092' : '';
    const submission = await f.submit('account');
    assert.equal(submission.status, 200);
    assert.equal(submission.data.claim.order_number, expected);
    f.claims[0].order_number = '101';
    const data = await (await f.server.accountGET({ cookies: f.cookies })).json();
    assert.equal(data.claims[0].order_number, expected);
    assert.equal(data.orders[0].number, expected);
  }
});

test('account claim uses authenticated customer and server-side product, without modifying order', async () => {
  const f = await fixture(); const r = await f.submit('account', { customer_id: 999, product_name: 'Forged name' });
  assert.equal(r.status, 200); assert.equal(r.data.wooSaved, true); assert.equal(f.claims[0].customer_id, 7);
  assert.equal(f.claims[0].product_name, f.order.line_items[0].name); assert.equal(f.outgoing.length, 2);
  assert.deepEqual(f.order, f.originalOrder);
});

test('account rejects missing login before any Woo or SMTP request', async () => {
  const f = await fixture(); assert.equal((await f.submit('account', {}, false)).status, 401); assert.equal(f.requests.length, 0); assert.equal(f.outgoing.length, 0);
});

test('account checks actual order ownership even when a product ID is valid', async () => {
  const f = await fixture(); f.order.customer_id = 999;
  assert.equal((await f.submit('account')).status, 403); assert.equal(f.claims.length, 0); assert.equal(f.outgoing.length, 0);
});

test('account rejects product outside the order', async () => {
  const f = await fixture(); assert.equal((await f.submit('account', { product_id: 999 })).status, 400); assert.equal(f.claims.length, 0);
});

test('public rejects a wrong email, wrong order number and wrong product without creating claims', async () => {
  const f = await fixture({ guest: true });
  for (const patch of [{ email: 'another@example.invalid' }, { orderNumber: '99999' }, { product: 'Not in order' }]) assert.equal((await f.submit('public', patch)).status, 400);
  assert.equal(f.claims.length, 0); assert.equal(f.outgoing.length, 0); assert.equal((await f.diskRecords()).length, 0);
});

test('public accepts the Woo ID as well as the TM order number', async () => {
  const f = await fixture({ guest: true }); assert.equal((await f.submit('public', { orderNumber: '101' })).data.wooSaved, true);
});

test('malformed HTTP 200 response never produces a sent confirmation or a verified Woo claim', async () => {
  const f = await fixture({ badSuccess: true }); const r = await f.submit('account');
  assert.equal(r.status, 200); assert.equal(r.data.wooSaved, false); assert.equal(r.data.emailSent, false); assert.equal(r.data.emailPending, true); assert.equal(f.outgoing.length, 0);
});

test('wrong returned order ID is refused and the real record is reconciled before mail on retry', async () => {
  const f = await fixture({ wrongResponse: true }); const r = await f.submit('account');
  assert.equal(r.data.wooSaved, false); assert.equal(f.outgoing.length, 0);
  f.options.wrongResponse = false; await f.server.retryOnlineClaims();
  assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
});

test('failure to read the new case back leaves email pending until verification succeeds', async () => {
  const f = await fixture({ failReadBack: true }); const r = await f.submit();
  assert.equal(r.data.wooSaved, false); assert.equal(f.outgoing.length, 0);
  f.options.failReadBack = false; await f.server.retryOnlineClaims();
  assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
});

test('lost create response is reconciled by case number without a second POST or duplicate email', async () => {
  const f = await fixture({ loseCreateResponse: true }); const a = await f.submit();
  assert.equal(a.data.wooSaved, false); assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 0);
  const [before] = await f.diskRecords();
  const b = await f.submit(); assert.equal(b.data.caseNumber, 'R-1001'); assert.equal(b.data.wooSaved, true);
  assert.equal((await f.diskRecords())[0].caseNumber, before.caseNumber);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1); assert.equal(f.outgoing.length, 2);
});

test('complete Woo outage keeps a durable case and retries before sending emails', async () => {
  const f = await fixture({ pluginOffline: true }); const r = await f.submit();
  assert.equal(r.status, 200); assert.equal(r.data.wooSaved, false); assert.equal((await f.diskRecords()).length, 1); assert.equal(f.outgoing.length, 0);
  f.options.pluginOffline = false; await f.server.retryOnlineClaims();
  assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
});

test('a plugin that rejects guest IDs cannot silently discard a guest claim or send a false confirmation', async () => {
  const f = await fixture({ guest: true, rejectGuest: true }); const r = await f.submit();
  assert.equal(r.data.wooSaved, false); assert.equal(r.data.emailPending, true); assert.equal((await f.diskRecords()).length, 1); assert.equal(f.outgoing.length, 0);
  f.options.rejectGuest = false; await f.server.retryOnlineClaims(); assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
});

test('both SMTP failures are reported as pending; retry preserves the same Woo case', async () => {
  const f = await fixture({ failAllMail: true }); const r = await f.submit('account');
  assert.equal(r.data.wooSaved, true); assert.equal(r.data.emailSent, false); assert.equal(r.data.emailPending, true); assert.equal(r.data.adminEmailPending, true);
  f.options.failAllMail = false; await f.server.retryOnlineClaims();
  assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 4);
  assert.equal((await f.diskRecords())[0].delivery.customer, true);
});

test('customer-only SMTP failure retries only the customer', async () => {
  const f = await fixture({ failCustomer: true }); const r = await f.submit(); assert.equal(r.data.emailPending, true);
  f.options.failCustomer = false; await f.server.retryOnlineClaims();
  assert.deepEqual(f.outgoing.map(mail => mail.to), [publicPayload.email, 'info@tonerymaxim.sk', publicPayload.email]);
});

test('admin-only SMTP failure retries only the administrator', async () => {
  const f = await fixture({ failAdmin: true }); const r = await f.submit('account'); assert.equal(r.data.emailSent, true); assert.equal(r.data.adminEmailPending, true);
  f.options.failAdmin = false; await f.server.retryOnlineClaims();
  assert.deepEqual(f.outgoing.map(mail => mail.to), [publicPayload.email, 'info@tonerymaxim.sk', 'info@tonerymaxim.sk']);
});

test('resolved SMTP result with rejected recipient remains pending', async () => {
  const f = await fixture({ rejectRecipient: true }); const r = await f.submit(); assert.equal(r.data.emailSent, false); assert.equal(r.data.emailPending, true);
});

test('parallel repeated submissions create one Woo record and send each email once', async () => {
  const f = await fixture(); const [a, b] = await Promise.all([f.submit('account'), f.submit('account')]);
  assert.equal(a.data.caseNumber, b.data.caseNumber); assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
  await f.submit('account'); await f.server.retryOnlineClaims(); assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
});

test('reuse of a submission ID with changed content is rejected without a second claim', async () => {
  const f = await fixture(); await f.submit('account');
  assert.equal((await f.submit('account', { message: 'Different problem description.' })).status, 409);
  assert.equal(f.claims.length, 1); assert.equal(f.outgoing.length, 2);
});

test('an old form without a retry identity is asked to refresh before any claim or mail is created', async () => {
  const f = await fixture(); const response = await f.submit('account', { submissionId: undefined });
  assert.equal(response.status, 400); assert.match(response.data.error, /Obnovte stránku/);
  assert.equal(f.claims.length, 0); assert.equal(f.outgoing.length, 0); assert.equal((await f.diskRecords()).length, 0);
});

test('pending account claims are visible only in their customer account', async () => {
  const f = await fixture({ badSuccess: true }); const r = await f.submit('account');
  const response = await f.server.accountGET({ cookies: f.cookies }); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(r.data.caseNumber, null);
  assert.equal(data.claims[0].id, (await f.diskRecords())[0].caseNumber); assert.equal(data.claims[0].wp_id, null);
});

test('malformed list response does not trigger a blind create', async () => {
  const f = await fixture({ badList: true }); const r = await f.submit();
  assert.equal(r.data.wooSaved, false); assert.equal(f.requests.filter(r => r.method === 'POST').length, 0); assert.equal(f.outgoing.length, 0);
});

test('withdrawal continues to save and email independently of the claims API', async () => {
  const f = await fixture({ pluginOffline: true });
  const response = await f.server.withdrawalPOST({ request: new Request('https://shop.example.invalid/withdrawal', { method: 'POST', body: JSON.stringify({ ...publicPayload, address: 'Test adresa 1', products: 'Test toner' }) }) });
  const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.emailSent, true);
  assert.equal(f.requests.length, 0); assert.equal(f.outgoing.length, 2);
});

test('both form scripts use truthful confirmation and isolated retry keys', async () => {
  const source = await readFile(join(root, 'src/scripts/claim-submission.ts'), 'utf8');
  assert.match(source, /emailPending \|\| data.wooSaved === false/);
  for (const path of ['src/pages/reklamacia-online.astro', 'src/pages/ucet/reklamacie.astro']) {
    const page = await readFile(join(root, path), 'utf8');
    assert.match(page, /claimConfirmation\(data\)/); assert.match(page, /claimSubmissionId\(submissionKey, payload\)/);
    assert.doesNotMatch(page, /tm_checkout|tm_submitted_gopay/);
  }
  const accountPage = await readFile(join(root, 'src/pages/ucet/reklamacie.astro'), 'utf8');
  assert.match(accountPage, /claim\.wp_id \?/); assert.match(accountPage, /Číslo pridelíme po spracovaní/);
});

test('browser retry identity survives retries, changes for new content and never touches checkout keys', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>([['tm_checkout_request_id', 'keep-payment-lock']]);
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  try {
    const first = await claimSubmissionId('tm_public_claim_submission_v1', { message: 'Same claim' });
    assert.equal(await claimSubmissionId('tm_public_claim_submission_v1', { message: 'Same claim' }), first);
    assert.notEqual(await claimSubmissionId('tm_public_claim_submission_v1', { message: 'Another claim' }), first);
    clearClaimSubmission('tm_public_claim_submission_v1');
    assert.equal(values.get('tm_checkout_request_id'), 'keep-payment-lock');
    assert.equal(values.has('tm_public_claim_submission_v1'), false);
    assert.match(claimConfirmation({ caseNumber: 'R1', emailPending: true }), /Potvrdenie vám odošleme/);
    assert.match(claimConfirmation({ caseNumber: 'R1', wooSaved: false }), /Potvrdenie vám odošleme/);
    assert.match(claimConfirmation({ caseNumber: 'R1', wooSaved: true, emailPending: false }), /Potvrdenie sme poslali/);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage); else delete globals.sessionStorage;
    clearClaimSubmission('tm_public_claim_submission_v1');
  }
});

test('browser retries reuse identity even when browser storage is unavailable', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
  try {
    const first = await claimSubmissionId('tm_account_claim_submission_v1', { message: 'Retry' });
    assert.equal(await claimSubmissionId('tm_account_claim_submission_v1', { message: 'Retry' }), first);
    clearClaimSubmission('tm_account_claim_submission_v1');
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage); else delete globals.sessionStorage;
  }
});


test('claim receipts separate the old plugin lookup key from the verified customer number', async () => {
  for (const kind of ['account', 'public']) {
    for (const number of ['TM-2025/003786', '']) {
      const f = await fixture({ guest: kind === 'public' });
      f.order.meta_data = number ? [{ key: 'tm_order_snapshot', value: { orderNumber: number } }] : [];
      if (kind === 'public') {
        assert.equal((await f.submit(kind, { orderNumber: '---' })).status, 400);
        assert.equal(f.claims.length, 0);
      }
      const result = await f.submit(kind, kind === 'public' ? { orderNumber: number || '101' } : {});
      assert.equal(result.data.wooSaved, true);
      assert.equal(f.claims[0].order_number, '101');
      if (kind === 'account') assert.equal(result.data.claim.order_number, number);
      for (const message of f.outgoing) {
        assert.ok(message.text.includes('Objednávka: ' + (number || '—')));
        assert.doesNotMatch(message.text, /Objednávka: 101\b/);
        assert.doesNotMatch(message.html, />101<|Objednávka: 101\b/);
      }
    }
  }
});
