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

async function getPaymentStatus(paymentId: string) {
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

    console.log("GoPay notification", {
      id: payment.id,
      state: payment.state,
      order_number: payment.order_number,
      amount: payment.amount,
      currency: payment.currency,
    });

    return new Response("OK", { status: 200 });
  } catch (error: any) {
    console.error("GoPay notify error", error?.message || error);
    return new Response("ERROR", { status: 500 });
  }
};
