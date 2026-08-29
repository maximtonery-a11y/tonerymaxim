import type { APIRoute } from "astro";
import { clearCustomerCookie } from "../../../lib/auth-session";

export const prerender = false;

const ALLOWED_ORIGINS = new Set([
  "https://tonerymaxim.sk",
  "https://www.tonerymaxim.sk",
  "https://tonerymaxim.info",
  "https://www.tonerymaxim.info",
]);

function isAllowedOrigin(request: Request): boolean {
  const raw = String(request.headers.get("origin") || "").trim();
  if (ALLOWED_ORIGINS.has(raw)) return true;
  try {
    const origin = new URL(raw);
    return ["localhost", "127.0.0.1", "::1"].includes(origin.hostname);
  } catch {
    return false;
  }
}

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: false, error: "Použite bezpečné odhlásenie tlačidlom v účte." }), {
    status: 405,
    headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "POST", "Cache-Control": "no-store" },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAllowedOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, error: "Neplatný pôvod požiadavky." }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  clearCustomerCookie(cookies);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
