import type { APIRoute } from "astro";
import { readCustomerSession } from "../../lib/auth-session";
import { createWooOrderFromCheckout } from "../../lib/checkout-order";
import { enqueueAsyncWooOrder, scheduleAsyncOrderQueue } from "../../lib/async-order-queue";
import { getCustomerLoyalty } from "../../lib/loyalty";
import { validateCheckoutCoupon } from "../../lib/coupons";
import { normalizeSecureCheckoutCart, discountedLine } from "../../lib/secure-checkout-cart";
import { CheckoutProfiler } from "../../lib/checkout-profiler";
import { nextTmOrderNumber } from "../../lib/order-number";
import { getOrCreateOrderNumber } from "../../lib/order-idempotency";
import { validateCheckoutRequest } from "../../lib/checkout-validation";

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
  const profiler = new CheckoutProfiler("order-create");
  try {
    const session = readCustomerSession(cookies);
    profiler.mark("session");
    const body = await profiler.measure("request.json", () => request.json().catch(() => ({})));
    const checkout = validateCheckoutRequest(body, new Set(Object.keys(PAYMENT)));
    const needsLoyalty = Boolean(session?.id) && (body?.loyalty?.apply || (Array.isArray(body.cart) && body.cart.some((item: any) => item?.loyalty_reward === true)));
    const loyalty = needsLoyalty
      ? await profiler.measure("loyalty-load", () => getCustomerLoyalty(session!.id))
      : null;
    const cart = await profiler.measure("normalize-cart", () => normalizeSecureCheckoutCart(body.cart, { customerId: session?.id, loyalty }));

    if (cart.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "Košík je prázdny." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const { shippingCode, paymentCode } = checkout;
    const shipping = SHIPPING[shippingCode];
    const payment = PAYMENT[paymentCode];
    const originalSubtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1), 0);
    const subtotal = cart.reduce((sum, item) => sum + discountedLine(item).final, 0);
    const quantityDiscount = Math.max(0, Math.round((originalSubtotal - subtotal) * 100) / 100);
    const paymentPrice = payment.price;
    let coupon = null as Awaited<ReturnType<typeof validateCheckoutCoupon>> | null;
    let couponDiscount = 0;
    const couponCode = String(body?.coupon?.code || body?.coupon || "").trim();
    if (couponCode) {
      coupon = await profiler.measure("coupon-validate", () => validateCheckoutCoupon(session?.id, couponCode, cart));
      if (!coupon.ok) {
        return new Response(JSON.stringify({ ok: false, error: coupon.reason || "Kupón nie je platný." }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      couponDiscount = Math.min(Number(coupon.discount || 0), Math.max(0, subtotal));
      coupon.discount = Math.round(couponDiscount * 100) / 100;
    }
    let loyaltyDiscount = 0;
    if (session?.id && body?.loyalty?.apply) {
      const currentLoyalty = loyalty || await profiler.measure("loyalty-load", () => getCustomerLoyalty(session.id));
      const requested = Math.max(0, Math.round(Number(body?.loyalty?.discount || 0) * 10) / 10);
      loyaltyDiscount = Math.min(requested, currentLoyalty.discountValue, Math.max(0, Math.round((subtotal - couponDiscount) * 100) / 100));
    }
    const goodsAfterDiscounts = Math.max(0, Math.round((subtotal - couponDiscount - loyaltyDiscount) * 100) / 100);
    const shippingPrice = goodsAfterDiscounts >= 29 ? 0 : shipping.price;
    const total = Math.max(0, Math.round((subtotal + shippingPrice + paymentPrice - couponDiscount - loyaltyDiscount) * 100) / 100);
    const requestId = String(body?.requestId || request.headers.get("x-tm-idempotency-key") || "").trim();
    const orderNumber = requestId
      ? await getOrCreateOrderNumber(`order-${requestId}`, nextTmOrderNumber)
      : await nextTmOrderNumber();

    const orderSource = {
      orderNumber,
      currency: "EUR",
      cart,
      billing: checkout.billing,
      delivery: checkout.delivery,
      contact: checkout.contact,
      orderNote: checkout.orderNote,
      shippingCode,
      shippingLabel: shipping.label,
      shippingPrice,
      paymentCode,
      paymentLabel: payment.label,
      paymentPrice,
      coupon,
      loyaltyDiscount,
      loyaltyPointsUsed: loyaltyDiscount * 100,
      loyaltyPaperPacks: cart.filter((item) => item.loyalty_reward).reduce((sum, item) => sum + Number(item.qty || 0), 0),
      originalSubtotal: Math.round(originalSubtotal * 100) / 100,
      quantityDiscount,
      subtotal: Math.round(subtotal * 100) / 100,
      total,
      amountCents: Math.round(total * 100),
      createdAt: new Date().toISOString(),
      termsAcceptedAt: checkout.termsAcceptedAt,
      heurekaConsent: checkout.heurekaConsent,
      heurekaConsentAt: checkout.heurekaConsentAt,
      customerId: session?.id || undefined,
    };

    const asyncEnabled = process.env.TM_FORCE_SYNC_WOO_ORDERS !== "1";

    if (asyncEnabled) {
      const queued = await profiler.measure("async-order-enqueue", () => enqueueAsyncWooOrder(orderSource));
      profiler.done({ queued: true, queueId: queued.queueId, orderNumber: queued.orderNumber, cartItems: cart.length, paymentCode });
      scheduleAsyncOrderQueue(Math.max(0, Number(process.env.TM_ASYNC_WOO_INITIAL_DELAY_MS || 500)));

      return new Response(JSON.stringify({
        ok: true,
        queued: true,
        orderId: queued.queueId,
        orderNumber: queued.orderNumber,
        message: "Objednávka bola prijatá a spracuje sa na pozadí.",
      }), {
        status: 202,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const result = await profiler.measure("woo-create-order-total", () => createWooOrderFromCheckout(orderSource));

    profiler.done({ orderId: result.orderId, orderNumber: result.orderNumber, cartItems: cart.length, paymentCode });

    return new Response(JSON.stringify({
      ok: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    profiler.fail(error);
    const status = Number(error?.status || 500);
    console.error("Order create error:", error?.message || error);
    return new Response(JSON.stringify({
      ok: false,
      error: status < 500 ? error?.message : "Nepodarilo sa vytvoriť objednávku. Skúste to znova alebo nás kontaktujte.",
      validationErrors: status === 400 ? error?.validationErrors || undefined : undefined,
    }), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
