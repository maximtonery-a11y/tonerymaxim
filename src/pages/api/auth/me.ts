import type { APIRoute } from "astro";
import { clearCustomerCookie, readCustomerSession, setCustomerCookie } from "../../../lib/auth-session";
import { getWooCustomerById } from "../../../lib/woo-client";

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
  return new Response(JSON.stringify({ ok: true, customer }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
