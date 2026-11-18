import { invalidateCartBenefits, setCouponDisabled } from './cart-benefits.js';
// An accepted order has its own durable server record. The shopping cart is
// consumed once, before leaving for the gateway, rather than when payment ends.
export const SUBMITTED_ORDER_KEY = 'tm_submitted_gopay_v1';
const CART_KEY = 'tm_cart_v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
// Called only for a deliberate empty/new cart, never to retry an uncertain POST.
export function resetCheckoutAttempt() {
  for (const key of ['tm_checkout_intent_v2', SUBMITTED_ORDER_KEY, 'tm_coupon_v1', 'tm_loyalty_apply',
    'tonerymaxim_cart', 'cart', 'tm_cart']) localStorage.removeItem(key);
  try { sessionStorage.removeItem('tm_checkout_request_id'); } catch {}
  setCouponDisabled(false);
}
export function saveShoppingCart(cart) {
  let previous = [];
  try { previous = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch {}
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  // Background synchronisation of an already empty cart is not a new purchase.
  // In particular, it must not erase the receipt when returning from GoPay.
  if (Boolean(previous?.length) !== Boolean(cart.length)) resetCheckoutAttempt();
}
export function cartSignature(cart) {
  return JSON.stringify((Array.isArray(cart) ? cart : []).map(item => ({
    id: String(item?.id ?? item?.productId ?? item?.product_id ?? ''), sku: String(item?.sku || ''),
    qty: Math.max(1, Number(item?.qty ?? item?.quantity ?? 1) || 1),
    price: Number(item?.price ?? item?.unitPrice ?? 0) || 0, source: String(item?.source || ''),
  })));
}
export function readSubmittedOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(SUBMITTED_ORDER_KEY) || 'null');
    return value?.paymentId && value?.requestId && Number(value.submittedAt) > Date.now() - MAX_AGE ? value : null;
  } catch { return null; }
}
const itemKey = item => JSON.stringify([String(item?.sku || item?.product_id || item?.productId || item?.id || ''), String(item?.source || ''), Boolean(item?.loyalty_reward)]);
export function remainingCart(current, submitted) {
  const quantities = new Map();
  for (const item of submitted) quantities.set(itemKey(item), (quantities.get(itemKey(item)) || 0) + Number(item.qty || item.quantity || 1));
  return current.flatMap(item => {
    const key = itemKey(item), qty = Number(item.qty || item.quantity || 1), used = Math.min(qty, quantities.get(key) || 0);
    quantities.set(key, Math.max(0, (quantities.get(key) || 0) - used));
    return qty > used ? [{ ...item, qty: qty - used }] : [];
  });
}
export function acceptSubmittedOrder(cart, receipt) {
  const previous = readSubmittedOrder();
  if (previous?.requestId === receipt.requestId && previous.cartCommitted) return previous;
  let current = cart;
  try { current = JSON.parse(localStorage.getItem(CART_KEY) || 'null') || cart; } catch {}
  if (!Array.isArray(current)) current = cart;
  const saved = { ...receipt, cartSignature: cartSignature(cart), submittedAt: Date.now(), cartCommitted: false };
  // Keep a recoverable receipt before consuming the cart. An empty array is a
  // tombstone, so old cart aliases cannot resurrect an already accepted order.
  localStorage.setItem(SUBMITTED_ORDER_KEY, JSON.stringify(saved));
  localStorage.setItem(CART_KEY, JSON.stringify(remainingCart(current, cart)));
  for (const alias of ['tonerymaxim_cart', 'cart', 'tm_cart']) localStorage.removeItem(alias);
  saved.cartCommitted = true;
  localStorage.setItem(SUBMITTED_ORDER_KEY, JSON.stringify(saved));
  localStorage.removeItem('tm_checkout_intent_v2');
  localStorage.removeItem('tm_coupon_v1');
  localStorage.removeItem('tm_coupon_disabled_v1');
  try { sessionStorage.removeItem('tm_checkout_request_id'); sessionStorage.removeItem('tm_cart_benefits_v1'); } catch {}
  invalidateCartBenefits();
  window.dispatchEvent(new CustomEvent('tm:order-accepted'));
  return saved;
}
export function consumeLegacySubmittedCart() {
  const receipt = readSubmittedOrder();
  if (!receipt || receipt.cartCommitted) return receipt;
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    if (Array.isArray(cart) && cartSignature(cart) === receipt.cartSignature) return acceptSubmittedOrder(cart, receipt);
  } catch {}
  return receipt;
}
export function submittedOrderUrl(receipt) {
  return '/platba-dokoncena?id=' + encodeURIComponent(receipt.paymentId);
}
