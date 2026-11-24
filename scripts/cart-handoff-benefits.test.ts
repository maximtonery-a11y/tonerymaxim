import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { remainingCart, acceptSubmittedOrder, readSubmittedOrder, consumeLegacySubmittedCart, cartSignature, resetCheckoutAttempt, saveShoppingCart } from '../src/scripts/submitted-order.js';
import { getCartBenefits, readCartBenefits, readDrawerBenefits, invalidateCartBenefits, couponDisabled, setCouponDisabled } from '../src/scripts/cart-benefits.js';

class Storage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const local = new Storage(), session = new Storage();
Object.assign(globalThis, { localStorage: local, sessionStorage: session, window: new EventTarget() });
const previousFetch = globalThis.fetch;
const a = { id: '1', sku: 'A', qty: 2, price: 10, product_type_key: 'compatible', name: 'A' };
const b = { id: '2', sku: 'B', qty: 1, price: 12, name: 'B' };
const receipt = { requestId: 'checkout-fixture', paymentId: '1001', orderNumber: '301001', gwUrl: 'https://example.invalid/gateway' };
const benefits = { ok: true, customerId: 7, loyalty: { ok: true, points: 24, discountValue: 0.24, paperReward: null }, coupon: { ok: true, code: 'TEST7', percent: 7, scope: 'compatible' } };
beforeEach(() => { local.clear(); session.clear(); });
after(() => { globalThis.fetch = previousFetch; });
const currentCart = () => JSON.parse(local.getItem('tm_cart_v1') || '[]');
function identity(id = 7) { session.setItem('tm_header_account_v1', JSON.stringify({ customer: id ? { id } : null, expiresAt: Date.now() + 300000 })); }

test('accepted items are consumed once before the gateway; reloading cannot consume a new identical purchase', () => {
  local.setItem('tm_cart_v1', JSON.stringify([a]));
  local.setItem('cart', JSON.stringify([a]));
  acceptSubmittedOrder([a], receipt);
  assert.deepEqual(currentCart(), []); assert.equal(local.getItem('cart'), null);
  assert.equal(readSubmittedOrder().cartCommitted, true);
  local.setItem('tm_cart_v1', JSON.stringify([a]));
  acceptSubmittedOrder([a], receipt); consumeLegacySubmittedCart();
  assert.deepEqual(currentCart(), [a]);
});

test('new items, extra units, calendar items and reward identity survive a submitted snapshot', () => {
  assert.deepEqual(remainingCart([{ ...a, qty: 3 }, b], [a]), [{ ...a, qty: 1 }, b]);
  const paper = { ...b, sku: 'PAPER', loyalty_reward: true };
  const paidPaper = { ...paper, loyalty_reward: false };
  assert.deepEqual(remainingCart([paper, paidPaper], [paper]), [paidPaper]);
  assert.deepEqual(remainingCart([{ ...a, source: 'kalendare-2027' }, a], [a]), [{ ...a, source: 'kalendare-2027' }]);
});

test('a deliberate new cart clears legacy submitted signatures, request IDs, automatic-coupon choices and aliases', () => {
  local.setItem('tm_submitted_gopay_v1', JSON.stringify({ ...receipt, submittedAt: Date.now(), cartSignature: cartSignature([a]) }));
  local.setItem('tm_checkout_intent_v2', JSON.stringify({ requestId: receipt.requestId, cartSignature: cartSignature([a]) }));
  session.setItem('tm_checkout_request_id', receipt.requestId);
  local.setItem('cart', JSON.stringify([a])); setCouponDisabled(true);
  resetCheckoutAttempt(); local.setItem('tm_cart_v1', JSON.stringify([a]));
  assert.equal(consumeLegacySubmittedCart(), null); assert.deepEqual(currentCart(), [a]);
  assert.equal(local.getItem('tm_checkout_intent_v2'), null); assert.equal(session.getItem('tm_checkout_request_id'), null);
  assert.equal(local.getItem('cart'), null); assert.equal(couponDisabled(), false);
});

test('background sync of an empty cart preserves the accepted order; the first genuinely new product detaches it', () => {
  local.setItem('tm_cart_v1', JSON.stringify([a])); acceptSubmittedOrder([a], receipt);
  saveShoppingCart([]); saveShoppingCart([]);
  assert.equal(readSubmittedOrder().paymentId, receipt.paymentId);
  saveShoppingCart([a]); assert.equal(readSubmittedOrder(), null);
  assert.deepEqual(currentCart(), [a]);
});

