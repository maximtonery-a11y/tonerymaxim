import type { APIRoute } from "astro";
import { createWooCustomer, findWooCustomerByEmail, TONERYMAXIM_META_DATA } from "../../../lib/woo-client";
import { setCustomerCookie } from "../../../lib/auth-session";
import { sendWelcomeEmail } from "../../../lib/mail";
import { STOREFRONT_ORIGIN } from "../../../lib/storefront-url";

export const prerender = false;

function addDaysIso(date: Date, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString();
}

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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ ok: false, error: "Zadajte platný e-mail." }, 400);
    if (password.length < 12 || password.length > 128) return json({ ok: false, error: "Heslo musí mať 12 až 128 znakov." }, 400);
    if (password !== password2) return json({ ok: false, error: "Heslá sa nezhodujú." }, 400);
    if (!consent) return json({ ok: false, error: "Pred registráciou potvrďte oboznámenie so zásadami ochrany osobných údajov." }, 400);

    const existing = await findWooCustomerByEmail(email);
    if (existing) return json({ ok: false, error: "Účet s týmto e-mailom už existuje. Prihláste sa." }, 409);

    const customer = await createWooCustomer({
      email,
      password,
      first_name: firstName,
      last_name: lastName,
      meta_data: [
        ...TONERYMAXIM_META_DATA,
        { key: "tm_welcome_discount_percent", value: "5" },
        { key: "tm_welcome_discount_expires", value: addDaysIso(new Date(), 30) },
        { key: "tm_welcome_discount_used", value: "no" },
        { key: "tm_loyalty_points", value: "0" },
        { key: "tm_loyalty_history", value: "[]" },
      ],
    });

    let emailSent = true;
    try {
      await sendWelcomeEmail({
        email,
        firstName,
        siteUrl: STOREFRONT_ORIGIN,
      });
    } catch (mailError) {
      emailSent = false;
      console.error("ToneryMAXIM welcome email failed:", mailError);
    }

    setCustomerCookie(cookies, customer);

    return json({
      ok: true,
      emailSent,
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
