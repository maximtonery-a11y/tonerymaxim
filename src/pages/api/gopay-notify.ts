import type { APIRoute } from "astro";
import { processPaidGoPayOrder } from "../../lib/gopay-order";
import { getGoPayPayment } from "../../lib/gopay-client";

export const prerender = false;

async function getPaymentStatus(paymentId: string) {
  return getGoPayPayment(paymentId);
}

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
    const payment = await getPaymentStatus(paymentId);
    let orderResult: any = null;

    if (String(payment.state || "") === "PAID") {
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

    const payment = await getPaymentStatus(paymentId);

    let orderResult: any = null;

    if (String(payment.state || "") === "PAID") {
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
