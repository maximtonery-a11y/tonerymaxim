import type { APIRoute } from "astro";
import { createWooCustomer, findWooCustomerByEmail } from "../../../lib/woo-client";
import { setCustomerCookie } from "../../../lib/auth-session";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const password2 = String(body.password2 || "");
    const consent = Boolean(body.consent);

    if (!firstName) return json({ ok: false, error: "Vyplňte meno." }, 400);
    if (!lastName) return json({ ok: false, error: "Vyplňte priezvisko." }, 400);
    if (!email || !email.includes("@")) return json({ ok: false, error: "Zadajte platný e-mail." }, 400);
    if (password.length < 8) return json({ ok: false, error: "Heslo musí mať aspoň 8 znakov." }, 400);
    if (password !== password2) return json({ ok: false, error: "Heslá sa nezhodujú." }, 400);
    if (!consent) return json({ ok: false, error: "Pre registráciu je potrebný súhlas so spracovaním osobných údajov." }, 400);

    const existing = await findWooCustomerByEmail(email);
    if (existing) return json({ ok: false, error: "Účet s týmto e-mailom už existuje. Prihláste sa." }, 409);

    const customer = await createWooCustomer({
      email,
      password,
      first_name: firstName,
      last_name: lastName,
    });

    setCustomerCookie(cookies, customer);

    return json({
      ok: true,
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
      },
      redirect: "/ucet?registered=1",
    });
  } catch (error: any) {
    const message = error?.message || "Registráciu sa nepodarilo dokončiť.";
    return json({ ok: false, error: message, code: error?.code || null }, error?.status || 500);
  }
};
