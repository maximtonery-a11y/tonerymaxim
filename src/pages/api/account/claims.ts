import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";
import { getWooCustomerById, getWooCustomerOrders, wooRequest } from "../../../lib/woo-client";
import { sanitizeCustomerCarePayload } from "../../../lib/customer-care";
import { getAccountOrderNumbers } from "../../../lib/account-orders";
import { tmOrderNumber } from "../../../lib/order-display";
import { ClaimInputError, claimMessageWithContact, claimsRequest, displayClaimNumber, displayClaimOrderNumber, pendingCustomerClaims, submitOnlineClaim } from "../../../lib/online-claims";

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

function claimToPublic(claim: any, tmNumber: string): Claim {
  const status = normalizeStatus(claim?.status);
  return {
    id: displayClaimNumber(claim) || clean(claim?.id || claim?.claim_number),
    wp_id: Number(claim?.wp_id || 0) || null,
    customer_id: Number(claim?.customer_id || 0),
    order_id: Number(claim?.order_id || 0),
    order_number: tmNumber,
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
    number: tmOrderNumber(order),
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

async function readData(customerId: number) {
  const customer = await getWooCustomerById(customerId);
  if (!customer) throw new Error("Zákazník neexistuje.");
  const [orders, claimsResponse, pendingClaims] = await Promise.all([
    getWooCustomerOrders(customerId, 50),
    claimsRequest("/reklamacie", { query: { customer_id: customerId } }),
    pendingCustomerClaims(customerId),
  ]);

  const claims = [...claimsResponse.claims, ...pendingClaims.filter((pending: any) => !claimsResponse.claims.some((claim: any) => (claim.id || claim.claim_number) === pending.id))];
  const numbers = await getAccountOrderNumbers(customerId, claims.map(claim => Number(claim.order_id)), orders);
  return {
    customer,
    orders: orders.filter(order => Number(order.customer_id) === customerId).map(orderToPublic).filter(order => order.items.length),
    claims: claims.map(claim => claimToPublic(claim, numbers.get(Number(claim.order_id)) || ""))
      .sort((a: Claim, b: Claim) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
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
      claims: data.claims,
    });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Reklamácie sa nepodarilo načítať." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = readCustomerSession(cookies);
  if (!session) return json({ ok: false, error: "Neprihlásený zákazník." }, 401);
  let body: any;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Neplatné dáta reklamácie." }, 400); }
  const orderId = Number(body?.order_id || 0);
  const productId = Number(body?.product_id || 0);
  const reason = clean(body?.reason).slice(0, 300);
  const message = clean(body?.message).slice(0, 3000);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return json({ ok: false, error: "Vyberte objednávku." }, 400);
  if (!Number.isSafeInteger(productId) || productId <= 0) return json({ ok: false, error: "Vyberte produkt." }, 400);
  if (!reason) return json({ ok: false, error: "Vyberte dôvod reklamácie." }, 400);
  if (message.length < 8) return json({ ok: false, error: "Popíšte problém aspoň jednou vetou." }, 400);
  try {
    // Fetch this order directly: ownership does not depend on the first 50 orders.
    const [customer, order] = await Promise.all([
      getWooCustomerById(session.id), wooRequest<any>(`/orders/${orderId}`),
    ]);
    if (!customer || Number(order?.customer_id) !== session.id) return json({ ok: false, error: "Objednávka nepatrí k vášmu účtu." }, 403);
    const product = order.line_items?.find((item: any) => Number(item.product_id) === productId || Number(item.variation_id) === productId);
    if (!product) return json({ ok: false, error: "Produkt nepatrí k vybranej objednávke." }, 400);
    const tmNumber = tmOrderNumber(order);
    const contact = sanitizeCustomerCarePayload({
      orderNumber: displayClaimOrderNumber(order), email: customer.email,
      name: [customer.first_name || customer.billing?.first_name, customer.last_name || customer.billing?.last_name].filter(Boolean).join(' ') || customer.email,
      phone: customer.billing?.phone, product: product.name, reason, message,
    });
    const result = await submitOnlineClaim(`account:${session.id}`, body?.submissionId, contact, {
      customer_id: session.id, customer_email: contact.email, order_id: orderId, order_number: contact.orderNumber,
      product_id: Number(product.product_id || product.variation_id), product_name: clean(product.name),
      product_sku: clean(product.sku), reason: contact.reason, message: claimMessageWithContact(contact), status: 'received',
    });
    return json({ ...result, claim: claimToPublic(result.claim, tmNumber) });
  } catch (error) {
    const known = error instanceof ClaimInputError;
    return json({ ok: false, error: known ? error.message : "Reklamáciu sa nepodarilo odoslať. Skúste rovnaké podanie zopakovať." }, known ? error.status : 500);
  }
};
