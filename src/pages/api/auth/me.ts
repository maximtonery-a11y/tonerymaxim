import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const customer = readCustomerSession(cookies);
  return new Response(JSON.stringify({ ok: Boolean(customer), customer }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