test('removing a coupon survives refresh/navigation and identity changes release the choice', async () => {
  identity(); let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    return Response.json({ ...benefits, coupon: body.couponDisabled ? null : benefits.coupon });
  };
  await getCartBenefits([a]); setCouponDisabled(true);
  assert.equal(readCartBenefits([a]), null);
  assert.equal((await getCartBenefits([a])).coupon, null);
  await getCartBenefits([a]); assert.equal(calls, 2); assert.equal(couponDisabled(), true);
  invalidateCartBenefits(true); assert.equal(couponDisabled(), false);
});

test('legacy abandoned gateway consumes only the exact old cart, once, and never a different cart', () => {
  local.setItem('tm_submitted_gopay_v1', JSON.stringify({ ...receipt, submittedAt: Date.now(), cartSignature: cartSignature([a]) }));
  local.setItem('tm_cart_v1', JSON.stringify([b])); consumeLegacySubmittedCart(); assert.deepEqual(currentCart(), [b]);
  local.setItem('tm_cart_v1', JSON.stringify([a])); consumeLegacySubmittedCart(); assert.deepEqual(currentCart(), []);
  local.setItem('tm_cart_v1', JSON.stringify([b])); consumeLegacySubmittedCart(); assert.deepEqual(currentCart(), [b]);
});

test('100 simultaneous benefit lookups share one request; navigation reuses the scoped estimate', async () => {
  identity(); let calls = 0;
  globalThis.fetch = async (input, init) => { calls++; assert.equal(input, '/api/cart-benefits'); assert.equal(init?.method, 'POST'); await new Promise(r => setTimeout(r, 10)); return Response.json(benefits); };
  const all = await Promise.all(Array.from({ length: 100 }, () => getCartBenefits([a])));
  assert.equal(calls, 1); assert.equal(all[0].loyalty.discountValue, 0.24);
  await getCartBenefits([a]); assert.equal(calls, 1);
  assert.deepEqual(readCartBenefits([a]), benefits);
  await getCartBenefits([{ ...a, qty: 3 }]); assert.equal(calls, 2);
});

test('another account, changed prices, expired estimates and explicit coupons cannot reuse the wrong result', async () => {
  identity(); let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(benefits); };
  await getCartBenefits([a]); identity(8); assert.equal(readCartBenefits([a]), null);
  identity(); assert.equal(readCartBenefits([{ ...a, price: 11 }]), null);
  const saved = JSON.parse(session.getItem('tm_cart_benefits_v1')!); saved.until = Date.now() - 1;
  session.setItem('tm_cart_benefits_v1', JSON.stringify(saved)); assert.equal(readCartBenefits([a]), null);
  await getCartBenefits([a], { enteredCode: 'MANUAL' }); assert.equal(calls, 2);
});

test('late responses after logout or order acceptance never restore old benefits; failures remain retryable', async () => {
  identity(); let release: () => void = () => {};
  globalThis.fetch = async () => { await new Promise<void>(r => { release = r; }); return Response.json(benefits); };
  const request = getCartBenefits([a]); invalidateCartBenefits(true); release();
  await assert.rejects(request, /medzičasom/); assert.equal(session.getItem('tm_cart_benefits_v1'), null);
  globalThis.fetch = async () => Response.json({}, { status: 503 }); await assert.rejects(getCartBenefits([a]));
  globalThis.fetch = async () => Response.json(benefits); await getCartBenefits([a]); assert.ok(readCartBenefits([a]));
});

await mkdir('.tm-cache', { recursive: true });
const temp = await mkdtemp(resolve('.tm-cache/payment-return-'));
Object.assign(process.env, { TM_PERSISTENT_DATA_DIR: join(temp, 'data'), AUTH_SECRET: 'payment-return-fixture-strong-secret-with-at-least-32-characters',
  TM_PERSISTENCE_SECRET: 'payment-return-fixture-storage-secret-at-least-32-characters',
  WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
  GOPAY_ENV: 'sandbox', GOPAY_GOID: '999999', GOPAY_CLIENT_ID: 'fixture', GOPAY_CLIENT_SECRET: 'fixture',
  TM_DISABLE_BACKGROUND_WORKERS: '1', TM_ASYNC_WOO_INITIAL_DELAY_MS: '3600000', CHECKOUT_PROFILER: '0' });
