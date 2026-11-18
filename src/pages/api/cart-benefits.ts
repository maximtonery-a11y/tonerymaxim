import type { APIRoute } from 'astro';
import { readCustomerSession } from '../../lib/auth-session';
import { getCustomerLoyalty } from '../../lib/loyalty';
import { getBestAutoCoupon, validateCheckoutCoupon } from '../../lib/coupons';
import type { NormalizedCartItem } from '../../lib/checkout-order';

export const prerender = false;
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = readCustomerSession(cookies), body = await request.json();
    if (!Array.isArray(body.cart) || body.cart.length > 30) return Response.json({ ok: false }, { status: 400 });
    // This is a display estimate, just like coupon-active. Checkout always
    // re-reads actual Woo product prices, coupon eligibility and available points.
    const cart: NormalizedCartItem[] = body.cart.map((item: any) => ({
      id: String(item.id || item.sku || ''), sku: String(item.sku || ''), name: String(item.name || '').slice(0, 160),
      qty: Math.min(99, Math.max(1, Math.floor(Number(item.qty || item.quantity || 1)) || 1)),
      price: Math.max(0, Math.round(Number(item.price || 0) * 100) / 100) || 0,
      source: String(item.source || ''), product_type_key: String(item.product_type_key || item.productTypeKey || ''),
      product_type_label: String(item.product_type_label || item.productTypeLabel || ''),
    }));
    const loyalty = session?.id ? await getCustomerLoyalty(session.id) : null;
    let coupon = null as Awaited<ReturnType<typeof validateCheckoutCoupon>> | null;
    const manual = body.enteredCode ?? (body.savedCoupon?.manual ? body.savedCoupon.code : undefined);
    if (body.couponDisabled !== true) {
      if (manual !== undefined && String(manual).trim()) {
        coupon = { ...await validateCheckoutCoupon(session?.id, manual, cart), manual: true } as any;
      }
      if (manual === undefined || (body.enteredCode === undefined && coupon && !coupon.ok)) {
        const automatic = await getBestAutoCoupon(session?.id, cart);
        if (automatic) coupon = automatic;
        // An obsolete automatically chosen code must never be restored from storage.
      }
    }
    return Response.json({ ok: true, customerId: session?.id || 0,
      loyalty: { ok: Boolean(session?.id), points: loyalty?.points || 0, discountValue: loyalty?.discountValue || 0, paperReward: loyalty?.paperReward || null },
      coupon,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[TM cart benefits]', error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: 'Osobné zľavy sa nepodarilo overiť.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
