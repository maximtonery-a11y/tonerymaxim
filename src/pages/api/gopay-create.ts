import type { APIRoute } from "astro";
import { readCustomerSession } from "../../lib/auth-session";
import { savePendingGoPayOrder } from "../../lib/gopay-order";
import { enqueueAsyncWooOrder, scheduleAsyncOrderQueue } from "../../lib/async-order-queue";
import { getCustomerLoyalty } from "../../lib/loyalty";
import { validateCheckoutCoupon } from "../../lib/coupons";
import { normalizeSecureCheckoutCart, discountRate, discountedLine } from "../../lib/secure-checkout-cart";
import { CheckoutProfiler } from "../../lib/checkout-profiler";
import { nextTmOrderNumber } from "../../lib/order-number";
import { getEnv as env, getGoPayAccessToken, getGoPayHost } from "../../lib/gopay-client";

export const prerender = false;

const SHIPPING: Record<string, { label: string; price: number }> = {
  dpd_courier: { label: "DPD kuriér na adresu", price: 3.9 },
  dpd_pickup: { label: "DPD Pickup", price: 2.9 },
  dpd_box: { label: "DPD Pickup Box", price: 2.9 },
  gls_courier: { label: "GLS kuriér na adresu", price: 3.9 },
  gls_pickup: { label: "GLS ParcelShop / Balíkomat", price: 2.9 },
  courier: { label: "Kuriér na adresu", price: 3.9 },
  pickup: { label: "Odberné miesto", price: 2.9 },
  box: { label: "Balíkomat", price: 2.9 },
};

const PAYMENT: Record<string, { label: string; price: number; gopayInstrument?: string }> = {
  gopay: { label: "Platba online GoPay", price: 0, gopayInstrument: "PAYMENT_CARD" },
  applepay: { label: "Apple Pay", price: 0, gopayInstrument: "APPLE_PAY" },
  googlepay: { label: "Google Pay", price: 0, gopayInstrument: "GOOGLE_PAY" },
};

const VAT_RATE_PERCENT = 23;