const file = join(temp, 'server.mjs');
await build({ stdin: { contents: `export { GET as status } from './src/pages/api/gopay-status.ts';export { POST as change } from './src/pages/api/gopay-change-payment.ts';
export { savePendingGoPayOrder,readPendingGoPayOrder } from './src/lib/checkout-order.ts';export { enqueueAsyncWooOrder } from './src/lib/async-order-queue.ts';
export { POST as benefits } from './src/pages/api/cart-benefits.ts';export { makeCustomerSession } from './src/lib/auth-session.ts';export { makePaymentAccessToken } from './src/lib/payment-access.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', outfile: file, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
const api = await import(pathToFileURL(file).href);
after(async () => { await rm(temp, { recursive: true, force: true }); });
let paymentId = 2000;
function owner(id: number) {
  const value = api.makeCustomerSession({ id, email: 'fixture@example.invalid' });
  return { get(name: string) { return name === 'tm_customer_session' ? { value } : undefined; } };
}
async function fixture(state = 'CANCELED') {
  const id = String(++paymentId), no = String(301000 + paymentId);
  const source = { orderNumber: no, paymentId: id, paymentState: 'CREATED', amountCents: 2390, currency: 'EUR', cart: [{ ...a, qty: 2 }],
    contact: { email: 'fixture@example.invalid', phone: '+421900000000' }, billing: { firstName: 'Test', lastName: 'Customer', address: 'Test 1', city: 'Test', zip: '97401' }, delivery: {},
    shippingCode: 'dpd_pickup', shippingLabel: 'DPD Pickup', shippingPrice: 2.9, paymentCode: 'gopay', paymentLabel: 'GoPay', paymentPrice: 0,
    subtotal: 20, originalSubtotal: 20, quantityDiscount: 0, total: 22.9, loyaltyDiscount: 0, createdAt: new Date().toISOString(), customerId: 7, paymentAccessRequired: true };
  source.amountCents = 2290;
  await api.savePendingGoPayOrder(source); await api.enqueueAsyncWooOrder(source);
  const reads: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); reads.push(url.pathname);
    assert.equal(url.hostname, 'gw.sandbox.gopay.com', 'No real gateway, Woo writes or email may be contacted');
    if (url.pathname.endsWith('/oauth2/token')) return Response.json({ access_token: 'fixture', expires_in: 3600 });
    assert.equal(init?.method || 'GET', 'GET', 'A status/change must not create a new gateway payment');
    return Response.json({ id: Number(id), order_number: no, amount: 2290, currency: 'EUR', target: { goid: 999999 }, state });
  };
  return { id, no, source, reads, status: (cookies = owner(7), token = '') => api.status({ cookies, url: new URL('https://example.invalid/api/gopay-status?id=' + id + '&access=' + token) }),
    change: (payment = 'cod', cookies = owner(7), access = '') => api.change({ cookies, request: new Request('https://example.invalid/api/gopay-change-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId: id, payment, access }) }) }) };
}

test('the signed-in owner can read the saved order without the old gateway cookie; other accounts see nothing', async () => {
  const f = await fixture(); const bad = await f.status(owner(8)); assert.equal(bad.status, 403); assert.equal(f.reads.length, 0);
  const response = await f.status(); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.preview.cart[0].sku, a.sku); assert.equal(data.preview.billing.address, 'Test 1'); assert.equal(data.pending.orderNumber, f.no);
});

test('a signed link works independently of the cart, and a foreign session cannot change payment', async () => {
  const f = await fixture(); const noCookies = { get() { return undefined; } };
  assert.equal((await f.status(noCookies)).status, 403);
  assert.equal((await f.status(noCookies, api.makePaymentAccessToken(f.no))).status, 200);
  assert.equal((await f.change('cod', owner(8))).status, 403);
});

test('changing payment uses the original saved items and number, recalculates COD once and is replay safe', async () => {
  const f = await fixture(); const first = await f.change(); assert.equal(first.status, 200);
  const result = await first.json(); assert.equal(result.orderNumber, f.no); assert.equal(result.preview.total, 24.1);
  assert.equal(result.preview.cart[0].sku, a.sku); assert.equal(result.preview.shipping.method, 'dpd_pickup');
  const repeat = await f.change(); assert.equal(repeat.status, 200); assert.equal((await repeat.json()).preview.total, 24.1);
  assert.equal((await f.change('bank_prepaid')).status, 409);
});

test('a late paid status or missing company details prevent a payment change without touching the saved order', async () => {
  const f = await fixture('PAID'); assert.equal((await f.change()).status, 409);
  assert.equal((await api.readPendingGoPayOrder(f.id)).paymentCode, 'gopay');
  assert.equal((await f.change('invoice_org')).status, 400);
});


test('one lightweight benefits response reads customer/orders once and excludes account-history scans', async () => {
  const urls: URL[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));urls.push(url);assert.equal(init?.method, 'GET');assert.equal(url.hostname, 'woo.example.invalid');
    if(url.pathname.endsWith('/customers/777')) return Response.json({ id:777,email:'fixture@example.invalid',meta_data:[
      {key:'tm_loyalty_points',value:'50'},{key:'tm_loyalty_lifetime_points',value:'50'},
      {key:'tm_loyalty_history',value:JSON.stringify([{title:'Objednávka #999',orderId:999,points:50}])},
      {key:'tm_welcome_discount_expires',value:'2099-01-01T00:00:00Z'},
    ]});
    assert.equal(url.pathname,'/wp-json/wc/v3/orders');assert.equal(url.searchParams.get('customer'),'777');assert.equal(url.searchParams.has('include'),false);return Response.json([]);
  };
  const response = await api.benefits({cookies:owner(777),request:new Request('https://example.invalid/api/cart-benefits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cart:[a]})})});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.customerId,777);assert.equal(data.loyalty.discountValue,0.5);assert.equal(data.coupon.percent,5);
  assert.equal(urls.length,2);assert.doesNotMatch(JSON.stringify(data),/history|creditedOrders|fixture@example/);
});

test('add-to-cart drawer shows the price immediately during slow and failed benefits checks', async () => {
  const source = await readFile('src/scripts/cart.js', 'utf8');
  const render = source.slice(source.indexOf('  function renderAddCartSummary('), source.indexOf('  function showAddCartDrawer('));
  let html = '';
  const scope = {
    benefitStatus: 'pending', tmCoupon: null, readDrawerBenefits: () => null,
    readCart: () => [a], ensureCartBenefits() {}, cartCount: () => 2,
    cartPricing() {}, couponDiscountForTotal() {}, loyaltyDiscountForTotal() {},
    cartGoodsTotals: () => ({ subtotal: 20, total: 18, missingForFreeShipping: 11 }),
    discountRows: () => [['Množstevná zľava', 2]],
    formatMoney: (value: number) => value.toFixed(2) + ' €',
    setMarkup: (_node: unknown, markup: string) => { html = markup; },
  };
  const draw = runInNewContext(render + ';renderAddCartSummary', scope);
  for (const status of ['pending', 'error']) {
    scope.benefitStatus = status;
    draw({ querySelector: () => ({}) });
    assert.match(html, /Pred osobnými zľavami<\/span><strong>18.00 € s DPH/);
    assert.match(html, /Doprava zdarma od 29 € po zľavách/);
    assert.doesNotMatch(html, /role="status"|Skúsiť znova|is-free/);
  }
  scope.benefitStatus = 'ready';
  draw({ querySelector: () => ({}) });
  assert.match(html, /Spolu za tovar/);
  assert.match(html, /Do dopravy zdarma chýba 11.00 €/);
});


test('drawer estimates use recent account data and never expose another account’s benefits', () => {
  identity();
  const current = JSON.parse(session.getItem('tm_header_account_v1')!);
  const expiresAt = Date.now() + 60_000;
  current.cartPreview = { expiresAt, discountValue: 0.5, welcome: { percent: 5, expiresAt } };
  session.setItem('tm_header_account_v1', JSON.stringify(current));
  assert.equal(readDrawerBenefits()?.coupon?.percent, 5);
  assert.equal(readCartBenefits([a]), null);
  setCouponDisabled(true);
  assert.equal(readDrawerBenefits()?.coupon, null);
  invalidateCartBenefits();
  assert.equal(readDrawerBenefits(), null);
  identity(8);
  assert.equal(readDrawerBenefits(), null);
});
