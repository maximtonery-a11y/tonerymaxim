import type { APIRoute } from "astro";
import { readPendingGoPayOrder, savePendingGoPayOrder } from "../../lib/checkout-order";
import { getEnv, getGoPayAccessToken, getGoPayHost, verifyGoPayPaymentAgainstOrder } from "../../lib/gopay-client";
import { makePaymentAccessToken, paymentReturnUrl, verifyPaymentAccessToken } from "../../lib/payment-access";
import { withOrderIdempotency } from "../../lib/order-idempotency";

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

    const storedState = String(pending.paymentState || "").toUpperCase();
    if (storedState === "CONVERTED_TO_OFFLINE" || !["gopay", "applepay", "googlepay"].includes(String(pending.paymentCode || ""))) {
      return new Response(JSON.stringify({ ok: false, error: "Objednávka už používa inú platbu. Nový GoPay pokus nevytvárame." }), {
        status: 409,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const currentPayment = await verifyGoPayPaymentAgainstOrder(oldPaymentId, {
      orderNumber: pending.orderNumber,
      amountCents: Number(pending.amountCents || 0),
      currency: pending.currency,
      requirePaid: false,
    });
    const currentState = String(currentPayment?.state || "UNKNOWN").toUpperCase();
    if (["PAID", "AUTHORIZED"].includes(currentState)) {
      return new Response(JSON.stringify({ ok: false, error: "Platba už bola uhradená. Novú platbu nevytvárame." }), {
        status: 409,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (["CREATED", "PAYMENT_METHOD_CHOSEN"].includes(currentState)) {
      const existingGatewayUrl = clean(currentPayment?.gw_url || (pending as any).gwUrl);
      if (!existingGatewayUrl) {
        return new Response(JSON.stringify({ ok: false, error: "Pôvodná nezaplatená platba nemá dostupný odkaz na GoPay. Zvoľte inú platbu v pokladni." }), {
          status: 409,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        paymentId: oldPaymentId,
        orderNumber: pending.orderNumber,
        gwUrl: existingGatewayUrl,
        reused: true,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (!["CANCELED", "TIMEOUTED", "FAILED"].includes(currentState)) {
      return new Response(JSON.stringify({ ok: false, error: "Pôvodná platba ešte nemá konečný neúspešný stav. Najskôr obnovte kontrolu jej stavu." }), {
        status: 409,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const goid = getEnv("GOPAY_GOID");
    const returnUrl = getEnv("GOPAY_RETURN_URL");
    const notifyUrl = getEnv("GOPAY_NOTIFY_URL");
    if (!goid || !returnUrl || !notifyUrl) throw new Error("Chýba konfigurácia GoPay.");

    const result = await withOrderIdempotency(`gopay-retry-${oldPaymentId}`, async () => {
      const amountCents = Math.max(1, Math.round(Number(pending.amountCents || Number(pending.total || 0) * 100)));
      const contact = pending.contact || {};
      const billing = pending.billing || {};
      const token = await getGoPayAccessToken("payment-create");
      const accessToken = makePaymentAccessToken(pending.orderNumber);
      const instrument = pending.paymentCode === "applepay"
        ? "APPLE_PAY"
        : pending.paymentCode === "googlepay"
          ? "GOOGLE_PAY"
          : "PAYMENT_CARD";
      const paymentBody = {
      payer: {
        default_payment_instrument: instrument,
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
        const error = new Error(String(data?.errors?.[0]?.message || data?.message || data?.raw || "Novú GoPay platbu sa nepodarilo vytvoriť."));
        (error as Error & { status?: number }).status = 502;
        throw error;
      }

      const retriedAt = new Date().toISOString();
      await savePendingGoPayOrder({
        ...pending,
        paymentState: "RETRIED",
        retriedToPaymentId: String(data.id),
        retryGatewayUrl: String(data.gw_url),
        retriedAt,
      } as any);
      await savePendingGoPayOrder({
        ...pending,
        paymentId: String(data.id),
        paymentState: "CREATED",
        amountCents,
        retryOfPaymentId: oldPaymentId,
        retriedAt,
        paymentAccessRequired: true,
      } as any);

      return {
        ok: true,
        status: 200,
        payload: {
          ok: true,
          paymentId: String(data.id),
          orderNumber: pending.orderNumber,
          gwUrl: String(data.gw_url),
          accessToken,
        },
        createdAt: retriedAt,
      };
    });

    const accessToken = String(result.payload.accessToken || "");
    cookies.set('tm_gopay_access', accessToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
      maxAge: 24 * 60 * 60,
    });

    return new Response(JSON.stringify(result.payload), {
      status: result.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("GoPay retry error:", error?.message || error);
    const status = Number(error?.status || 500);
    return new Response(JSON.stringify({ ok: false, error: status < 500 ? error?.message : "Platbu sa nepodarilo zopakovať." }), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