function toCents(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const profiler = new CheckoutProfiler("gopay-create");
  try {
    const goid = env("GOPAY_GOID");
    const returnUrl = env("GOPAY_RETURN_URL");
    const notifyUrl = env("GOPAY_NOTIFY_URL");

    if (!goid || !returnUrl || !notifyUrl) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Chýba GOPAY_GOID, GOPAY_RETURN_URL alebo GOPAY_NOTIFY_URL v .env.",
      }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const session = readCustomerSession(cookies);
    profiler.mark("session");
    const body = await profiler.measure("request.json", () => request.json().catch(() => ({})));
    const cart = await profiler.measure("normalize-cart", () => normalizeSecureCheckoutCart(body.cart));

    if (cart.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Košík je prázdny.",
      }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const shippingCode = String(
      typeof body.shipping === "string"
        ? body.shipping
        : body.shipping?.method || "courier"
    );
    const paymentCode = String(
      typeof body.payment === "string"
        ? body.payment
        : body.payment?.method || "gopay"
    );

    if (!PAYMENT[paymentCode]) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Táto platobná metóda sa neposiela do GoPay.",
      }), {
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
      coupon = await profiler.measure("coupon-validate", () => validateCheckoutCoupon(session?.id, couponCode, cart));
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
      const loyalty = await profiler.measure("loyalty-load", () => getCustomerLoyalty(session.id));
      const requested = Math.max(0, Math.round(Number(body?.loyalty?.discount || 0) * 10) / 10);
      loyaltyDiscount = Math.min(requested, loyalty.discountValue, Math.max(0, Math.round((subtotal + shippingPrice + paymentPrice - couponDiscount) * 100) / 100));
    }

    const items = [
      ...cart.map((item) => {
        const line = discountedLine(item);
        const rate = discountRate(item);
        return {
          name: rate > 0 ? `${item.qty}× ${item.name} - množstevná zľava ${Math.round(rate * 100)} %` : (item.qty > 1 ? `${item.qty}× ${item.name}` : item.name),
          amount: toCents(line.final),
          count: 1,
          vat_rate: 23,
        };
      }),
      {
        name: shipping.label,
        amount: toCents(shippingPrice),
        count: 1,
        vat_rate: 23,
      },
    ];

    if (couponDiscount > 0) {
      items.push({
        type: "DISCOUNT",
        name: coupon?.label || "Kupónová zľava",
        amount: -toCents(couponDiscount),
        count: 1,
        vat_rate: VAT_RATE_PERCENT,
      });
    }

    if (loyaltyDiscount > 0) {
      items.push({
        name: "Vernostná zľava",
        amount: -toCents(loyaltyDiscount),
        count: 1,
        vat_rate: 23,
      });
    }

    if (paymentPrice > 0) {
      items.push({
        name: payment.label,
        amount: toCents(paymentPrice),
        count: 1,
        vat_rate: 23,
      });
    }

    const totalCents = items.reduce((sum, item) => sum + item.amount, 0);
    const token = await profiler.measure("gopay-oauth-token", () => getGoPayAccessToken("payment-create"));
    const orderNumber = await nextTmOrderNumber();

    const paymentBody = {
      payer: {
        default_payment_instrument: payment.gopayInstrument || "PAYMENT_CARD",
        allowed_payment_instruments: [payment.gopayInstrument || "PAYMENT_CARD"],
        contact: {
          first_name: String(body?.billing?.firstName || ""),
          last_name: String(body?.billing?.lastName || ""),
          email: String(body?.contact?.email || ""),
          phone_number: String(body?.contact?.phone || ""),
          city: String(body?.billing?.city || ""),
          street: String(body?.billing?.address || ""),
          postal_code: String(body?.billing?.zip || ""),
          country_code: "SVK",
        },
      },
      target: {
        type: "ACCOUNT",
        goid: Number(goid),
      },
      amount: totalCents,
      currency: "EUR",
      order_number: orderNumber,
      order_description: `Objednávka ${orderNumber} - ToneryMaxim.sk`,
      items,
      callback: {
        return_url: returnUrl,
        notification_url: notifyUrl,
      },
      lang: "SK",
    };

    const paymentUrl = `${getGoPayHost()}/api/payments/payment`;

    const paymentResponse = await profiler.measure("gopay-payment-create", () => fetch(paymentUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentBody),
    }));

    const paymentText = await profiler.measure("gopay-payment-read-response", () => paymentResponse.text());

    let paymentData: any = {};
    try {
      paymentData = paymentText ? JSON.parse(paymentText) : {};
    } catch {
      paymentData = { raw: paymentText };
    }

    if (!paymentResponse.ok || !paymentData.gw_url) {
      console.error("GoPay vytvorenie platby chyba:", {
        paymentUrl,
        status: paymentResponse.status,
        request: paymentBody,
        response: paymentData,
      });

      const message =
        paymentData?.errors?.[0]?.message ||
        paymentData?.message ||
        paymentData?.raw ||
        `GoPay platba nebola vytvorená. Status ${paymentResponse.status}`;

      return new Response(JSON.stringify({
        ok: false,
        error: String(message),
        gopay: paymentData,
      }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const pendingSource = {
      orderNumber,
      paymentId: String(paymentData.id),
      paymentState: "CREATED",
      amountCents: totalCents,
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
      total: Math.round((totalCents / 100) * 100) / 100,
      createdAt: new Date().toISOString(),
      customerId: session?.id || undefined,
    };

    await profiler.measure("save-pending-gopay-order", () => savePendingGoPayOrder(pendingSource));

    // GoPay objednávku zapisujeme do Woo hneď po vytvorení platby aj vtedy,
    // keď zákazník platbu následne zruší alebo sa ju nepodarí dokončiť.
    // Samotné vytvorenie Woo objednávky beží na pozadí, aby sa nezdržiavalo presmerovanie na GoPay.
    await profiler.measure("async-gopay-order-enqueue", () => enqueueAsyncWooOrder(pendingSource));
    scheduleAsyncOrderQueue(Math.max(0, Number(process.env.TM_ASYNC_WOO_INITIAL_DELAY_MS || 500)));

    profiler.done({ paymentId: paymentData.id, orderNumber, cartItems: cart.length, paymentCode });

    return new Response(JSON.stringify({
      ok: true,
      paymentId: paymentData.id,
      orderNumber,
      gwUrl: paymentData.gw_url,
      amount: totalCents,
      currency: "EUR",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    profiler.fail(error);
    console.error("GoPay create fatal error:", error?.message || error);

    return new Response(JSON.stringify({
      ok: false,
      error: error?.message || "Nepodarilo sa vytvoriť GoPay platbu.",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
