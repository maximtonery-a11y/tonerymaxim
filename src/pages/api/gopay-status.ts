import type { APIRoute } from "astro";

export const prerender = false;

function getGoPayHost() {
  return import.meta.env.GOPAY_ENV === "production"
    ? "https://gate.gopay.cz"
    : "https://gw.sandbox.gopay.com";
}

function env(name: string) {
  return String(import.meta.env[name] || "").trim();
}

function basicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

async function getAccessToken() {
  const clientId = env("GOPAY_CLIENT_ID");
  const clientSecret = env("GOPAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Chýba GOPAY_CLIENT_ID alebo GOPAY_CLIENT_SECRET v .env.");
  }

  const tokenResponse = await fetch(`${getGoPayHost()}/api/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "payment-all",
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
    throw new Error(
      tokenData?.errors?.[0]?.message ||
      tokenData?.error_description ||
      tokenData?.error ||
      tokenData?.raw ||
      "Nepodarilo sa získať GoPay token."
    );
  }

  return String(tokenData.access_token);
}

async function getPayment(paymentId: string) {
  const token = await getAccessToken();

  const response = await fetch(`${getGoPayHost()}/api/payments/payment/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();

  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data?.errors?.[0]?.message ||
      data?.message ||
      data?.raw ||
      `Nepodarilo sa overiť GoPay platbu ${paymentId}.`;

    throw new Error(String(message));
  }

  return data;
}

function getUiState(state: string) {
  switch (state) {
    case "PAID":
      return {
        type: "paid",
        title: "Platba bola úspešná",
        message: "Platbu sme prijali. V ostrej prevádzke tu automaticky vytvoríme a označíme objednávku ako zaplatenú.",
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

    const payment = await getPayment(paymentId);
    const state = String(payment?.state || "UNKNOWN");

    console.log("GoPay status check", {
      id: payment.id,
      state,
      order_number: payment.order_number,
      amount: payment.amount,
      currency: payment.currency,
    });

    return new Response(JSON.stringify({
      ok: true,
      state,
      ui: getUiState(state),
      payment: {
        id: payment.id,
        state: payment.state,
        order_number: payment.order_number,
        amount: payment.amount,
        currency: payment.currency,
        gw_url: payment.gw_url,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("GoPay status error", error?.message || error);

    return new Response(JSON.stringify({
      ok: false,
      error: error?.message || "Nepodarilo sa overiť platbu.",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
