import type { APIRoute } from "astro";
import { readPendingGoPayOrder, savePendingGoPayOrder, updateWooOrderPayment } from "../../lib/checkout-order";
import { replaceQueuedOrderPayment } from "../../lib/async-order-queue";
import { verifyGoPayPaymentAgainstOrder } from "../../lib/gopay-client";
import { verifyPaymentAccessToken } from "../../lib/payment-access";
import { withOrderIdempotency } from "../../lib/order-idempotency";

export const prerender = false;

const OFFLINE_PAYMENTS: Record<string, { label: string; price: number }> = {
  cod: { label: "Dobierka", price: 1.2 },
  bank_prepaid: { label: "Platba prevodným príkazom vopred", price: 0 },
  invoice_org: { label: "Prevodný príkaz pre organizácie a firmy", price: 0 },
};

function json(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const paymentId = String(body?.paymentId || "").trim();
    const paymentCode = String(body?.payment || "").trim();
    const nextPayment = OFFLINE_PAYMENTS[paymentCode];
    if (!paymentId || !nextPayment) return json({ ok: false, error: "Chýba pôvodná GoPay platba alebo nový spôsob platby." }, 400);

    const pending = await readPendingGoPayOrder(paymentId);
    if (!pending) return json({ ok: false, error: "Pôvodnú objednávku sa nepodarilo nájsť." }, 404);
    const access = cookies.get("tm_gopay_access")?.value;
    if ((pending as any).paymentAccessRequired && !verifyPaymentAccessToken(access, pending.orderNumber)) {
      return json({ ok: false, error: "Odkaz na zmenu platby nie je platný alebo expiroval." }, 403);
    }

    const storedState = String(pending.paymentState || "").toUpperCase();
    if (storedState === "RETRIED") {
      return json({ ok: false, error: "K tejto objednávke už bol vytvorený nový GoPay platobný pokus. Pôvodnú platbu už nemožno zmeniť." }, 409);
    }
    if (storedState === "CONVERTED_TO_OFFLINE") {
      if (pending.paymentCode !== paymentCode) {
        return json({ ok: false, error: "Spôsob platby tejto objednávky už bol zmenený. Ďalšiu zmenu vykonajte cez podporu." }, 409);
      }
      return json({
        ok: true,
        orderId: Number(pending.wooOrderId || 0) || pending.orderNumber,
        orderNumber: pending.wooOrderNumber || pending.orderNumber,
        payment: paymentCode,
        replayed: true,
      });
    }

    const amountCents = Number(pending.amountCents || 0);
    const payment = await verifyGoPayPaymentAgainstOrder(paymentId, {
      orderNumber: pending.orderNumber,
      amountCents,
      currency: pending.currency,
      requirePaid: false,
    });
    const state = String(payment?.state || "UNKNOWN").toUpperCase();
    if (["PAID", "AUTHORIZED"].includes(state)) {
      return json({ ok: false, error: "Platba už bola uhradená. Spôsob platby sa nedá zmeniť." }, 409);
    }
    if (!["CANCELED", "TIMEOUTED", "FAILED"].includes(state)) {
      return json({ ok: false, error: "GoPay platba ešte nemá konečný neúspešný stav. Najskôr overte jej stav." }, 409);
    }

    const result = await withOrderIdempotency(`gopay-change-${paymentId}-${paymentCode}`, async () => {
      const oldPaymentPrice = Number(pending.paymentPrice || 0);
      const total = Math.max(0, Math.round((Number(pending.total || 0) - oldPaymentPrice + nextPayment.price) * 100) / 100);
      const updatedSource = {
        ...pending,
        paymentState: "CONVERTED_TO_OFFLINE",
        paymentCode,
        paymentLabel: nextPayment.label,
        paymentPrice: nextPayment.price,
        total,
        amountCents: Math.round(total * 100),
        processedAt: new Date().toISOString(),
      };

      const queue = await replaceQueuedOrderPayment(updatedSource);
      if (queue.state === "processing") {
        const error = new Error("Objednávka sa práve zapisuje. Skúste zmenu platby o chvíľu znova.");
        (error as Error & { status?: number }).status = 409;
        throw error;
      }

      const orderId = Number(queue.orderId || updatedSource.wooOrderId || 0);
      let orderNumber = updatedSource.orderNumber;
      if (orderId > 0) {
        const woo = await updateWooOrderPayment(updatedSource, orderId);
        updatedSource.wooOrderId = woo.orderId;
        updatedSource.wooOrderNumber = woo.orderNumber;
        orderNumber = woo.orderNumber || orderNumber;
      }
      await savePendingGoPayOrder(updatedSource);

      return {
        ok: true,
        status: 200,
        payload: { ok: true, orderId: orderId || updatedSource.orderNumber, orderNumber, payment: paymentCode },
        createdAt: new Date().toISOString(),
      };
    });

    return json(result.payload, result.status);
  } catch (error: any) {
    const status = Number(error?.status || 500);
    console.error("GoPay payment change error:", error?.message || error);
    return json({ ok: false, error: status < 500 ? error.message : "Spôsob platby sa nepodarilo zmeniť." }, status);
  }
};
