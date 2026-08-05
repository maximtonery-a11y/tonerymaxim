import type { APIRoute } from "astro";
import { clearCustomerCookie } from "../../../lib/auth-session";

export const prerender = false;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: false, error: "Použite bezpečné odhlásenie tlačidlom v účte." }), {
    status: 405,
    headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "POST", "Cache-Control": "no-store" },
  });
};

export const POST: APIRoute = async ({ cookies }) => {
  clearCustomerCookie(cookies);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
