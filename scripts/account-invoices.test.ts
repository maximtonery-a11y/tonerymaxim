import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
await mkdir(join(root, '.tm-cache'), { recursive: true });
const directory = await mkdtemp(join(root, '.tm-cache', 'invoices-node-'));
const oldFetch = globalThis.fetch;
const oldEnv = { ...process.env };
after(async () => {
  globalThis.fetch = oldFetch;
  for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
  Object.assign(process.env, oldEnv);
  await rm(directory, { recursive: true, force: true });
});
Object.assign(process.env, {
  WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'ck_fixture', WOO_CONSUMER_SECRET: 'cs_fixture',
  AUTH_SECRET: 'invoice-fixture-authentication-secret-more-than-32-characters', NODE_ENV: 'test',
});
const outfile = join(directory, 'handlers.mjs');
await build({
  stdin: { resolveDir: root, loader: 'ts', contents:
    "export { GET as listGET } from './src/pages/api/account/invoices.ts';" +
    "export { GET as fileGET } from './src/pages/api/account/invoices/[documentId]/[format].ts';" +
    "export { invoiceOrderReference, readInvoiceOrderReference } from './src/lib/account-invoices.ts';" +
    "export { makeCustomerSession } from './src/lib/auth-session.ts';" },
  bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22',
  outfile, define: { 'import.meta.env': '{}' }, logLevel: 'silent',
});
const server = await import(pathToFileURL(outfile).href);
const id = 'b871932e-5bb4-4d77-a0f6-000000000001';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
const xml = Buffer.from('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>');

test('invoice links resolve only for their signed-in customer and survive a reload', () => {
  for (const orderId of [1, 51649, Number.MAX_SAFE_INTEGER]) {
    const ref = server.invoiceOrderReference(7, orderId);
    assert.equal(server.readInvoiceOrderReference(7, ref), orderId);
    assert.equal(server.invoiceOrderReference(7, orderId), ref);
    assert.throws(() => server.readInvoiceOrderReference(8, ref), { status: 400 });
    const changed = ref.endsWith('A') ? 'B' : 'A';
    assert.throws(() => server.readInvoiceOrderReference(7, ref.slice(0, -1) + changed), { status: 400 });
  }
  for (const value of [null, '', '51649', 'a.b', 'a'.repeat(1000)]) {
    assert.throws(() => server.readInvoiceOrderReference(7, value), { status: 400 });
  }
  for (const id of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => server.invoiceOrderReference(7, id), { status: 400 });
  }
});

function fixture(options: any = {}) {
  const requests: any[] = [];
  const document = { id, customer_id: 7, order_id: 101, order_number: '301092',
    number: '2026-001', date: '2026-11-17', type: 'invoice', pdf: true, xml: true, ...options.document };
  globalThis.fetch = async (input: any, init: any) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'woo.example.invalid', 'invoice tests cannot contact a real host');
    assert.equal(init.method, 'GET', 'account invoices must never mutate an order or upload a file');
    assert.match(new Headers(init.headers).get('authorization') || '', /^Basic /);
    assert.equal(init.cache, 'no-store');
    requests.push({ url, init });
    if (options.networkFailure) throw new Error('Internal server/secret path that must not leak');
    if (options.html) return new Response('<html>Sign in</html>');
    if (options.oversize) return new Response('x'.repeat(options.oversize), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/wp-json/wc/v3/orders') {
      assert.equal(url.searchParams.get('customer'), '7');
      assert.equal(url.searchParams.get('include'), '101');
      assert.equal(url.searchParams.get('per_page'), '1');
      assert.equal(url.searchParams.get('_fields'), 'id,customer_id,meta_data');
      if (options.numberLookupFailure) return Response.json({}, { status: 503 });
      return Response.json([{ id: 101, customer_id: 7, number: '101', meta_data: [{ key: 'tm_order_number', value: '301092' }], ...options.order }]);
    }
    const owner = Number(url.searchParams.get('customer_id'));
    if (url.pathname.endsWith('/file')) {
      if (options.missing || owner !== 7) return Response.json({ ok: false }, { status: 404 });
      const format = url.searchParams.get('format');
      const bytes = format === 'xml' ? xml : pdf;
      return Response.json({ ok: true, document_id: id, customer_id: 7, ...options.envelope,
        file: { filename: 'faktura-2026-001.' + format, mime: format === 'xml' ? 'application/xml' : 'application/pdf',
          size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), content_base64: bytes.toString('base64'), ...options.file } });
    }
    assert.equal(url.pathname, '/wp-json/tonerymaxim/v1/invoices');
    const page = Number(url.searchParams.get('page'));
    return Response.json({ ok: true, documents: owner === 7 ? [document] : [], page, has_more: false, ...options.list });
  };
  const cookies = (customer = 7) => ({ get: () => ({ value: server.makeCustomerSession({ id: customer, email: 'fixture@example.invalid' }) }) });
  const list = (query = '', customer = 7) => server.listGET({ cookies: cookies(customer), url: new URL('https://shop.example.invalid/api/account/invoices' + query) });
  const file = (format = 'pdf', customer = 7, documentId = id) => server.fileGET({ cookies: cookies(customer), params: { documentId, format } });
  return { requests, list, file };
}

