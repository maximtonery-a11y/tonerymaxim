import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(join(tmpdir(), 'tm-abandoned-coupon-'));
const originalFetch = globalThis.fetch;
Object.assign(process.env, {
  WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
  AUTH_SECRET: 'abandoned-coupon-fixture-authentication-secret-at-least-32-characters',
  TM_PERSISTENCE_SECRET: 'abandoned-coupon-fixture-persistence-secret-at-least-32-characters',
  TM_PERSISTENT_DATA_DIR: join(temp, 'data'), TM_DISABLE_BACKGROUND_WORKERS: '1',
});
const outfile = join(temp, 'coupons.mjs');
await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents:
  "export * from './src/lib/coupons.ts';export * from './src/lib/coupon-registry.ts';" +
  "export { POST } from './src/pages/api/cart-benefits.ts';export { makeCustomerSession } from './src/lib/auth-session.ts';" },
  bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', outfile,
  define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
const app = await import(pathToFileURL(outfile).href);
after(async () => { globalThis.fetch = originalFetch; await rm(temp, { recursive: true, force: true }); });
const cart = [{ id: '1', sku: 'A', qty: 1, price: 20, name: 'Kompatibilný toner', product_type_key: 'compatible' }];
let nextCustomer = 5000;
function fixture(options: any = {}) {
  const id = ++nextCustomer, code = `MAXIM${id}`, reads: string[] = [];
  const wallet = options.wallet || [{ code, type: 'thankyou7', label: 'Zľava 7 %', percent: 7, scope: 'compatible', status: 'active' }];
  const orders = (options.orders || []).map((order: any) => ({ id: id + 10000, meta_data: [{ key: 'tm_coupon_code', value: code }], ...order }));
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); reads.push(url.pathname);
    assert.equal(url.hostname, 'woo.example.invalid'); assert.equal(init?.method, 'GET', 'Reading eligibility must not mark a coupon used or change an order');
    if (url.pathname.endsWith(`/customers/${id}`)) return Response.json({ id, email: 'fixture@example.invalid', meta_data: [
      { key: 'tm_coupon_wallet', value: JSON.stringify(wallet) }, { key: 'tm_welcome_discount_used', value: options.welcome ? 'no' : 'yes' },
      { key: 'tm_welcome_discount_expires', value: '2099-01-01T00:00:00Z' },
    ] });
    assert.equal(url.pathname, '/wp-json/wc/v3/orders');
    if (options.historyFailure) throw new Error('Fixture: Woo history unavailable');
    return Response.json(orders);
  };
  const cookie = app.makeCustomerSession({ id, email: 'fixture@example.invalid' });
  const benefits = (body: any = {}) => app.POST({ cookies: { get: () => ({ value: cookie }) },
    request: new Request('https://shop.example.invalid/api/cart-benefits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cart, ...body }) }) });
  return { id, code, orders, reads, benefits };
}

for (const state of ['CREATED', 'PAYMENT_METHOD_CHOSEN', 'CANCELED', 'TIMEOUTED', 'FAILED']) {
  test(`an abandoned ${state} GoPay order leaves the coupon usable in a new authenticated purchase`, async () => {
    const f = fixture({ orders: [{ status: state === 'FAILED' ? 'failed' : 'pending', payment_method: 'gopay' }] });
    f.orders[0].meta_data.push({ key: 'gopay_state', value: state });
    await app.registerIssuedCoupon({ code: f.code, customerId: f.id, sourceOrderId: 10 });
    assert.equal((await app.validateCheckoutCoupon(f.id, f.code, cart)).ok, true);
    assert.equal((await app.getBestAutoCoupon(f.id, cart)).code, f.code);
    const response = await f.benefits({ savedCoupon: { code: f.code, ok: true } });
    assert.equal(response.status, 200); assert.equal((await response.json()).coupon.code, f.code);
    assert.equal((await app.getIssuedCoupon(f.code)).usedAt, undefined);
  });
}

for (const order of [
  { status: 'processing', payment_method: 'gopay' },
  { status: 'pending', payment_method: 'gopay', date_paid: '2026-11-18T10:00:00' },
  { status: 'on-hold', payment_method: 'bacs' },
  { status: 'pending', payment_method: 'cod' },
  { status: 'refunded', payment_method: 'gopay' },
]) {
  test(`a redeemed coupon (${order.payment_method}/${order.status}) is rejected and never automatically reoffered`, async () => {
    const f = fixture({ orders: [order] });
    assert.equal((await app.validateCheckoutCoupon(f.id, f.code, cart)).ok, false);
    assert.equal(await app.getBestAutoCoupon(f.id, cart), null);
    const response = await f.benefits({ savedCoupon: { code: f.code, ok: true } });
    assert.equal(response.status, 200); assert.equal((await response.json()).coupon, null);
    assert.equal(await app.getIssuedCoupon(f.code), null, 'Validation must not create permanent used markers');
  });
}

test('a converted offline order redeems the coupon despite retaining its GoPay ID', () => {
  assert.equal(app.couponRedemptionCommitted({ status: 'on-hold', payment_method: 'bacs', meta_data: [
    { key: 'gopay_payment_id', value: '123' }, { key: 'gopay_state', value: 'CONVERTED_TO_OFFLINE' },
  ] }), true);
  assert.equal(app.couponRedemptionCommitted({ status: 'pending', payment_method: 'gopay', meta_data: [{ key: 'gopay_state', value: 'AUTHORIZED' }] }), true);
});

test('legacy validation-only used markers are recoverable with evidence of an unpaid gateway order', async () => {
  const f = fixture({ orders: [{ status: 'pending', payment_method: 'gopay' }] });
  await app.registerIssuedCoupon({ code: f.code, customerId: f.id });
  await app.markIssuedCouponUsed(f.code);
  assert.equal((await app.validateCheckoutCoupon(f.id, f.code, cart)).ok, true);
  assert.equal((await app.validateCheckoutCoupon(undefined, f.code, cart)).ok, true);
  assert.equal((await app.getBestAutoCoupon(f.id, cart)).ok, true);
});

test('a recorded redemption with an order ID remains used even if the customer wallet is stale', async () => {
  const f = fixture(); await app.registerIssuedCoupon({ code: f.code, customerId: f.id });
  await app.markIssuedCouponUsed(f.code, 90001);
  assert.equal((await app.validateCheckoutCoupon(f.id, f.code, cart)).ok, false);
  assert.equal((await app.validateCheckoutCoupon(undefined, f.code, cart)).ok, false);
  assert.equal(await app.getBestAutoCoupon(f.id, cart), null);
});

test('the next eligible automatic coupon is chosen after the most valuable one was used', async () => {
  const f = fixture({ welcome: true, orders: [{ status: 'completed', payment_method: 'gopay' }] });
  const automatic = await app.getBestAutoCoupon(f.id, cart);
  assert.equal(automatic.type, 'welcome5'); assert.equal(automatic.percent, 5);
  assert.equal((await app.validateCheckoutCoupon(f.id, automatic.code, cart)).ok, true);
});

test('explicitly declining a coupon wins over automatic and manually saved coupon state', async () => {
  const f = fixture();
  const response = await f.benefits({ couponDisabled: true, savedCoupon: { code: f.code, manual: true }, enteredCode: f.code });
  assert.equal(response.status, 200); assert.equal((await response.json()).coupon, null);
});

test('several stale automatic candidates share one usage lookup before the next valid coupon is selected', async () => {
  const f = fixture({ wallet: [
    { code: 'USED10', type: 'marketing', label: '10 %', percent: 10, scope: 'all', status: 'active' },
    { code: 'ACTIVE7', type: 'marketing', label: '7 %', percent: 7, scope: 'all', status: 'active' },
  ], orders: [{ status: 'completed', payment_method: 'cod', meta_data: [{ key: 'tm_coupon_code', value: 'USED10' }] }] });
  assert.equal((await app.getBestAutoCoupon(f.id, cart)).code, 'ACTIVE7');
  assert.equal(f.reads.filter(path => path.endsWith('/orders')).length, 1);
});

test('unavailable usage history fails eligibility verification instead of declaring a coupon valid', async () => {
  const f = fixture({ historyFailure: true });
  await assert.rejects(app.validateCheckoutCoupon(f.id, f.code, cart), /unavailable/);
  await assert.rejects(app.getBestAutoCoupon(f.id, cart), /unavailable/);
});
