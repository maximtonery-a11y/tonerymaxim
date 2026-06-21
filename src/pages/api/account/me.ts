import type { APIRoute } from "astro";
import { readCustomerSession, setCustomerCookie, clearCustomerCookie } from "../../../lib/auth-session";
import { getWooCustomerById } from "../../../lib/woo-client";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ cookies }) => {
  const session = readCustomerSession(cookies);
  if (!session) return json({ ok: false, error: "Neprihlásený zákazník." }, 401);

  const customer = await getWooCustomerById(session.id);
  if (!customer) {
    clearCustomerCookie(cookies);
    return json({ ok: false, error: "Zákazník sa vo WooCommerce nenašiel." }, 401);
  }

  setCustomerCookie(cookies, customer);
  return json({ ok: true, customer });
};
