import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";
import { getHiddenRecentProductKeys, getWooCustomerById, saveHiddenRecentProductKeys } from "../../../lib/woo-client";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = readCustomerSession(cookies);
  if (!session?.id) return json({ ok: false, error: "Nie ste prihlásený." }, 401);

  const customer = await getWooCustomerById(session.id);
  if (!customer) return json({ ok: false, error: "Zákaznícky účet sa nenašiel." }, 404);

  const body = await request.json().catch(() => ({}));
  const key = String(body.key || "").trim();
  if (!key) return json({ ok: false, error: "Chýba produkt." }, 400);

  const hidden = getHiddenRecentProductKeys(customer);
  await saveHiddenRecentProductKeys(customer.id, [...hidden, key]);

  return json({ ok: true });
};
