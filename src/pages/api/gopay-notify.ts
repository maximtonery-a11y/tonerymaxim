import type { APIRoute } from "astro";
import { processPaidGoPayOrder, readPendingGoPayOrder } from "../../lib/gopay-order";
import { verifyGoPayPaymentAgainstOrder } from "../../lib/gopay-client";

export const prerender = false;

function extractPaymentIdFromText(text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";

  try {
    const json = JSON.parse(trimmed);
    return String(json.id || json.payment_id || json.paymentId || "");
  } catch {
    const params = new URLSearchParams(trimmed);
    return String(params.get("id") || params.get("payment_id") || "");
  }
}


export const GET: APIRoute = async ({ url }) => {
  const paymentId = String(url.searchParams.get("id") || url.searchParams.get("payment_id") || "").trim();

  // GoPay alebo monitoring môže endpoint overovať cez GET.
  // Bez ID iba potvrdíme dostupnosť; reálne spracovanie notifikácie ostáva v POST.
  if (!paymentId) {
    return new Response("GoPay notify endpoint is available.", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const pending = await readPendingGoPayOrder(paymentId);
    if (!pending) throw new Error(`Neznáma GoPay platba ${paymentId}.`);
    const payment = await verifyGoPayPaymentAgainstOrder(paymentId, { orderNumber: pending.orderNumber, amountCents: pending.amountCents, currency: pending.currency, requirePaid: false });
    let orderResult: any = null;

    if (["PAID", "AUTHORIZED"].includes(String(payment.state || "").toUpperCase())) {
      orderResult = await processPaidGoPayOrder(payment);
    }

    console.log("GoPay notification GET", {
      id: payment.id,
      state: payment.state,
      order_number: payment.order_number,
      woo_order_id: orderResult?.orderId || null,
      woo_order_created: orderResult?.created || false,
    });

    return new Response("OK", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("GoPay notify GET error", error?.message || error);
    return new Response("ERROR", { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get("content-type") || "";
    let paymentId = "";

    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      paymentId = String(body.id || body.payment_id || body.paymentId || "");
    } else {
      const text = await request.text();
      paymentId = extractPaymentIdFromText(text);
    }

    if (!paymentId) {
      return new Response("Missing payment id", { status: 400 });
    }

    const pending = await readPendingGoPayOrder(paymentId);
    if (!pending) throw new Error(`Neznáma GoPay platba ${paymentId}.`);
    const payment = await verifyGoPayPaymentAgainstOrder(paymentId, { orderNumber: pending.orderNumber, amountCents: pending.amountCents, currency: pending.currency, requirePaid: false });

    let orderResult: any = null;

    if (["PAID", "AUTHORIZED"].includes(String(payment.state || "").toUpperCase())) {
      orderResult = await processPaidGoPayOrder(payment);
    }

    console.log("GoPay notification", {
      id: payment.id,
      state: payment.state,
      order_number: payment.order_number,
      amount: payment.amount,
      currency: payment.currency,
      woo_order_id: orderResult?.orderId || null,
      woo_order_created: orderResult?.created || false,
    });

    return new Response("OK", { status: 200 });
  } catch (error: any) {
    console.error("GoPay notify error", error?.message || error);
    return new Response("ERROR", { status: 500 });
  }
};
