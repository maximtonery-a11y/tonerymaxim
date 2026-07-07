import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";
import { getCustomerLoyalty } from "../../../lib/loyalty";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = readCustomerSession(cookies);
  if (!session?.id) {
    return new Response(JSON.stringify({ ok: false, points: 0, discountValue: 0 }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const loyalty = await getCustomerLoyalty(session.id);
  return new Response(JSON.stringify({ ok: true, ...loyalty }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
