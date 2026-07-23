import type { APIRoute } from "astro";
import { clearCustomerCookie } from "../../../lib/auth-session";

export const prerender = false;

export const GET: APIRoute = async ({ cookies, redirect }) => {
  clearCustomerCookie(cookies);
  return redirect("/prihlasenie?logout=1");
};

export const POST: APIRoute = async ({ cookies }) => {
  clearCustomerCookie(cookies);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