test('invoice list and downloads reject missing or tampered sessions without contacting Woo', async () => {
  const f = fixture();
  for (const cookies of [{ get: () => undefined }, { get: () => ({ value: 'forged.token' }) }]) {
    const list = await server.listGET({ cookies, url: new URL('https://shop.example.invalid/api/account/invoices') });
    const file = await server.fileGET({ cookies, params: { documentId: id, format: 'pdf' } });
    assert.equal(list.status, 401); assert.equal(file.status, 401);
    assert.match(list.headers.get('cache-control') || '', /no-store/);
  }
  assert.equal(f.requests.length, 0);
});

test('the customer identity always comes from the signed session, never query parameters', async () => {
  const f = fixture(); const response = await f.list('?customer_id=999&order=101&page=2');
  assert.equal(response.status, 200);
  assert.equal(f.requests[0].url.searchParams.get('customer_id'), '7');
  assert.equal(f.requests[0].url.searchParams.get('order_id'), '101');
  assert.equal(f.requests[0].url.searchParams.get('page'), '2');
  const data = await response.json();
  assert.equal(data.documents[0].number, '2026-001');
  assert.equal('customer_id' in data.documents[0], false);
  assert.equal(data.page, 2);
  assert.equal(data.documents[0].order_number, '301092');
  assert.equal(f.requests.length, 2);
});

test('an invoice containing an old Woo reference uses only the verified TM number and stays downloadable without one', async () => {
  for (const [options, expected] of [
    [{}, '301092'], [{ order: { meta_data: [] } }, ''], [{ order: { customer_id: 8 } }, ''], [{ numberLookupFailure: true }, ''],
  ] as const) {
    const f = fixture({ document: { order_number: '101' }, ...options });
    const response = await f.list();
    assert.equal(response.status, 200);
    const { documents } = await response.json();
    assert.equal(documents[0].order_number, expected);
    assert.equal(documents[0].number, '2026-001');
    assert.equal((await f.file()).status, 200);
  }
});

test('PDF download preserves the exact original bytes and sends private attachment headers', async () => {
  const f = fixture(); const response = await f.file();
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition') || '', /^attachment; filename="faktura-2026-001.pdf"/);
  assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy') || '', /sandbox/);
});

test('XML uses the same authenticated download path and returns the original machine-readable file', async () => {
  const f = fixture(); const response = await f.file('xml');
  assert.equal(response.headers.get('content-type'), 'application/xml');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), xml);
  assert.match(response.headers.get('content-disposition') || '', /\.xml/);
});

