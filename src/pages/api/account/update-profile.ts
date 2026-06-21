import type { APIRoute } from "astro";
import { readCustomerSession, setCustomerCookie } from "../../../lib/auth-session";
import { getWooCustomerById, updateWooCustomer } from "../../../lib/woo-client";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = readCustomerSession(cookies);
    if (!session) return json({ ok: false, error: "Neprihlásený zákazník." }, 401);

    const body = await request.json().catch(() => ({}));
    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const phone = String(body.phone || "").trim();

    if (!firstName) return json({ ok: false, error: "Zadajte meno." }, 400);
    if (!lastName) return json({ ok: false, error: "Zadajte priezvisko." }, 400);

    const current = await getWooCustomerById(session.id);
    const customer = await updateWooCustomer(session.id, {
      first_name: firstName,
      last_name: lastName,
      billing: {
        ...(current?.billing || {}),
        first_name: firstName,
        last_name: lastName,
        email: session.email,
        phone,
      },
      shipping: {
        ...(current?.shipping || {}),
        first_name: firstName,
        last_name: lastName,
      },
      meta_data: [
        { key: "source", value: "tonerymaxim" },
        { key: "sales_channel", value: "tonerymaxim" },
      ],
    });

    setCustomerCookie(cookies, customer);
    return json({ ok: true, message: "Profil bol uložený.", customer });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Profil sa nepodarilo uložiť." }, error?.status || 500);
  }
};
