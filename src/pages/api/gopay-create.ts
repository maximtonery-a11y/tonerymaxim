import type { APIRoute } from "astro";

export const prerender = false;

type CartItem = {
  id?: string | number;
  sku?: string;
  name?: string;
  price?: number | string;
  qty?: number | string;
  quantity?: number | string;
  product_type_key?: string;
  productTypeKey?: string;
  product_type_label?: string;
  productTypeLabel?: string;
};

const SHIPPING: Record<string, { label: string; price: number }> = {
  courier: { label: "GLS kuriér na adresu", price: 3.9 },
  pickup: { label: "GLS ParcelShop", price: 2.9 },
  box: { label: "GLS Balíkomat", price: 2.9 },
};

const PAYMENT: Record<string, { label: string; price: number; gopayInstrument?: string }> = {
  gopay: { label: "Platba kartou online", price: 0, gopayInstrument: "PAYMENT_CARD" },
  applepay: { label: "Apple Pay", price: 0, gopayInstrument: "PAYMENT_CARD" },
  googlepay: { label: "Google Pay", price: 0, gopayInstrument: "PAYMENT_CARD" },
  cod: { label: "Dobierka", price: 1.2 },
};

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

function maskValue(value: string) {
  if (!value) return "EMPTY";
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}***${value.slice(-2)} (length ${value.length})`;
}

function normalizePrice(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  }

  if (typeof value === "string") {
    const number = Number(value.replace(/\s/g, "").replace("€", "").replace(",", "."));
    return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
  }

  return 0;
}

function normalizeQty(value: unknown) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number) || number < 1) return 1;
  if (number > 99) return 99;
  return number;
}

function toCents(value: number) {
  return Math.round(Number(value || 0) * 100);
}

function isCompatibleDiscountItem(item: ReturnType<typeof normalizeCart>[number]) {
  const type = String(item.product_type_key || "").toLowerCase();
  const label = String(item.product_type_label || item.name || "").toLowerCase();
  return type === "compatible" || label.includes("kompatibil");
}

function discountRate(item: ReturnType<typeof normalizeCart>[number]) {
  if (!isCompatibleDiscountItem(item)) return 0;
  if (item.qty >= 4) return 0.25;
  if (item.qty >= 2) return 0.10;
  return 0;
}

function discountedLine(item: ReturnType<typeof normalizeCart>[number]) {
  const original = item.price * item.qty;
  const discount = Math.round(original * discountRate(item) * 100) / 100;
  return {
    original,
    discount,
    final: Math.max(0, Math.round((original - discount) * 100) / 100),
  };
}

function normalizeCart(cart: CartItem[]) {
  return cart
    .map((item, index) => {
      const name = String(item.name || item.sku || item.id || `Produkt ${index + 1}`).trim();
      const price = normalizePrice(item.price);
      const qty = normalizeQty(item.qty ?? item.quantity ?? 1);

      return {
        id: String(item.id || item.sku || name),
        sku: String(item.sku || item.id || ""),
        name: name.slice(0, 128),
        price,
        qty,
        product_type_key: String(item.product_type_key || item.productTypeKey || ""),
        product_type_label: String(item.product_type_label || item.productTypeLabel || ""),
      };
    })
    .filter((item) => item.name && item.price > 0 && item.qty > 0);
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

export const POST: APIRoute = async ({ request }) => {
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

    const body = await request.json().catch(() => ({}));
    const cart = normalizeCart(Array.isArray(body.cart) ? body.cart : []);

    if (cart.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Košík je prázdny.",
      }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const shippingCode = String(body.shipping || "courier");
    const paymentCode = String(body.payment || "gopay");

    if (paymentCode === "cod") {
      return new Response(JSON.stringify({
        ok: false,
        error: "Dobierka sa neposiela do GoPay.",
      }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const shipping = SHIPPING[shippingCode] || SHIPPING.courier;
    const payment = PAYMENT[paymentCode] || PAYMENT.gopay;

    const subtotal = cart.reduce((sum, item) => sum + discountedLine(item).final, 0);
    const shippingPrice = subtotal >= 29 ? 0 : shipping.price;
    const paymentPrice = payment.price;

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
        allowed_payment_instruments: ["PAYMENT_CARD"],
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
