import type { APIRoute } from "astro";
import { readCustomerSession, setCustomerCookie } from "../../../lib/auth-session";
import { updateWooCustomer } from "../../../lib/woo-client";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function cleanAddress(input: any, email: string) {
  return {
    first_name: String(input?.first_name || "").trim(),
    last_name: String(input?.last_name || "").trim(),
    company: String(input?.company || "").trim(),
    address_1: String(input?.address_1 || "").trim(),
    address_2: String(input?.address_2 || "").trim(),
    city: String(input?.city || "").trim(),
    postcode: String(input?.postcode || "").trim(),
    country: String(input?.country || "SK").trim().toUpperCase() || "SK",
    phone: String(input?.phone || "").trim(),
    email,
  };
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = readCustomerSession(cookies);
    if (!session) return json({ ok: false, error: "Neprihlásený zákazník." }, 401);

    const body = await request.json().catch(() => ({}));
    const billing = cleanAddress(body.billing || {}, session.email);
    const shipping = cleanAddress(body.shipping || {}, session.email);

    if (!billing.first_name || !billing.last_name) return json({ ok: false, error: "Vyplňte meno a priezvisko vo fakturačnej adrese." }, 400);
    if (!billing.address_1 || !billing.city || !billing.postcode) return json({ ok: false, error: "Vyplňte ulicu, mesto a PSČ vo fakturačnej adrese." }, 400);

    const customer = await updateWooCustomer(session.id, {
      billing,
      shipping: {
        first_name: shipping.first_name || billing.first_name,
        last_name: shipping.last_name || billing.last_name,
        company: shipping.company,
        address_1: shipping.address_1 || billing.address_1,
        address_2: shipping.address_2,
        city: shipping.city || billing.city,
        postcode: shipping.postcode || billing.postcode,
        country: shipping.country || billing.country,
        phone: shipping.phone || billing.phone,
      },
      meta_data: [
        { key: "source", value: "tonerymaxim" },
        { key: "sales_channel", value: "tonerymaxim" },
      ],
    });

    setCustomerCookie(cookies, customer);
    return json({ ok: true, message: "Adresy boli uložené.", customer });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Adresy sa nepodarilo uložiť." }, error?.status || 500);
  }
};
