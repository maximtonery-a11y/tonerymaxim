import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const directory = await mkdtemp(join(tmpdir(), 'tm-account-orders-'));
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); });
Object.assign(process.env, { WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
  AUTH_SECRET: 'account-order-fixture-authentication-secret-at-least-32-characters' });
const outfile = join(directory, 'account.mjs');
await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents:
  "export * from './src/lib/account-orders.ts';export * from './src/lib/account-reorder-cart.ts';" +
  "export { POST } from './src/pages/api/account/reorder.ts';export { makeCustomerSession } from './src/lib/auth-session.ts';" },
  bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', outfile,
  define: { 'import.meta.env': '{}' }, logLevel: 'silent', plugins: [{ name: 'isolated-catalog', setup(plugin) {
    plugin.onResolve({ filter: /\/(tm-products-cache|calendar-catalog)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /tm-products-cache$/, namespace: 'fixture' }, () => ({ contents: 'export async function getProductsCache(){return {products:globalThis.__tmOrderCatalog||[]}}' }));
    plugin.onLoad({ filter: /calendar-catalog$/, namespace: 'fixture' }, () => ({ contents: 'export const CALENDAR_SOURCE="kalendare-2027";export async function getCalendarProducts(){return globalThis.__tmOrderCalendars||[]}' }));
  } }] });
