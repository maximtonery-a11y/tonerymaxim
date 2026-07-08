import type { APIRoute } from "astro";
import { readCustomerSession } from "../../lib/auth-session";
import { createWooOrderFromCheckout } from "../../lib/gopay-order";
import { getCustomerLoyalty } from "../../lib/loyalty";
import { validateCheckoutCoupon } from "../../lib/coupons";
import { normalizeSecureCheckoutCart, discountedLine } from "../../lib/secure-checkout-cart";

const SHIPPING: Record<string, { label: string; price: number }> = {
  dpd_courier: { label: "DPD kuriér na adresu", price: 3.9 },
  dpd_pickup: { label: "DPD Pickup", price: 2.9 },
  dpd_box: { label: "DPD Pickup Box", price: 2.9 },
  gls_courier: { label: "GLS kuriér na adresu", price: 3.9 },
  gls_pickup: { label: "GLS ParcelShop / Balíkomat", price: 2.9 },
};

const PAYMENT: Record<string, { label: string; price: number }> = {
  cod: { label: "Dobierka", price: 1.2 },
  bank_prepaid: { label: "Platba prevodným príkazom vopred", price: 0 },
  invoice_org: { label: "Prevodný príkaz pre organizácie a firmy", price: 0 },
};

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = readCustomerSession(cookies);
    const body = await request.json().catch(() => ({}));
    const cart = await normalizeSecureCheckoutCart(body.cart);

    if (cart.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "Košík je prázdny." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const shippingCode = String(typeof body.shipping === "string" ? body.shipping : body.shipping?.method || "dpd_courier");
    const paymentCode = String(typeof body.payment === "string" ? body.payment : body.payment?.method || "cod");

    if (!PAYMENT[paymentCode]) {
      return new Response(JSON.stringify({ ok: false, error: "Neplatná platobná metóda pre uloženie objednávky." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const shipping = SHIPPING[shippingCode] || SHIPPING.dpd_courier;
    const payment = PAYMENT[paymentCode];
    const subtotal = cart.reduce((sum, item) => sum + discountedLine(item).final, 0);
    const shippingPrice = subtotal >= 29 ? 0 : shipping.price;
    const paymentPrice = payment.price;
    let coupon = null as Awaited<ReturnType<typeof validateCheckoutCoupon>> | null;
    let couponDiscount = 0;
    const couponCode = String(body?.coupon?.code || body?.coupon || "").trim();
    if (couponCode) {
      coupon = await validateCheckoutCoupon(session?.id, couponCode, cart);
      if (!coupon.ok) {
        return new Response(JSON.stringify({ ok: false, error: coupon.reason || "Kupón nie je platný." }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      couponDiscount = Math.min(Number(coupon.discount || 0), Math.max(0, subtotal + shippingPrice + paymentPrice));
      coupon.discount = Math.round(couponDiscount * 100) / 100;
    }
    let loyaltyDiscount = 0;
    if (session?.id && body?.loyalty?.apply) {
      const loyalty = await getCustomerLoyalty(session.id);
      const requested = Math.max(0, Math.round(Number(body?.loyalty?.discount || 0) * 10) / 10);
      loyaltyDiscount = Math.min(requested, loyalty.discountValue, Math.max(0, Math.round((subtotal + shippingPrice + paymentPrice - couponDiscount) * 100) / 100));
    }
    const total = Math.max(0, Math.round((subtotal + shippingPrice + paymentPrice - couponDiscount - loyaltyDiscount) * 100) / 100);
    const orderNumber = `TM-${Date.now()}`;

    const result = await createWooOrderFromCheckout({
      orderNumber,
      currency: "EUR",
      cart,
      billing: body.billing || {},
      delivery: { ...(body.delivery || {}), pickup: body.shipping?.pickup || body.delivery?.pickup || null },
      contact: body.contact || {},
      shippingCode,
      shippingLabel: shipping.label,
      shippingPrice,
      paymentCode,
      paymentLabel: payment.label,
      paymentPrice,
      coupon,
      loyaltyDiscount,
      loyaltyPointsUsed: loyaltyDiscount * 100,
      subtotal: Math.round(subtotal * 100) / 100,
      total,
      amountCents: Math.round(total * 100),
      createdAt: new Date().toISOString(),
      customerId: session?.id || undefined,
    });

    return new Response(JSON.stringify({
      ok: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("Order create error:", error?.message || error, error?.details || "");
    return new Response(JSON.stringify({
      ok: false,
      error: error?.message || "Nepodarilo sa vytvoriť objednávku vo WooCommerce.",
      details: error?.details || null,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
