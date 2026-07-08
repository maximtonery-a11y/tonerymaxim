import type { APIRoute } from "astro";
import { readCustomerSession } from "../../lib/auth-session";
import { savePendingGoPayOrder } from "../../lib/gopay-order";
import { getCustomerLoyalty } from "../../lib/loyalty";
import { validateCheckoutCoupon } from "../../lib/coupons";
import { normalizeSecureCheckoutCart, discountRate, discountedLine } from "../../lib/secure-checkout-cart";

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

function getGoPayHost() {
  return import.meta.env.GOPAY_ENV === "production"
    ? "https://gate.gopay.cz"
    : "https://gw.sandbox.gopay.com";
}

function env(name: string) {
  return String(import.meta.env[name] || process.env[name] || "").trim();
}

function basicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

function maskValue(value: string) {
  if (!value) return "EMPTY";
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}***${value.slice(-2)} (length ${value.length})`;
}

async function getAccessToken(scope: "payment-create" | "payment-all") {
  const clientId = env("GOPAY_CLIENT_ID");
  const clientSecret = env("GOPAY_CLIENT_SECRET");
  const goid = env("GOPAY_GOID");
  const tokenUrl = `${getGoPayHost()}/api/oauth2/token`;

  console.log("GoPay ENV kontrola:", {
    env: env("GOPAY_ENV") || "sandbox/default",
    goid,
    clientId,
    clientSecretMasked: maskValue(clientSecret),
    tokenUrl,
    scope,
  });

  if (!clientId || !clientSecret) {
    throw new Error("Chýba GOPAY_CLIENT_ID alebo GOPAY_CLIENT_SECRET v .env.");
  }

  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope,
    }),
  });

  const tokenText = await tokenResponse.text();

  let tokenData: any = {};
  try {
    tokenData = tokenText ? JSON.parse(tokenText) : {};
  } catch {
    tokenData = { raw: tokenText };
  }

  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error("GoPay OAuth chyba:", {
      tokenUrl,
      status: tokenResponse.status,
      response: tokenData,
    });

    const message =
      tokenData?.errors?.[0]?.message ||
      tokenData?.error_description ||
      tokenData?.error ||
      tokenData?.raw ||
      `GoPay OAuth chyba ${tokenResponse.status}`;

    throw new Error(String(message));
  }

  console.log("GoPay OAuth OK:", {
    tokenType: tokenData.token_type,
    expiresIn: tokenData.expires_in,
    scope: tokenData.scope,
  });

  return String(tokenData.access_token);
}

export const POST: APIRoute = async ({ request, cookies }) => {
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
    const body = await request.json().catch(() => ({}));
    const cart = await normalizeSecureCheckoutCart(body.cart);

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
    const token = await getAccessToken("payment-create");
    const orderNumber = `TM-${Date.now()}`;

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

    const paymentResponse = await fetch(paymentUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentBody),
    });

    const paymentText = await paymentResponse.text();

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

    await savePendingGoPayOrder({
      orderNumber,
      paymentId: String(paymentData.id),
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
    });

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
