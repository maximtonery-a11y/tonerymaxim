export type GoPayTokenScope = "payment-create" | "payment-all";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

const TOKEN_CACHE = new Map<string, CachedToken>();
const TOKEN_REQUESTS = new Map<string, Promise<string>>();
const TOKEN_SAFETY_WINDOW_MS = 60_000;

export function getEnv(name: string) {
  return String(process.env[name] || import.meta.env[name] || "").trim();
}

export function getGoPayEnvironment() {
  const value = getEnv("GOPAY_ENV").toLowerCase();
  return ["production", "prod", "live", "ostrý", "ostry"].includes(value) ? "production" : "sandbox";
}

export function getGoPayHost() {
  return getGoPayEnvironment() === "production"
    ? "https://gate.gopay.cz"
    : "https://gw.sandbox.gopay.com";
}

function basicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

function cacheKey(scope: GoPayTokenScope) {
  return [
    getGoPayHost(),
    getEnv("GOPAY_CLIENT_ID"),
    scope,
  ].join("|");
}

function parseJson(text: string) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export async function getGoPayAccessToken(scope: GoPayTokenScope) {
  const clientId = getEnv("GOPAY_CLIENT_ID");
  const clientSecret = getEnv("GOPAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Chýba GOPAY_CLIENT_ID alebo GOPAY_CLIENT_SECRET v .env.");
  }

  const key = cacheKey(scope);
  const cached = TOKEN_CACHE.get(key);
  const now = Date.now();

  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > now) {
    return cached.accessToken;
  }

  const pending = TOKEN_REQUESTS.get(key);
  if (pending) return pending;

  const request = (async () => {
    const tokenUrl = `${getGoPayHost()}/api/oauth2/token`;

    const response = await fetch(tokenUrl, {
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

    const text = await response.text();
    const data = parseJson(text);

    if (!response.ok || !data?.access_token) {
      const message =
        data?.errors?.[0]?.message ||
        data?.error_description ||
        data?.error ||
        data?.raw ||
        `GoPay OAuth chyba ${response.status}`;

      throw new Error(String(message));
    }

    const expiresInSeconds = Math.max(60, Number(data.expires_in || 1800));
    const accessToken = String(data.access_token);

    TOKEN_CACHE.set(key, {
      accessToken,
      expiresAt: now + expiresInSeconds * 1000,
    });

    if (getEnv("TM_GOPAY_DEBUG") === "1") {
      console.log("GoPay token cache refresh", {
        scope,
        expiresIn: expiresInSeconds,
        env: getEnv("GOPAY_ENV") || "sandbox/default",
      });
    }

    return accessToken;
  })();

  TOKEN_REQUESTS.set(key, request);

  try {
    return await request;
  } finally {
    TOKEN_REQUESTS.delete(key);
  }
}

export async function getGoPayPayment(paymentId: string) {
  const cleanPaymentId = String(paymentId || "").trim();
  if (!cleanPaymentId) throw new Error("Chýba ID GoPay platby.");

  const token = await getGoPayAccessToken("payment-all");
  const response = await fetch(`${getGoPayHost()}/api/payments/payment/${encodeURIComponent(cleanPaymentId)}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    const message =
      data?.errors?.[0]?.message ||
      data?.message ||
      data?.raw ||
      `Nepodarilo sa overiť GoPay platbu ${cleanPaymentId}.`;

    throw new Error(String(message));
  }

  return data;
}

export type VerifiedGoPayPayment = Record<string, any> & {
  id: string | number;
  state: string;
  order_number: string;
  amount: number;
  currency: string;
};

export async function verifyGoPayPaymentAgainstOrder(paymentId: string, expected: {
  orderNumber: string;
  amountCents: number;
  currency?: string;
  requirePaid?: boolean;
}) {
  const payment = await getGoPayPayment(paymentId) as VerifiedGoPayPayment;
  const errors: string[] = [];
  const state = String(payment?.state || '').toUpperCase();
  const currency = String(payment?.currency || '').toUpperCase();
  const orderNumber = String(payment?.order_number || '');
  const amount = Number(payment?.amount || 0);
  const expectedCurrency = String(expected.currency || 'EUR').toUpperCase();
  const configuredGoId = Number(getEnv('GOPAY_GOID') || 0);
  const returnedGoId = Number(payment?.target?.goid || 0);

  if (String(payment?.id || '') !== String(paymentId)) errors.push('payment-id-mismatch');
  if (orderNumber !== String(expected.orderNumber || '')) errors.push('order-number-mismatch');
  if (amount !== Math.round(Number(expected.amountCents || 0))) errors.push('amount-mismatch');
  if (currency !== expectedCurrency) errors.push('currency-mismatch');
  if (configuredGoId > 0 && returnedGoId > 0 && returnedGoId !== configuredGoId) errors.push('goid-mismatch');
  if (expected.requirePaid && !['PAID', 'AUTHORIZED'].includes(state)) errors.push(`invalid-state-${state || 'UNKNOWN'}`);

  if (errors.length) throw new Error(`GoPay overenie zlyhalo: ${errors.join(', ')}`);
  return payment;
}
