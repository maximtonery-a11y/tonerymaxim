import { isPaperRewardCartItem } from './paper-reward-cart.js';

const CACHE = 'tm_cart_benefits_v1';
const EPOCH = 'tm_cart_benefits_epoch';
const COUPON_DISABLED = 'tm_coupon_disabled_v1';
const pending = new Map();
let newestKey;
const json = (storage, key) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
const epoch = () => { try { return localStorage.getItem(EPOCH) || ''; } catch { return ''; } };
export const couponDisabled = () => localStorage.getItem(COUPON_DISABLED) === '1';
export function setCouponDisabled(disabled) {
  if (disabled) localStorage.setItem(COUPON_DISABLED, '1');
  else localStorage.removeItem(COUPON_DISABLED);
  localStorage.removeItem('tm_coupon_v1');
  invalidateCartBenefits(false, true);
  window.dispatchEvent(new CustomEvent('tm:coupon-choice'));
}
export function benefitsKey(cart, enteredCode) {
  const saved = json(localStorage, 'tm_coupon_v1');
  const manual = enteredCode !== undefined ? String(enteredCode).trim() : saved?.manual ? saved.code : null;
  return JSON.stringify([epoch(), couponDisabled(), manual, cart.filter(item => !isPaperRewardCartItem(item)).map(item =>
    [item.sku, Number(item.price), Number(item.qty || item.quantity || 1), item.product_type_key || item.productTypeKey || '', item.product_type_label || item.productTypeLabel || '', item.name, item.source || ''])]);
}
export function readCartBenefits(cart, enteredCode) {
  const saved = json(sessionStorage, CACHE);
  if (!saved || saved.until <= Date.now() || saved.key !== benefitsKey(cart, enteredCode)) return null;
  const identity = json(sessionStorage, 'tm_header_account_v1');
  if (!identity || identity.expiresAt <= Date.now() || Number(identity.customer?.id || 0) !== Number(saved.data.customerId || 0)) return null;
  return saved.data;
}
export function readDrawerBenefits() {
  const identity = json(sessionStorage, 'tm_header_account_v1');
  if (!identity?.customer?.id || identity.expiresAt <= Date.now()) return null;

  const verified = json(sessionStorage, CACHE);
  const data = verified?.until > Date.now() && verified.data?.customerId === identity.customer.id ? verified.data : null;
  const preview = identity.cartPreview?.expiresAt > Date.now() ? identity.cartPreview : null;
  const discountValue = data?.loyalty?.discountValue ?? preview?.discountValue ?? 0;
  const saved = json(localStorage, 'tm_coupon_v1');
  const coupon = data?.coupon;
  const verifiedCoupon = coupon?.ok && coupon.percent > 0
    && (!coupon.expiresAt || Date.parse(coupon.expiresAt) > Date.now())
    && (!saved?.manual || saved.code === coupon.code) ? coupon : null;
  const welcome = !saved?.manual && preview?.welcome?.expiresAt > Date.now() ? preview.welcome : null;
  const estimatedCoupon = couponDisabled() ? null : verifiedCoupon || welcome;
  return estimatedCoupon || discountValue > 0 ? { discountValue, coupon: estimatedCoupon } : null;
}

export function invalidateCartBenefits(identityChanged = false, preservePreview = false) {
  if (!preservePreview || identityChanged) {
    try {
      const identity = json(sessionStorage, 'tm_header_account_v1');
      if (identity?.cartPreview) {
        delete identity.cartPreview;
        sessionStorage.setItem('tm_header_account_v1', JSON.stringify(identity));
      }
    } catch {}
  }
  try { sessionStorage.removeItem(CACHE); } catch {}
  try {
    localStorage.setItem(EPOCH, Date.now() + '-' + Math.random());
    if (identityChanged) { localStorage.removeItem('tm_coupon_v1'); localStorage.removeItem(COUPON_DISABLED); }
  } catch {}
}
/** @param {any[]} cart @param {{enteredCode?: string, force?: boolean}} [options] */
export async function getCartBenefits(cart, { enteredCode, force = false } = {}) {
  const key = benefitsKey(cart, enteredCode), startedEpoch = epoch();
  newestKey = key;
  const cached = !force && enteredCode === undefined ? readCartBenefits(cart) : null;
  if (cached) return cached;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const response = await fetch('/api/cart-benefits', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart, enteredCode, couponDisabled: couponDisabled(), savedCoupon: json(localStorage, 'tm_coupon_v1') }),
      signal: globalThis.AbortSignal?.timeout?.(8000),
    });
    const data = await response.json();
    if (!response.ok || data?.ok !== true || typeof data.loyalty?.ok !== 'boolean') throw new Error('Osobné zľavy sa nepodarilo overiť.');
    if (epoch() !== startedEpoch) throw new Error('Účet alebo objednávka sa medzičasom zmenili.');
    // Only numeric benefits and a coupon are cached; personal addresses and
    // authentication tokens never enter this display cache.
    try { if (newestKey === key) sessionStorage.setItem(CACHE, JSON.stringify({ key, until: Date.now() + 60_000, data })); } catch {}
    return data;
  })();
  if (pending.size >= 8) pending.clear();
  pending.set(key, task);
  try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
}
