import type { APIRoute } from "astro";
import { readPendingGoPayOrder, savePendingGoPayOrder } from "../../lib/checkout-order";
import { getEnv, getGoPayAccessToken, getGoPayHost } from "../../lib/gopay-client";
import { makePaymentAccessToken, paymentReturnUrl, verifyPaymentAccessToken } from "../../lib/payment-access";

export const prerender = false;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const oldPaymentId = clean(body?.paymentId || body?.id);
    if (!oldPaymentId) {
      return new Response(JSON.stringify({ ok: false, error: "Chýba ID pôvodnej GoPay platby." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const pending = await readPendingGoPayOrder(oldPaymentId);
    if (!pending) {
      return new Response(JSON.stringify({ ok: false, error: "Pôvodnú objednávku sa nepodarilo nájsť." }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const access = body?.access || cookies.get('tm_gopay_access')?.value;
    if ((pending as any).paymentAccessRequired && !verifyPaymentAccessToken(access, pending.orderNumber)) {
      return new Response(JSON.stringify({ ok: false, error: 'Odkaz na opakovanie platby nie je platný alebo expiroval.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const goid = getEnv("GOPAY_GOID");
    const returnUrl = getEnv("GOPAY_RETURN_URL");
    const notifyUrl = getEnv("GOPAY_NOTIFY_URL");
    if (!goid || !returnUrl || !notifyUrl) throw new Error("Chýba konfigurácia GoPay.");

    const amountCents = Math.max(1, Math.round(Number(pending.amountCents || Number(pending.total || 0) * 100)));
    const contact = pending.contact || {};
    const billing = pending.billing || {};
    const token = await getGoPayAccessToken("payment-create");
    const accessToken = makePaymentAccessToken(pending.orderNumber);
    const paymentBody = {
      payer: {
        default_payment_instrument: "PAYMENT_CARD",
        allowed_payment_instruments: ["PAYMENT_CARD"],
        contact: {
          first_name: clean(billing.firstName),
          last_name: clean(billing.lastName),
          email: clean(contact.email),
          phone_number: clean(contact.phone),
          city: clean(billing.city),
          street: clean(billing.address),
          postal_code: clean(billing.zip),
          country_code: "SVK",
        },
      },
      target: { type: "ACCOUNT", goid: Number(goid) },
      amount: amountCents,
      currency: clean(pending.currency || "EUR") || "EUR",
      order_number: clean(pending.orderNumber),
      order_description: `Opakovaná platba objednávky ${clean(pending.orderNumber)} - ToneryMaxim.sk`,
      items: [{
        name: `Objednávka ${clean(pending.orderNumber)}`,
        amount: amountCents,
        count: 1,
        vat_rate: 23,
      }],
      callback: { return_url: paymentReturnUrl(returnUrl, accessToken), notification_url: notifyUrl },
      lang: "SK",
    };

    const response = await fetch(`${getGoPayHost()}/api/payments/payment`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentBody),
    });
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    if (!response.ok || !data?.id || !data?.gw_url) {
      const message = data?.errors?.[0]?.message || data?.message || data?.raw || "Novú GoPay platbu sa nepodarilo vytvoriť.";
      throw new Error(String(message));
    }

    await savePendingGoPayOrder({
      ...pending,
      paymentId: String(data.id),
      paymentState: "CREATED",
      amountCents,
      retryOfPaymentId: oldPaymentId,
      retriedAt: new Date().toISOString(),
      paymentAccessRequired: true,
    } as any);
    cookies.set('tm_gopay_access', accessToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
      maxAge: 24 * 60 * 60,
    });

    return new Response(JSON.stringify({
      ok: true,
      paymentId: String(data.id),
      orderNumber: pending.orderNumber,
      gwUrl: String(data.gw_url),
      accessToken,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("GoPay retry error:", error?.message || error);
    return new Response(JSON.stringify({ ok: false, error: error?.message || "Platbu sa nepodarilo zopakovať." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
