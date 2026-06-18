import { createHmac } from "node:crypto";
export type WooCustomer = {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  billing?: Record<string, any>;
  shipping?: Record<string, any>;
  date_created?: string;
};

type WooRequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

function env(name: string): string {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function getWooBaseUrl(): string {
  const url = env("WOO_URL").replace(/\/$/, "");
  if (!url) throw new Error("Chýba WOO_URL v .env");
  return url;
}

export function getWooAuthHeader(): string {
  const key = env("WOO_CONSUMER_KEY");
  const secret = env("WOO_CONSUMER_SECRET");
  if (!key || !secret) throw new Error("Chýba WOO_CONSUMER_KEY alebo WOO_CONSUMER_SECRET v .env");
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

export async function wooRequest<T = any>(endpoint: string, options: WooRequestOptions = {}): Promise<T> {
  const base = getWooBaseUrl();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${base}/wp-json/wc/v3${cleanEndpoint}`);

  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: getWooAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `WooCommerce API chyba (${response.status})`;
    const error = new Error(message) as Error & { status?: number; code?: string; details?: any };
    error.status = response.status;
    error.code = data?.code;
    error.details = data;
    throw error;
  }

  return data as T;
}

export async function findWooCustomerByEmail(email: string): Promise<WooCustomer | null> {
  const customers = await wooRequest<WooCustomer[]>("/customers", {
    query: { email, per_page: 1 },
  });
  return Array.isArray(customers) && customers.length ? customers[0] : null;
}

export async function createWooCustomer(input: {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  billing?: Record<string, any>;
  shipping?: Record<string, any>;
}): Promise<WooCustomer> {
  const cleanEmail = String(input.email || "").trim().toLowerCase();
  const emailHash = createHmac("sha256", env("WOO_CONSUMER_SECRET") || "tonerymaxim").update(cleanEmail).digest("hex").slice(0, 8);
  const usernameBase = cleanEmail.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 28) || "zakaznik";
  const username = `${usernameBase}-${emailHash}`;

  return wooRequest<WooCustomer>("/customers", {
    method: "POST",
    body: {
      email: cleanEmail,
      username,
      password: input.password,
      first_name: input.first_name || "",
      last_name: input.last_name || "",
      billing: {
        first_name: input.first_name || "",
        last_name: input.last_name || "",
        email: cleanEmail,
        ...(input.billing || {}),
      },
      shipping: {
        first_name: input.first_name || "",
        last_name: input.last_name || "",
        ...(input.shipping || {}),
      },
    },
  });
}

export async function verifyWordPressLogin(email: string, password: string): Promise<boolean> {
  const base = getWooBaseUrl();
  const form = new URLSearchParams();
  form.set("log", email);
  form.set("pwd", password);
  form.set("wp-submit", "Log In");
  form.set("redirect_to", `${base}/wp-admin/`);
  form.set("testcookie", "1");

  const response = await fetch(`${base}/wp-login.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ToneryMaxim-Astro/1.0",
    },
    body: form.toString(),
    redirect: "manual",
  });

  const setCookie = response.headers.get("set-cookie") || "";
  const location = response.headers.get("location") || "";

  if (setCookie.includes("wordpress_logged_in") || location.includes("wp-admin")) return true;

  const body = await response.text().catch(() => "");
  return body.includes("wp-admin") && !body.includes("login_error");
}

export async function requestWordPressPasswordReset(email: string): Promise<void> {
  const base = getWooBaseUrl();
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("Zadajte platný e-mail.");

  const form = new URLSearchParams();
  form.set("user_login", cleanEmail);
  form.set("redirect_to", `${base}/wp-login.php?checkemail=confirm`);
  form.set("wp-submit", "Získať nové heslo");

  const response = await fetch(`${base}/wp-login.php?action=lostpassword`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ToneryMaxim-Astro/1.0",
    },
    body: form.toString(),
    redirect: "manual",
  });

  if (response.status >= 200 && response.status < 400) return;

  throw new Error(`WordPress odmietol požiadavku na obnovu hesla (${response.status}).`);
}
