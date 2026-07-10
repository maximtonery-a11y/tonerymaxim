import type { APIRoute } from "astro";
import { processPaidGoPayOrder, readPendingGoPayOrder } from "../../lib/gopay-order";
import { getGoPayPayment } from "../../lib/gopay-client";

export const prerender = false;

async function getPayment(paymentId: string) {
  return getGoPayPayment(paymentId);
}

function getUiState(state: string) {
  switch (state) {
    case "PAID":
      return {
        type: "paid",
        title: "Platba bola úspešná",
        message: "Platbu sme prijali a objednávka bola odoslaná do systému.",
      };
    case "CANCELED":
      return {
        type: "canceled",
        title: "Platba nebola dokončená",
        message: "GoPay vrátil stav CANCELED. Pri sandbox teste to znamená, že platba bola zrušená alebo zamietnutá v testovacom 3D Secure kroku.",
      };
    case "TIMEOUTED":
      return {
        type: "canceled",
        title: "Platba vypršala",
        message: "Platba nebola dokončená v časovom limite.",
      };
    case "CREATED":
    case "PAYMENT_METHOD_CHOSEN":
      return {
        type: "pending",
        title: "Platba čaká na dokončenie",
        message: "Platba ešte nebola zaplatená. Skúste platbu zopakovať alebo zvoľte inú metódu.",
      };
    default:
      return {
        type: "unknown",
        title: "Stav platby nepoznáme",
        message: "GoPay vrátil stav, ktorý zatiaľ nespracúvame.",
      };
  }
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const paymentId = url.searchParams.get("id") || "";

    if (!paymentId) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Chýba ID platby.",
      }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const pending = await readPendingGoPayOrder(paymentId);
    const payment = await getPayment(paymentId);
    const state = String(payment?.state || "UNKNOWN");

    let orderResult: any = null;

    if (state === "PAID") {
      processPaidGoPayOrder(payment)
        .then((result) => console.log("GoPay status background Woo order", {
          id: payment.id,
          state,
          order_number: payment.order_number,
          woo_order_id: result?.orderId || null,
          woo_order_created: result?.created || false,
        }))
        .catch((error) => console.error("GoPay status background Woo order error", error?.message || error));
    }

    console.log("GoPay status check", {
      id: payment.id,
      state,
      order_number: payment.order_number,
      amount: payment.amount,
      currency: payment.currency,
      woo_order_background: state === "PAID",
    });

    return new Response(JSON.stringify({
      ok: true,
      state,
      ui: getUiState(state),
      order: orderResult ? {
        created: orderResult.created,
        id: orderResult.orderId,
        number: orderResult.orderNumber,
      } : null,
      payment: {
        id: payment.id,
        state: payment.state,
        order_number: payment.order_number,
        amount: payment.amount,
        currency: payment.currency,
        gw_url: payment.gw_url,
      },
      pending: pending ? {
        orderNumber: pending.orderNumber,
        total: pending.total,
        amountCents: pending.amountCents,
        paymentCode: pending.paymentCode,
        paymentLabel: pending.paymentLabel,
      } : null,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("GoPay status error", error?.message || error);
    const paymentId = url.searchParams.get("id") || "";
    const pending = await readPendingGoPayOrder(paymentId).catch(() => null);

    return new Response(JSON.stringify({
      ok: false,
      error: error?.message || "Nepodarilo sa overiť platbu.",
      pending: pending ? {
        orderNumber: pending.orderNumber,
        total: pending.total,
        amountCents: pending.amountCents,
        paymentCode: pending.paymentCode,
        paymentLabel: pending.paymentLabel,
      } : null,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
