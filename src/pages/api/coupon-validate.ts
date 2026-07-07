import type { APIRoute } from "astro";
import { readCustomerSession } from "../../lib/auth-session";
import { validateCheckoutCoupon } from "../../lib/coupons";

function normalizePrice(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function normalizeQty(value: unknown) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number) || number < 1) return 1;
  if (number > 99) return 99;
  return number;
}

function normalizeCart(cart: any[]) {
  return cart.map((item, index) => ({
    id: String(item.id || item.sku || item.name || index),
    sku: String(item.sku || item.id || ""),
    name: String(item.name || item.sku || item.id || `Produkt ${index + 1}`).slice(0, 128),
    price: normalizePrice(item.price),
    qty: normalizeQty(item.qty ?? item.quantity ?? 1),
    product_type_key: String(item.product_type_key || item.productTypeKey || ""),
    product_type_label: String(item.product_type_label || item.productTypeLabel || ""),
  })).filter((item) => item.name && item.price > 0 && item.qty > 0);
}

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = readCustomerSession(cookies);
    const body = await request.json().catch(() => ({}));
    const cart = normalizeCart(Array.isArray(body.cart) ? body.cart : []);
    const result = await validateCheckoutCoupon(session?.id, body.code, cart);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, code: "", reason: error?.message || "Kupón sa nepodarilo overiť." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};
