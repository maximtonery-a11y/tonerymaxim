import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";
import { getWooCustomerOrders } from "../../../lib/woo-client";

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

  const orders = await getWooCustomerOrders(session.id, 50);
  return json({ ok: true, orders });
};
