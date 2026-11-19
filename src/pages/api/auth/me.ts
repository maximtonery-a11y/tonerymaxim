import type { APIRoute } from "astro";
import { clearCustomerCookie, readCustomerSession, setCustomerCookie } from "../../../lib/auth-session";
import { loyaltyDiscountFromPoints, LOYALTY_META_POINTS } from "../../../lib/loyalty";
import { getCustomerMeta, getWooCustomerById } from "../../../lib/woo-client";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = readCustomerSession(cookies);
  if (!session) {
    return new Response(JSON.stringify({ ok: false, customer: null }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const customer = await getWooCustomerById(session.id);
  if (!customer) {
    clearCustomerCookie(cookies);
    return new Response(JSON.stringify({ ok: false, customer: null }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  setCustomerCookie(cookies, customer);
  const welcomeExpires = Date.parse(String(getCustomerMeta(customer, "tm_welcome_discount_expires") || ""));
  const welcomeAvailable = welcomeExpires > Date.now()
    && String(getCustomerMeta(customer, "tm_welcome_discount_used") || "no").toLowerCase() !== "yes";
  const cartPreview = {
    discountValue: loyaltyDiscountFromPoints(Number(getCustomerMeta(customer, LOYALTY_META_POINTS))),
    welcome: welcomeAvailable ? { expiresAt: welcomeExpires, percent: Number(getCustomerMeta(customer, "tm_welcome_discount_percent")) || 5 } : null,
    expiresAt: Date.now() + 60_000,
  };
  return new Response(JSON.stringify({ ok: true, customer, cartPreview }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
