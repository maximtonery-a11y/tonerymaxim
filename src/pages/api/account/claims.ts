import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";
import { getWooCustomerById, getWooCustomerOrders, updateWooCustomer, getCustomerMeta, parseJsonMeta, TONERYMAXIM_META_DATA } from "../../../lib/woo-client";
import { sendMail } from "../../../lib/mail";

export const prerender = false;

type ClaimStatus = "received" | "checking" | "approved" | "resolved";

type Claim = {
  id: string;
  customer_id: number;
  order_id: number;
  order_number: string;
  product_id: number;
  product_name: string;
  product_sku?: string;
  reason: string;
  message: string;
  status: ClaimStatus;
  created_at: string;
  updated_at: string;
};

const CLAIMS_META_KEY = "tm_claims";
const STATUS_LABELS: Record<ClaimStatus, string> = {
  received: "Prijatá",
  checking: "Kontrolujeme",
  approved: "Schválená",
  resolved: "Vybavená",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function env(name: string): string {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function wpBaseUrl(): string {
  const raw = env("WP_URL") || env("WORDPRESS_URL") || env("WOO_URL");
  if (!raw) throw new Error("Chýba WP_URL alebo WOO_URL v .env");
  return raw.replace(/\/$/, "");
}

function wpAuthHeader(): string {
  const user = env("WP_USER") || env("WORDPRESS_USER") || env("WP_ADMIN_USER");
  const pass = env("WP_APP_PASSWORD") || env("WORDPRESS_APP_PASSWORD") || env("WP_PASSWORD");
  if (user && pass) return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  // Núdzový fallback. Na niektorých inštaláciách stačí Woo Basic Auth aj pre vlastný REST endpoint.
  const key = env("WOO_CONSUMER_KEY");
  const secret = env("WOO_CONSUMER_SECRET");
  if (key && secret) return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  throw new Error("Chýba WP_USER/WP_APP_PASSWORD alebo WOO_CONSUMER_KEY/WOO_CONSUMER_SECRET.");
}

async function wpRequest<T = any>(endpoint: string, options: { method?: string; body?: any; query?: Record<string, any> } = {}): Promise<T> {
  const base = wpBaseUrl();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${base}/wp-json${cleanEndpoint}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: wpAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.error || `WordPress API chyba (${response.status})`;
    const error = new Error(message) as Error & { status?: number; details?: any };
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data as T;
}

function claimMeta(claim: Claim, sessionEmail: string) {
  const meta: Record<string, string | number> = {
    tm_claim_id: claim.id,
    tm_claim_status: claim.status,
    tm_customer_id: claim.customer_id,
    tm_customer_email: sessionEmail,
    tm_order_id: claim.order_id,
    tm_order_number: claim.order_number,
    tm_product_id: claim.product_id,
    tm_product_name: claim.product_name,
    tm_product_sku: claim.product_sku || "",
    tm_claim_reason: claim.reason,
    tm_claim_message: claim.message,
    tm_created_at: claim.created_at,

    // Najčastejšie názvy polí používané vo vlastných CPT reklamáciách.
    claim_number: claim.id,
    cislo_reklamacie: claim.id,
    rma_number: claim.id,
    customer_email: sessionEmail,
    zakaznik_email: sessionEmail,
    order_number: claim.order_number,
    objednavka: claim.order_number,
    product: claim.product_name,
    tovar: claim.product_name,
    sku: claim.product_sku || "",
    reason: claim.reason,
    dovod: claim.reason,
    status: STATUS_LABELS[claim.status] || "Prijatá",
    stav_reklamacie: STATUS_LABELS[claim.status] || "Prijatá",
  };
  return meta;
}

async function createWooClaimPost(claim: Claim, sessionEmail: string) {
  const title = `${claim.id} – ${claim.product_name}`;
  const content = [
    `Číslo reklamácie: ${claim.id}`,
    `Zákazník: ${sessionEmail}`,
    `Objednávka: ${claim.order_number}`,
    `Produkt: ${claim.product_name}`,
    `SKU: ${claim.product_sku || "-"}`,
    `Dôvod: ${claim.reason}`,
    "",
    "Popis:",
    claim.message,
  ].join("\n");

  const body = {
    title,
    status: "publish",
    content,
    meta: claimMeta(claim, sessionEmail),
  };

  const endpoints = ["/wp/v2/ciq_reclamation", "/wp/v2/ciq_reclamations", "/wp/v2/reklamacie", "/wp/v2/reklamacia"];
  let lastError: any = null;
  for (const endpoint of endpoints) {
    try {
      return await wpRequest(endpoint, { method: "POST", body });
    } catch (error: any) {
      lastError = error;
      if (![404, 401, 403].includes(Number(error?.status || 0))) break;
    }
  }
  throw lastError || new Error("Nepodarilo sa vytvoriť reklamáciu vo Woo/WordPress.");
}

function makeClaimId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = Math.floor(1000 + Math.random() * 9000);
  return `R${y}${m}${d}-${r}`;
}

function normalizeClaims(value: any, customerId: number): Claim[] {
  const claims = parseJsonMeta<Claim[]>(value, []);
  if (!Array.isArray(claims)) return [];
  return claims
    .filter((claim) => claim && Number(claim.customer_id || customerId) === customerId && clean(claim.id))
    .map((claim) => ({
      id: clean(claim.id),
      customer_id: customerId,
      order_id: Number(claim.order_id || 0),
      order_number: clean(claim.order_number),
      product_id: Number(claim.product_id || 0),
      product_name: clean(claim.product_name) || "Produkt",
      product_sku: clean(claim.product_sku),
      reason: clean(claim.reason) || "Iný dôvod",
      message: clean(claim.message),
      status: (["received", "checking", "approved", "resolved"].includes(clean(claim.status)) ? clean(claim.status) : "received") as ClaimStatus,
      created_at: clean(claim.created_at) || new Date().toISOString(),
      updated_at: clean(claim.updated_at) || clean(claim.created_at) || new Date().toISOString(),
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function claimToPublic(claim: Claim) {
  return {
    ...claim,
    status_label: STATUS_LABELS[claim.status] || "Prijatá",
  };
}

function orderToPublic(order: any) {
  return {
    id: Number(order.id || 0),
    number: clean(order.number || order.id),
    date_created: clean(order.date_created),
    status: clean(order.status),
    total: clean(order.total),
    items: Array.isArray(order.line_items)
      ? order.line_items.map((item: any) => ({
          id: Number(item.id || 0),
          product_id: Number(item.product_id || 0),
          variation_id: Number(item.variation_id || 0),
          name: clean(item.name),
          sku: clean(item.sku),
          quantity: Number(item.quantity || 1),
        })).filter((item: any) => item.product_id && item.name)
      : [],
  };
}

async function readData(customerId: number) {
  const [customer, orders] = await Promise.all([
    getWooCustomerById(customerId),
    getWooCustomerOrders(customerId, 50),
  ]);
  if (!customer) throw new Error("Zákazník neexistuje.");
  const claims = normalizeClaims(getCustomerMeta(customer, CLAIMS_META_KEY), customerId);
  return {
    customer,
    orders: (orders || []).map(orderToPublic).filter((order: any) => order.items.length),
    claims,
  };
}

export const GET: APIRoute = async ({ cookies }) => {
  const session = readCustomerSession(cookies);
  if (!session) return json({ ok: false, error: "Neprihlásený zákazník." }, 401);

  try {
    const data = await readData(session.id);
    return json({
      ok: true,
      orders: data.orders,
      claims: data.claims.map(claimToPublic),
    });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Reklamácie sa nepodarilo načítať." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = readCustomerSession(cookies);
  if (!session) return json({ ok: false, error: "Neprihlásený zákazník." }, 401);

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Neplatné dáta reklamácie." }, 400);
  }

  const orderId = Number(body?.order_id || 0);
  const productId = Number(body?.product_id || 0);
  const reason = clean(body?.reason);
  const message = clean(body?.message);

  if (!orderId) return json({ ok: false, error: "Vyberte objednávku." }, 400);
  if (!productId) return json({ ok: false, error: "Vyberte produkt." }, 400);
  if (!reason) return json({ ok: false, error: "Vyberte dôvod reklamácie." }, 400);
  if (message.length < 8) return json({ ok: false, error: "Popíšte problém aspoň jednou vetou." }, 400);

  try {
    const data = await readData(session.id);
    const order = data.orders.find((item: any) => Number(item.id) === orderId);
    if (!order) return json({ ok: false, error: "Objednávka nepatrí k vášmu účtu." }, 403);

    const product = order.items.find((item: any) => Number(item.product_id) === productId || Number(item.variation_id) === productId);
    if (!product) return json({ ok: false, error: "Produkt nepatrí k vybranej objednávke." }, 400);

    const now = new Date().toISOString();
    const claim: Claim = {
      id: makeClaimId(),
      customer_id: session.id,
      order_id: order.id,
      order_number: order.number,
      product_id: product.product_id || product.variation_id,
      product_name: product.name,
      product_sku: product.sku,
      reason,
      message,
      status: "received",
      created_at: now,
      updated_at: now,
    };

    const claims = [claim, ...data.claims].slice(0, 100);
    let wooClaimPost: any = null;
    try {
      wooClaimPost = await createWooClaimPost(claim, session.email);
    } catch (error: any) {
      console.error("Woo reklamácia CPT error:", error?.message || error);
    }

    await updateWooCustomer(session.id, {
      meta_data: [
        ...TONERYMAXIM_META_DATA,
        { key: CLAIMS_META_KEY, value: JSON.stringify(claims) },
      ],
    });

    const subject = `Nová reklamácia ${claim.id} | ToneryMAXIM.sk`;
    const adminEmail = String(import.meta.env.MAIL_TO || import.meta.env.MAIL_FROM || import.meta.env.SMTP_USER || "").trim();
    const text = `Nová reklamácia\n\nČíslo: ${claim.id}\nZákazník: ${session.email}\nObjednávka: ${claim.order_number}\nProdukt: ${claim.product_name}\nSKU: ${claim.product_sku || "-"}\nDôvod: ${claim.reason}\n\nPopis:\n${claim.message}`;

    await Promise.allSettled([
      adminEmail ? sendMail({ to: adminEmail, subject, text, replyTo: session.email }) : Promise.resolve(),
      sendMail({
        to: session.email,
        subject: `Reklamáciu ${claim.id} sme prijali | ToneryMAXIM.sk`,
        text: `Dobrý deň,\n\nreklamáciu ${claim.id} k objednávke ${claim.order_number} sme prijali.\n\nProdukt: ${claim.product_name}\nDôvod: ${claim.reason}\n\nPo kontrole vás budeme kontaktovať e-mailom.\n\nToneryMAXIM.sk`,
      }),
    ]);

    return json({ ok: true, claim: { ...claimToPublic(claim), woo_claim_id: wooClaimPost?.id || null } });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Reklamáciu sa nepodarilo odoslať." }, 500);
  }
};
