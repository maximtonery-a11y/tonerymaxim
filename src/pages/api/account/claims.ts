import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";
import { getWooCustomerById, getWooCustomerOrders, getWooAuthHeader } from "../../../lib/woo-client";
import { sendMail } from "../../../lib/mail";

export const prerender = false;

type ClaimStatus = "received" | "checking" | "approved" | "rejected" | "resolved";
type ClaimDecision = "approved" | "rejected" | "";

type Claim = {
  id: string;
  wp_id?: number | null;
  customer_id: number;
  order_id: number;
  order_number: string;
  product_id: number;
  product_name: string;
  product_sku?: string;
  reason: string;
  message: string;
  admin_comment?: string;
  admin_notes?: Array<{ created_at: string; author: string; message: string }>;
  status: ClaimStatus;
  status_label?: string;
  decision?: ClaimDecision;
  created_at: string;
  updated_at: string;
};

const STATUS_LABELS: Record<ClaimStatus, string> = {
  received: "Prijatá",
  checking: "Kontrolujeme",
  approved: "Schválená",
  rejected: "Neschválená",
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

function wooBaseUrl(): string {
  const raw = clean(import.meta.env.WOO_URL || import.meta.env.WP_URL || import.meta.env.WORDPRESS_URL);
  if (!raw) throw new Error("Chýba WOO_URL v .env");
  return raw.replace(/\/$/, "");
}

async function tmClaimsRequest<T = any>(endpoint: string, options: { method?: string; body?: any; query?: Record<string, any> } = {}): Promise<T> {
  const url = new URL(`${wooBaseUrl()}/wp-json/tonerymaxim/v1${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`);
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

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || `WordPress reklamácie API chyba (${response.status})`);
  }
  return data as T;
}

function makeClaimId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = Math.floor(1000 + Math.random() * 9000);
  return `R${y}${m}${d}-${r}`;
}

function normalizeStatus(value: unknown): ClaimStatus {
  const status = clean(value);
  return (["received", "checking", "approved", "rejected", "resolved"].includes(status) ? status : "received") as ClaimStatus;
}

function normalizeDecision(value: unknown, status: ClaimStatus): ClaimDecision {
  const decision = clean(value);
  if (decision === "approved" || decision === "rejected") return decision;
  if (status === "approved" || status === "rejected") return status;
  return "";
}

function claimToPublic(claim: any): Claim {
  const status = normalizeStatus(claim?.status);
  return {
    id: clean(claim?.id || claim?.claim_number),
    wp_id: Number(claim?.wp_id || 0) || null,
    customer_id: Number(claim?.customer_id || 0),
    order_id: Number(claim?.order_id || 0),
    order_number: clean(claim?.order_number),
    product_id: Number(claim?.product_id || 0),
    product_name: clean(claim?.product_name) || "Produkt",
    product_sku: clean(claim?.product_sku),
    reason: clean(claim?.reason) || "Iný dôvod",
    message: clean(claim?.message),
    admin_comment: clean(claim?.admin_comment),
    admin_notes: Array.isArray(claim?.admin_notes) ? claim.admin_notes : [],
    status,
    decision: normalizeDecision(claim?.decision, status),
    status_label: clean(claim?.status_label) || STATUS_LABELS[status] || "Prijatá",
    created_at: clean(claim?.created_at) || new Date().toISOString(),
    updated_at: clean(claim?.updated_at) || clean(claim?.created_at) || new Date().toISOString(),
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
        })).filter((item: any) => (item.product_id || item.variation_id) && item.name)
      : [],
  };
}

async function readData(customerId: number, customerEmail: string) {
  const [customer, orders, claimsResponse] = await Promise.all([
    getWooCustomerById(customerId),
    getWooCustomerOrders(customerId, 50),
    tmClaimsRequest<{ ok: boolean; claims: any[] }>("/reklamacie", { query: { customer_id: customerId, customer_email: customerEmail } }),
  ]);

  if (!customer) throw new Error("Zákazník neexistuje.");

  return {
    customer,
    orders: (orders || []).map(orderToPublic).filter((order: any) => order.items.length),
    claims: (Array.isArray(claimsResponse?.claims) ? claimsResponse.claims : [])
      .map(claimToPublic)
      .sort((a: Claim, b: Claim) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  };
}

export const GET: APIRoute = async ({ cookies }) => {
  const session = readCustomerSession(cookies);
  if (!session) return json({ ok: false, error: "Neprihlásený zákazník." }, 401);

  try {
    const data = await readData(session.id, session.email);
    return json({
      ok: true,
      orders: data.orders,
      claims: data.claims,
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
    const data = await readData(session.id, session.email);
    const order = data.orders.find((item: any) => Number(item.id) === orderId);
    if (!order) return json({ ok: false, error: "Objednávka nepatrí k vášmu účtu." }, 403);

    const product = order.items.find((item: any) => Number(item.product_id) === productId || Number(item.variation_id) === productId);
    if (!product) return json({ ok: false, error: "Produkt nepatrí k vybranej objednávke." }, 400);

    const claimPayload = {
      claim_number: makeClaimId(),
      customer_id: session.id,
      customer_email: session.email,
      order_id: order.id,
      order_number: order.number,
      product_id: product.product_id || product.variation_id,
      product_name: product.name,
      product_sku: product.sku,
      reason,
      message,
      status: "received",
    };

    const created = await tmClaimsRequest<{ ok: boolean; claim: any }>("/reklamacie", {
      method: "POST",
      body: claimPayload,
    });
    const claim = claimToPublic(created?.claim || claimPayload);

    const subject = `Nová reklamácia ${claim.id} | ToneryMAXIM.sk`;
    const adminEmail = clean(import.meta.env.MAIL_TO || import.meta.env.MAIL_FROM || import.meta.env.SMTP_USER);
    const text = `Nová reklamácia\n\nČíslo: ${claim.id}\nZákazník: ${session.email}\nObjednávka: ${claim.order_number}\nProdukt: ${claim.product_name}\nSKU: ${claim.product_sku || "-"}\nDôvod: ${claim.reason}\n\nPopis:\n${claim.message}`;

    await Promise.allSettled([
      adminEmail ? sendMail({ to: adminEmail, subject, text, replyTo: session.email }) : Promise.resolve(),
      sendMail({
        to: session.email,
        subject: `Reklamáciu ${claim.id} sme prijali | ToneryMAXIM.sk`,
        text: `Dobrý deň,\n\nreklamáciu ${claim.id} k objednávke ${claim.order_number} sme prijali.\n\nProdukt: ${claim.product_name}\nDôvod: ${claim.reason}\n\nPo kontrole vás budeme kontaktovať e-mailom.\n\nToneryMAXIM.sk`,
      }),
    ]);

    return json({ ok: true, claim });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Reklamáciu sa nepodarilo odoslať." }, 500);
  }
};