const app = await import(pathToFileURL(outfile).href);
const clientBundle = (await build({ entryPoints: ['src/scripts/account-reorder.ts'], bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent' })).outputFiles[0].text;
let customerId = 100;
function fixture(options: any = {}) {
  const customer = ++customerId;
  const requests: URL[] = [];
  const orders = (options.orders || [{ id: 701, total: '123.00', total_tax: '23.00', status: 'completed', currency: 'EUR',
    line_items: [{ product_id: 11, sku: 'SKU-11', name: 'Old toner', quantity: 4, total: '999.00' }] }]).map((order: any) => ({ customer_id: customer, ...order }));
  (globalThis as any).__tmOrderCatalog = options.catalog || [{ id: 11, sku: 'SKU-11', name: 'Cached toner', price: 8, product_type_key: 'compatible', image: '/toner.jpg' }];
  (globalThis as any).__tmOrderCalendars = options.calendars || [];
  globalThis.fetch = async (input: any, init: any) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.hostname, 'woo.example.invalid', 'account tests must not call real services');
    assert.equal(init.method, 'GET', 'reordering must never create or modify a Woo order');
    assert.match(new Headers(init.headers).get('authorization') || '', /^Basic /);
    if (options.networkFailure) throw new Error('private server path with credentials');
    if (url.pathname.endsWith('/orders')) {
      assert.equal(url.searchParams.get('customer'), String(customer));
      const page = Number(url.searchParams.get('page')), size = Number(url.searchParams.get('per_page'));
      if (options.failPage === page) return Response.json({ message: 'private detail' }, { status: 500 });
      const total = orders.length + (options.changingTotal && page > 1 ? 1 : 0);
      const headers: Record<string, string> = options.missingHeaders ? {} : { 'X-WP-Total': String(total), 'X-WP-TotalPages': String(Math.ceil(total / size)) };
      return Response.json(orders.slice((page - 1) * size, page * size), { headers });
    }
    if (/\/orders\/\d+$/.test(url.pathname)) return Response.json(options.order || orders.find((order: any) => order.id === Number(url.pathname.split('/').pop())) || {}, { status: options.orderMissing ? 404 : 200 });
    assert.equal(url.pathname, '/wp-json/wc/v3/products');
    return Response.json(options.live || [{ id: 11, sku: 'SKU-11', name: 'Current toner', price: '13.05', status: 'publish', stock_status: 'instock', stock_quantity: 2 }]);
  };
  const cookies = { get: () => ({ value: app.makeCustomerSession({ id: customer, email: 'fixture@example.invalid' }) }) };
  const post = (body: any = { orderId: 701 }, overrideCookies: any = cookies, contentType = 'application/json') => app.POST({ cookies: overrideCookies,
    request: new Request('https://shop.example.invalid/api/account/reorder', { method: 'POST', headers: { 'Content-Type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  return { customer, requests, orders, post };
}

test('lifetime count and spend include more than 100 orders, with complete pagination and refunds', async () => {
  const orders = Array.from({ length: 151 }, (_, index) => ({ id: 1000 + index, status: 'completed', total: '10.00', total_tax: '0.00', currency: 'EUR' }));
  orders[140] = { ...orders[140], status: 'cancelled' };
  orders[141] = { ...orders[141], status: 'pending' };
  (orders[142] as any).refunds = [{ total: '-3.25' }];
  const f = fixture({ orders });
  const summary = await app.getAccountOverview(f.customer);
  assert.equal(summary.count, 151); assert.deepEqual(summary.spending, [{ currency: 'EUR', total: 1486.75 }]);
  assert.equal(f.requests.filter(url => url.pathname.endsWith('/orders')).length, 3);
  assert.equal(f.requests[2].searchParams.get('page'), '2');
  const count = f.requests.length;
  await app.getAccountOverview(f.customer); assert.equal(f.requests.length, count, 'complete summaries are cached');
  const second = await app.getAccountOrdersPage(f.customer, 2);
  assert.equal(second.orders.length, 20); assert.equal(second.orders[0].id, 1020); assert.equal(second.totalPages, 8);
  const last = await app.getAccountOrdersPage(f.customer, 8); assert.equal(last.orders.length, 11); assert.equal(last.hasMore, false);
});

test('summary separates currencies and excludes failed, unpaid, cancelled and refunded orders', async () => {
  const f = fixture({ orders: [
    { id: 1, status: 'processing', total: '123', currency: 'EUR' },
    { id: 2, status: 'tm-shipped', total: '50', currency: 'EUR', refunds: [{ total: '-10' }] },
    { id: 3, status: 'completed', total: '1000', currency: 'CZK' },
    { id: 4, status: 'custom-status', date_paid: '2026-11-17T10:00:00', total: '20', currency: 'EUR' },
    ...['pending', 'on-hold', 'tm-await-pay', 'cancelled', 'failed', 'refunded', 'checkout-draft', 'tm-returned'].map((status, index) => ({ id: 10 + index, status, date_paid: '2026-11-17', total: '999', currency: 'EUR' })),
  ] });
  const result = await app.getAccountOverview(f.customer);
  assert.equal(result.count, 12); assert.deepEqual(result.spending, [{ currency: 'EUR', total: 183 }, { currency: 'CZK', total: 1000 }]);
});

test('historical taxes come from the order: 20%, 23%, zero tax, missing tax, partial refund', () => {
  assert.equal(app.accountOrderTotals({ total: '120.00', total_tax: '20.00' }).net, 100);
  assert.equal(app.accountOrderTotals({ total: '123.00', total_tax: '23.00' }).net, 100);
  assert.equal(app.accountOrderTotals({ total: '100.00', total_tax: '0.00' }).net, 100);
  assert.equal(app.accountOrderTotals({ total: '123.00' }).net, null, 'missing tax must not be guessed');
  assert.equal(app.accountOrderTotals({ total: '100', total_tax: '120' }).net, null);
  assert.equal(app.accountOrderTotals({ total: '123', total_tax: '23', refunds: [{ total: '-12.30' }, { total: '-10' }] }).afterRefund, 100.70);
});

test('an interrupted, changed or cross-customer history never becomes a misleading lifetime sum', async () => {
  for (const mode of ['failPage', 'changingTotal', 'missingHeaders', 'foreign']) {
    const rows = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, total: '10', currency: 'EUR', status: 'completed', ...(mode === 'foreign' && index === 0 ? { customer_id: 0 } : {}) }));
    const f = fixture({ orders: rows, [mode]: mode === 'failPage' ? 2 : true });
    await assert.rejects(app.getAccountOverview(f.customer), app.AccountOrderError);
  }
});

test('invalid pages and missing sessions are rejected before accessing Woo', async () => {
  const f = fixture();
  for (const input of ['-1', '1.5', 'abc', '1e3', '100001']) assert.throws(() => app.accountOrderPage(input), app.AccountOrderError);
  assert.equal(app.accountOrderPage(null), 1);
  for (const cookies of [{ get: () => undefined }, { get: () => ({ value: 'forged.token' }) }]) {
    const response = await f.post({ orderId: 701 }, cookies);
    assert.equal(response.status, 401); assert.match(response.headers.get('cache-control') || '', /no-store/);
  }
  for (const body of [{ orderId: '701' }, { orderId: -1 }, { orderId: 1.5 }, null, 'not-json', 'x'.repeat(1001)]) assert.equal((await f.post(body)).status, 400);
  assert.equal(f.requests.length, 0);
});

test('guest or foreign orders cannot be repeated even with a matching email or submitted owner', async () => {
  for (const owner of [0, 9999]) {
    const f = fixture({ order: { id: 701, customer_id: owner, billing: { email: 'fixture@example.invalid' }, line_items: [] } });
    const response = await f.post({ orderId: 701, customer_id: owner });
    assert.equal(response.status, 404); assert.equal(f.requests.length, 1);
    assert.equal(JSON.stringify(await response.json()).includes('billing'), false);
  }
});

test('repeat preview uses current Woo prices, exact IDs and stock, not historical totals or discounts', async () => {
  const f = fixture(); const response = await f.post({ orderId: 701, coupon: 'OLD-100-PERCENT', customer_id: 999 });
  assert.equal(response.status, 200); const { plan } = await response.json();
  assert.equal(plan.items[0].price, 13.05); assert.equal(plan.items[0].qty, 4);
  assert.equal(plan.items[0].name, 'Current toner'); assert.equal(plan.items[0].product_type_key, 'compatible');
  assert.match(plan.items[0].stock_text, /2 ks skladom.*2 ks dodáme/);
  assert.equal(JSON.stringify(plan).includes('OLD-100-PERCENT'), false);
  assert.equal(plan.items[0].loyalty_reward, undefined);
  assert.equal(f.requests.length, 2);
});

test('deleted, hidden, changed-SKU, unpriced and unsupported variant lines are explicitly skipped', async () => {
  for (const live of [[], [{ id: 11, sku: 'OTHER', price: '10', status: 'publish' }], [{ id: 11, sku: 'SKU-11', price: '', status: 'publish' }], [{ id: 11, sku: 'SKU-11', price: '10', status: 'draft' }]]) {
    const f = fixture({ live }); const data = await (await f.post()).json();
    assert.equal(data.plan.items.length, 0); assert.equal(data.plan.skipped.length, 1);
  }
  const f = fixture({ orders: [{ id: 701, line_items: [{ name: 'Variant', product_id: 11, variation_id: 22, quantity: 1 }] }] });
  const data = await (await f.post()).json(); assert.match(data.plan.skipped[0].reason, /variant/);
});

test('historical loyalty gifts are not copied and stock-on-order products remain clearly identified', async () => {
  const f = fixture({ orders: [{ id: 701, line_items: [
    { product_id: 11, sku: 'SKU-11', name: 'Toner', quantity: 2 },
    { product_id: 11, sku: 'SKU-11', name: 'Gift', quantity: 1, meta_data: [{ key: 'tm_loyalty_reward', value: 'yes' }] },
  ] }], live: [{ id: 11, sku: 'SKU-11', price: '20', status: 'publish', stock_status: 'outofstock', stock_quantity: 0 }] });
  const data = await (await f.post()).json();
  assert.equal(data.plan.items.length, 1); assert.equal(data.plan.items[0].qty, 2);
  assert.match(data.plan.items[0].stock_text, /na objednávku/); assert.match(data.plan.skipped[0].reason, /darček/);
});

test('cart merge preserves other items and gifts, updates prices, adds quantities and is atomic', async () => {
  const f = fixture(); const { plan } = await (await f.post()).json();
  const original = [{ sku: 'UNRELATED', qty: 3, price: 5 }, { sku: 'SKU-11', qty: 2, price: 1 }, { sku: 'SKU-11', qty: 1, price: 0.01, loyalty_reward: true }];
  const before = JSON.stringify(original);
  const result = app.mergeAccountReorder(original, plan);
  assert.equal(JSON.stringify(original), before); assert.deepEqual(result.cart[0], original[0]);
  assert.equal(result.cart[1].qty, 6); assert.equal(result.cart[1].price, 13.05); assert.equal(result.added, 4);
  assert.deepEqual(result.cart[2], original[2]);
  const limited = app.mergeAccountReorder([{ sku: 'SKU-11', qty: 98, price: 1 }], plan);
  assert.equal(limited.cart[0].qty, 99); assert.equal(limited.added, 1); assert.equal(limited.limited.length, 1);
  assert.throws(() => app.mergeAccountReorder(original, { ...plan, items: [...plan.items, { sku: 'BAD', qty: 1, price: 0 }] }));
  assert.equal(JSON.stringify(original), before);
});

test('empty histories show real zeros and concurrent overview requests share one scan', async () => {
  const f = fixture({ orders: [] });
  const [a, b] = await Promise.all([app.getAccountOverview(f.customer), app.getAccountOverview(f.customer)]);
  assert.deepEqual(a, { count: 0, spending: [], latestOrder: null }); assert.deepEqual(a, b);
  assert.equal(f.requests.length, 2);
  await assert.rejects(app.getAccountOrdersPage(f.customer, 2), (error: any) => error.status === 404);
});

test('calendar repeats preserve the calendar source and exclude discontinued calendars', async () => {
  const f = fixture({ orders: [{ id: 701, line_items: [
    { sku: 'CAL-1', name: 'Calendar', quantity: 3, meta_data: [{ key: 'tm_catalog_source', value: 'kalendare-2027' }] },
    { sku: 'CAL-OLD', name: 'Old calendar', quantity: 1, meta_data: [{ key: 'tm_catalog_source', value: 'kalendare-2027' }] },
  ] }], calendars: [{ sku: 'CAL-1', name: 'Current calendar', slug: 'calendar.html', price: 2.50, availability: { inStock: true } }] });
  const { plan } = await (await f.post()).json();
  assert.equal(plan.items.length, 1); assert.equal(plan.items[0].source, 'kalendare-2027');
  assert.equal(plan.items[0].price, 2.5); assert.equal(plan.items[0].qty, 3); assert.equal(plan.skipped.length, 1);
  assert.equal(plan.items[0].stock_text, 'Skladom', 'unmanaged in-stock quantities must not look like backorders');
});

function clientFixture(plan: any) {
  class Element {
    listeners = new Map<string, (event: any) => any>();
    disabled = false; hidden = true; innerHTML = ''; textContent = ''; selector = '';
    dataset = { accountOrder: '701' };
    addEventListener(type: string, callback: any) { this.listeners.set(type, callback); }
    closest(selector: string) { return selector === this.selector ? this : null; }
    querySelector(_selector: string) { return confirm; }
    focus() {}
  }
  const start = new Element(), panel = new Element(), status = new Element(), confirm = new Element(), cancel = new Element();
  confirm.selector = '[data-reorder-confirm]'; cancel.selector = '[data-reorder-cancel]';
  const card = new Element();
  card.querySelector = (selector: string) => ({ '[data-reorder-start]': start, '[data-reorder-preview]': panel, '[data-reorder-status]': status } as any)[selector];
  let cart: any[] = [{ sku: 'OTHER', qty: 2, price: 1 }];
  const writes: any[] = [], navigations: string[] = [], requests: any[] = [];
  const window = { ToneryMaximCart: { readCart: () => cart.map(item => ({ ...item })), saveCart: (next: any[]) => { cart = next; writes.push(next); } }, location: { assign: (path: string) => navigations.push(path) } };
  runInNewContext(clientBundle, { Element, Intl, Date, JSON, Error, Number, String, Array, Object, Math,
    document: { querySelectorAll: () => [card] }, window,
    fetch: async (path: string, init: any) => { requests.push({ path, init }); return { ok: true, json: async () => ({ ok: true, plan }) }; },
  });
  return { start, panel, status, confirm, cancel, writes, navigations, requests,
    changeCart: () => { cart.push({ sku: 'ANOTHER', qty: 1, price: 1 }); },
    startClick: () => start.listeners.get('click')!({ target: start }),
    confirmClick: () => panel.listeners.get('click')!({ target: confirm }),
    cancelClick: () => panel.listeners.get('click')!({ target: cancel }) };
}

test('compiled account UI previews before one confirmed cart write and supports cancellation', async () => {
  const f = fixture(); const { plan } = await (await f.post()).json();
  const ui = clientFixture(plan); await ui.startClick();
  assert.equal(ui.panel.hidden, false); assert.match(ui.panel.innerHTML, /13,05/);
  assert.equal(ui.writes.length, 0, 'opening a preview must not change the cart');
  ui.cancelClick(); assert.equal(ui.panel.hidden, true); assert.equal(ui.writes.length, 0);
  await ui.startClick(); await ui.confirmClick();
  assert.equal(ui.writes.length, 1); assert.equal(ui.writes[0][0].sku, 'OTHER');
  assert.equal(ui.writes[0][1].qty, 4); assert.equal(ui.writes[0][1].price, 13.05);
  assert.deepEqual(ui.navigations, ['/kosik']);
  assert.equal(ui.requests.every(request => request.path === '/api/account/reorder'), true);
});

test('compiled account UI requires a fresh confirmation after cart changes or an expired preview', async () => {
  const f = fixture(); const { plan } = await (await f.post()).json();
  const ui = clientFixture(plan); await ui.startClick(); ui.changeCart(); await ui.confirmClick();
  assert.equal(ui.writes.length, 0); assert.match(ui.status.textContent, /košíka sa zmenil/);
  await ui.confirmClick(); assert.equal(ui.writes.length, 1);
  const expired = clientFixture({ ...plan, checkedAt: Date.now() - 130_000 });
  await expired.startClick(); await expired.confirmClick();
  assert.equal(expired.writes.length, 0); assert.equal(expired.requests.length, 2);
  assert.match(expired.status.textContent, /obnovili/);
});

test('duplicate lines merge safely, quantities above 99 are disclosed and failures leak no secrets', async () => {
  const f = fixture({ orders: [{ id: 701, line_items: [{ product_id: 11, sku: 'SKU-11', quantity: 90 }, { product_id: 11, sku: 'SKU-11', quantity: 20 }] }] });
  const { plan } = await (await f.post()).json();
  assert.equal(plan.items.length, 1); assert.equal(plan.items[0].qty, 99); assert.match(plan.skipped[0].reason, /99/);
  const failure = fixture({ networkFailure: true }); const response = await failure.post();
  assert.equal(response.status, 404); assert.equal((await response.text()).includes('credentials'), false);
});
