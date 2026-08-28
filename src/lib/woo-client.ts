import { createHmac } from "node:crypto";

const WOO_ACCOUNT_CACHE_TTL_MS = Number(process.env.ACCOUNT_CACHE_TTL_MS || import.meta.env.ACCOUNT_CACHE_TTL_MS || 60_000);
const WOO_ACCOUNT_ORDERS_CACHE_TTL_MS = Number(process.env.ACCOUNT_ORDERS_CACHE_TTL_MS || import.meta.env.ACCOUNT_ORDERS_CACHE_TTL_MS || 60_000);
const WOO_REQUEST_TIMEOUT_MS = Math.min(60_000, Math.max(3_000, Number(process.env.WOO_REQUEST_TIMEOUT_MS || import.meta.env.WOO_REQUEST_TIMEOUT_MS || 20_000)));
const WOO_ACCOUNT_CACHE_MAX_ITEMS = 500;
const WOO_ACCOUNT_ORDERS_CACHE_MAX_ITEMS = 300;

type CacheEntry<T> = { value: T; expiresAt: number };
const wooCustomerCache = new Map<number, CacheEntry<WooCustomer | null>>();
const wooCustomerOrdersCache = new Map<string, CacheEntry<WooOrder[]>>();

function cacheTtl(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getCached<T>(cache: Map<string | number, CacheEntry<T>>, key: string | number): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string | number, CacheEntry<T>>, key: string | number, value: T, ttlMs: number, maxItems = 300): T {
  const now = Date.now();
  for (const [cacheKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cacheKey);
  }
  while (cache.size >= maxItems) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function clearCustomerAccountCache(customerId: number): void {
  if (!customerId) return;
  wooCustomerCache.delete(customerId);
  for (const key of [...wooCustomerOrdersCache.keys()]) {
    if (key.startsWith(`${customerId}:`)) wooCustomerOrdersCache.delete(key);
  }
}

export type WooCustomer = {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  billing?: Record<string, any>;
  shipping?: Record<string, any>;
  date_created?: string;
  meta_data?: Array<{ id?: number; key?: string; value?: any }>;
};

type WooRequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

const TONERYMAXIM_WP_ORIGIN_HEADER = "X-ToneryMaxim-Origin";
const TONERYMAXIM_WP_SUPPRESS_EMAILS_HEADER = "X-ToneryMaxim-Suppress-Emails";

function env(name: string): string {
  const value = process.env[name] || import.meta.env[name];
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

/**
 * Jednotné hlavičky pre vlastné WordPress REST endpointy ToneryMaxim.
 * Používajú rovnaké overenie ako WooCommerce API, ktoré WordPress pozná.
 */
export function getToneryMaximWordPressHeaders(method = "GET"): Record<string, string> {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) return {};
  return {
    [TONERYMAXIM_WP_ORIGIN_HEADER]: "astro",
    [TONERYMAXIM_WP_SUPPRESS_EMAILS_HEADER]: "1",
  };
}

export async function wooRequest<T = any>(endpoint: string, options: WooRequestOptions = {}): Promise<T> {
  const base = getWooBaseUrl();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${base}/wp-json/wc/v3${cleanEndpoint}`);

  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const method = String(options.method || "GET").toUpperCase();
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: getWooAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...getToneryMaximWordPressHeaders(method),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(WOO_REQUEST_TIMEOUT_MS),
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

export async function verifyWordPressEmailPolicy(): Promise<{ ok: boolean; version?: string; mode?: string }> {
  const base = getWooBaseUrl();
  const response = await fetch(`${base}/wp-json/tonerymaxim/v1/email-policy`, {
    method: "GET",
    headers: {
      Authorization: getWooAuthHeader(),
      Accept: "application/json",
      "User-Agent": "ToneryMaxim-Astro/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok || data?.ok !== true) {
    throw new Error("WordPress doplnok ToneryMAXIM Email Policy nie je nainštalovaný alebo aktívny.");
  }
  return data;
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
  meta_data?: Array<{ key: string; value: any }>;
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
      meta_data: Array.isArray(input.meta_data) ? input.meta_data : [],
    },
  });
}

export async function updateWooCustomerPassword(customerId: number, password: string): Promise<WooCustomer> {
  if (!customerId) throw new Error("Chýba ID zákazníka.");
  if (!password || password.length < 12 || password.length > 128) throw new Error("Heslo musí mať 12 až 128 znakov.");

  return wooRequest<WooCustomer>(`/customers/${customerId}`, {
    method: "PUT",
    body: { password },
  });
}


export type WooOrderLineItem = {
  id?: number;
  name?: string;
  product_id?: number;
  variation_id?: number;
  quantity?: number;
  subtotal?: string;
  total?: string;
  sku?: string;
};

export type WooOrder = {
  id: number;
  number?: string;
  status?: string;
  date_created?: string;
  total?: string;
  currency?: string;
  payment_method_title?: string;
  billing?: Record<string, any>;
  shipping?: Record<string, any>;
  line_items?: WooOrderLineItem[];
  meta_data?: Array<{ key?: string; value?: any }>;
};

export async function getWooCustomerById(customerId: number): Promise<WooCustomer | null> {
  if (!customerId) return null;

  const cached = getCached(wooCustomerCache, customerId);
  if (cached !== undefined) return cached;

  try {
    const customer = await wooRequest<WooCustomer>(`/customers/${customerId}`);
    return setCached(wooCustomerCache, customerId, customer, cacheTtl(WOO_ACCOUNT_CACHE_TTL_MS, 60_000), WOO_ACCOUNT_CACHE_MAX_ITEMS);
  } catch (error: any) {
    if (error?.status === 404) {
      return setCached(wooCustomerCache, customerId, null, 10_000, WOO_ACCOUNT_CACHE_MAX_ITEMS);
    }
    throw error;
  }
}

export async function updateWooCustomer(customerId: number, body: Record<string, any>): Promise<WooCustomer> {
  if (!customerId) throw new Error("Chýba ID zákazníka.");
  clearCustomerAccountCache(customerId);
  const customer = await wooRequest<WooCustomer>(`/customers/${customerId}`, {
    method: "PUT",
    body,
  });
  setCached(wooCustomerCache, customerId, customer, cacheTtl(WOO_ACCOUNT_CACHE_TTL_MS, 60_000), WOO_ACCOUNT_CACHE_MAX_ITEMS);
  return customer;
}

export async function getWooCustomerOrders(customerId: number, perPage = 20): Promise<WooOrder[]> {
  if (!customerId) return [];

  const key = `${customerId}:${perPage}`;
  const cached = getCached(wooCustomerOrdersCache, key);
  if (cached !== undefined) return cached;

  const orders = await wooRequest<WooOrder[]>("/orders", {
    query: {
      customer: customerId,
      per_page: perPage,
      orderby: "date",
      order: "desc",
    },
  });

  return setCached(wooCustomerOrdersCache, key, Array.isArray(orders) ? orders : [], cacheTtl(WOO_ACCOUNT_ORDERS_CACHE_TTL_MS, 60_000), WOO_ACCOUNT_ORDERS_CACHE_MAX_ITEMS);
}


export const TONERYMAXIM_META_DATA = [
  { key: "source", value: "tonerymaxim" },
  { key: "sales_channel", value: "tonerymaxim" },
  { key: "created_via", value: "tonerymaxim_astro" },
] as const;

export function addMonthsIso(date = new Date(), months = 1): string {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
}

export function welcomeCouponCode(customerId: number): string {
  return `VITAJTE5-${String(customerId).padStart(4, "0")}`;
}

export function getCustomerMeta(customer: WooCustomer | null | undefined, key: string): any {
  const meta = Array.isArray(customer?.meta_data) ? customer!.meta_data : [];
  const item = meta.find((entry) => entry?.key === key);
  return item?.value;
}

export function parseJsonMeta<T>(value: any, fallback: T): T {
  if (Array.isArray(value) || (value && typeof value === "object")) return value as T;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed as T;
  } catch {
    return fallback;
  }
}

export type SavedPrinter = {
  title: string;
  brand?: string;
  url?: string;
  product_count?: number;
  added_at?: string;
  care_enabled?: boolean;
  installed_at?: string;
  expected_months?: number;
  expected_replacement_at?: string;
  reminder_days?: number;
  preferred_type?: "compatible" | "original" | "renovated" | "any";
  customer_reminder_sent_for?: string;
  admin_reminder_sent_for?: string;
  last_reminder_at?: string;
};

export function getSavedPrintersFromCustomer(customer: WooCustomer | null | undefined): SavedPrinter[] {
  const value = getCustomerMeta(customer, "tm_saved_printers");
  const printers = parseJsonMeta<SavedPrinter[]>(value, []);
  return Array.isArray(printers)
    ? printers
        .filter((printer) => String(printer?.title || "").trim())
        .map((printer) => ({
          title: String(printer.title || "").trim(),
          brand: String(printer.brand || "").trim(),
          url: String(printer.url || "").trim(),
          product_count: Number(printer.product_count || 0),
          added_at: String(printer.added_at || "").trim(),
          care_enabled: printer.care_enabled === true,
          installed_at: String(printer.installed_at || "").trim(),
          expected_months: Math.min(24, Math.max(1, Number(printer.expected_months || 3))),
          expected_replacement_at: String(printer.expected_replacement_at || "").trim(),
          reminder_days: 21,
          preferred_type: ["compatible", "original", "renovated", "any"].includes(String(printer.preferred_type || ""))
            ? printer.preferred_type
            : "any",
          customer_reminder_sent_for: String(printer.customer_reminder_sent_for || "").trim(),
          admin_reminder_sent_for: String(printer.admin_reminder_sent_for || "").trim(),
          last_reminder_at: String(printer.last_reminder_at || "").trim(),
        }))
    : [];
}

export async function getWooCustomersPage(page = 1, perPage = 100): Promise<WooCustomer[]> {
  const customers = await wooRequest<WooCustomer[]>("/customers", {
    query: {
      page: Math.max(1, Math.trunc(page)),
      per_page: Math.min(100, Math.max(1, Math.trunc(perPage))),
      orderby: "id",
      order: "asc",
      role: "customer",
    },
  });
  return Array.isArray(customers) ? customers : [];
}

export async function saveWooCustomerPrinters(customerId: number, printers: SavedPrinter[]): Promise<WooCustomer> {
  return updateWooCustomer(customerId, {
    meta_data: [
      ...TONERYMAXIM_META_DATA,
      { key: "tm_saved_printers", value: JSON.stringify(printers) },
    ],
  });
}

export function getHiddenRecentProductKeys(customer: WooCustomer | null | undefined): string[] {
  const value = getCustomerMeta(customer, "tm_hidden_recent_products");
  const keys = parseJsonMeta<string[]>(value, []);
  return Array.isArray(keys) ? keys.map((key) => String(key)).filter(Boolean) : [];
}

export async function saveHiddenRecentProductKeys(customerId: number, keys: string[]): Promise<WooCustomer> {
  const unique = [...new Set(keys.map((key) => String(key)).filter(Boolean))];
  return updateWooCustomer(customerId, {
    meta_data: [
      ...TONERYMAXIM_META_DATA,
      { key: "tm_hidden_recent_products", value: JSON.stringify(unique) },
    ],
  });
}

export function getWelcomeReward(customer: WooCustomer | null | undefined) {
  const expires = String(getCustomerMeta(customer, "tm_welcome_discount_expires") || "");
  const used = String(getCustomerMeta(customer, "tm_welcome_discount_used") || "no").toLowerCase() === "yes";
  const percent = Number(getCustomerMeta(customer, "tm_welcome_discount_percent") || 5);
  const now = Date.now();
  const expTime = expires ? new Date(expires).getTime() : 0;
  return {
    percent: Number.isFinite(percent) && percent > 0 ? percent : 5,
    expires,
    active: Boolean(expires && expTime > now && !used),
    used,
  };
}

export async function markWooCustomerAsToneryMaxim(customerId: number): Promise<WooCustomer> {
  return updateWooCustomer(customerId, { meta_data: [...TONERYMAXIM_META_DATA] });
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

export type SavedProduct = {
  id?: number;
  sku?: string;
  title: string;
  url?: string;
  image?: string;
  price?: number;
  type?: string;
  type_label?: string;
  stock_status?: string;
  added_at?: string;
};

export function getSavedProductsFromCustomer(customer: WooCustomer | null | undefined): SavedProduct[] {
  const value = getCustomerMeta(customer, "tm_saved_products");
  const products = parseJsonMeta<SavedProduct[]>(value, []);
  return Array.isArray(products)
    ? products
        .filter((product) => String(product?.title || product?.sku || product?.id || "").trim())
        .map((product) => ({
          id: product.id ? Number(product.id) : undefined,
          sku: String(product.sku || "").trim(),
          title: String(product.title || "Produkt").trim(),
          url: String(product.url || "").trim(),
          image: String(product.image || "").trim(),
          price: Number(product.price || 0),
          type: String(product.type || "").trim(),
          type_label: String(product.type_label || "").trim(),
          stock_status: String(product.stock_status || "").trim(),
          added_at: String(product.added_at || "").trim(),
        }))
    : [];
}

export async function saveWooCustomerSavedProducts(customerId: number, products: SavedProduct[]): Promise<WooCustomer> {
  return updateWooCustomer(customerId, {
    meta_data: [
      ...TONERYMAXIM_META_DATA,
      { key: "tm_saved_products", value: JSON.stringify(products) },
    ],
  });
}
