import type { APIRoute } from "astro";
import { findWooCustomerByEmail, verifyWordPressLogin } from "../../../lib/woo-client";
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
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const next = String(body.next || "/novy/ucet");

    if (!email || !email.includes("@")) return json({ ok: false, error: "Zadajte platný e-mail." }, 400);
    if (!password) return json({ ok: false, error: "Zadajte heslo." }, 400);

    const verified = await verifyWordPressLogin(email, password);
    if (!verified) return json({ ok: false, error: "Nesprávny e-mail alebo heslo." }, 401);

    const customer = await findWooCustomerByEmail(email);
    if (!customer) return json({ ok: false, error: "Prihlásenie prebehlo, ale zákaznícky účet sa nenašiel vo WooCommerce." }, 404);

    setCustomerCookie(cookies, customer);

    return json({
      ok: true,
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
      },
      redirect: next.startsWith("/") ? next : "/novy/ucet",
    });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Prihlásenie sa nepodarilo." }, 500);
  }
};