test('a different customer cannot retrieve the invoice or learn its metadata', async () => {
  const f = fixture();
  assert.equal((await (await f.list('', 8)).json()).documents.length, 0);
  const response = await f.file('pdf', 8);
  assert.equal(response.status, 404);
  assert.ok(!(await response.text()).includes('2026-001'));
});

test('malformed identifiers, traversal attempts and executable formats fail before contacting Woo', async () => {
  const f = fixture();
  for (const [format, value] of [['pdf', '../secret'], ['html', id], ['php', id], ['pdf', '1']]) assert.equal((await f.file(format, 7, value)).status, 404);
  assert.equal(f.requests.length, 0);
});

test('invalid pagination and order filters cannot bypass invoice list limits', async () => {
  const f = fixture();
  for (const query of ['?page=0', '?page=-1', '?page=10001', '?page=1.5', '?page=NaN', '?order=-1', '?order=1.5', '?order=wrong']) assert.equal((await f.list(query)).status, 400);
  assert.equal(f.requests.length, 0);
});

test('a backend list containing another owner or order is refused', async () => {
  for (const document of [{ customer_id: 8 }, { order_id: 999 }]) {
    const f = fixture({ document }); assert.equal((await f.list('?order=101')).status, 503);
  }
});

test('malformed or oversized backend lists never become customer-visible documents', async () => {
  for (const options of [
    { list: { documents: null } }, { list: { page: 9 } }, { list: { has_more: 'true' } },
    { document: { id: '../outside' } }, { document: { xml: 'yes' } }, { document: { type: 'script' } },
    { html: true }, { oversize: 140000 },
  ]) {
    const f = fixture(options); assert.equal((await f.list()).status, 503);
  }
});

test('a hidden or missing document returns a private 404', async () => {
  const f = fixture({ missing: true }); const response = await f.file();
  assert.equal(response.status, 404); assert.match(response.headers.get('cache-control') || '', /no-store/);
});

test('the file envelope must identify this document and this customer', async () => {
  for (const envelope of [{ document_id: 'b871932e-5bb4-4d77-a0f6-000000000002' }, { customer_id: 999 }]) {
    const f = fixture({ envelope }); assert.equal((await f.file()).status, 503);
  }
});

test('corrupted bytes, incorrect sizes, MIME spoofing and header injection fail closed', async () => {
  for (const file of [
    { content_base64: Buffer.from('corrupted').toString('base64') }, { size: pdf.length + 1 },
    { sha256: '0'.repeat(64) }, { mime: 'text/html' }, { filename: 'invoice.pdf\r\nX-Secret: value' },
    { filename: '../invoice.pdf' }, { filename: 'invoice.xml' }, { content_base64: '@@@@' }, { size: 8388609 },
  ]) {
    const f = fixture({ file }); const response = await f.file(); assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('Internal server'));
  }
});

test('backend failures do not disclose raw errors, paths or credentials', async () => {
  const f = fixture({ networkFailure: true });
  const list = await f.list(), download = await f.file();
  assert.equal(list.status, 503); assert.equal(download.status, 503);
  for (const response of [list, download]) assert.doesNotMatch(await response.text(), /secret|ck_fixture|cs_fixture|Internal server/);
});

test('the account UI links to authenticated downloads and supports history beyond the order list', async () => {
  const page = await readFile(join(root, 'src/pages/ucet/faktury.astro'), 'utf8');
  const shell = await readFile(join(root, 'src/components/AccountShell.astro'), 'utf8');
  assert.match(page, /Stiahnuť PDF/); assert.match(page, /document\.xml &&/);
  assert.match(page, /invoice-pagination/); assert.match(page, /noindex,nofollow/);
  assert.doesNotMatch(page, /getWooCustomerOrders|wp-content\/uploads|set:html/);
  assert.match(shell, /href: "\/ucet\/faktury"/);
});
