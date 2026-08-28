import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";
import { updateWooCustomerPassword, verifyWordPressLogin } from "../../../lib/woo-client";
import { sendPasswordChangedEmail } from "../../../lib/mail";
import { storefrontUrl } from "../../../lib/storefront-url";

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
    const currentPassword = String(body.current_password || "");
    const password = String(body.password || "");
    const password2 = String(body.password2 || "");

    if (!currentPassword) return json({ ok: false, error: "Zadajte aktuálne heslo." }, 400);
    if (password.length < 12 || password.length > 128) return json({ ok: false, error: "Nové heslo musí mať 12 až 128 znakov." }, 400);
    if (password !== password2) return json({ ok: false, error: "Nové heslá sa nezhodujú." }, 400);

    const verified = await verifyWordPressLogin(session.email, currentPassword);
    if (!verified) return json({ ok: false, error: "Aktuálne heslo nie je správne." }, 401);

    await updateWooCustomerPassword(session.id, password);
    await sendPasswordChangedEmail({
      email: session.email,
      loginUrl: storefrontUrl("/prihlasenie"),
    });

    return json({ ok: true, message: "Heslo bolo zmenené." });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Heslo sa nepodarilo zmeniť." }, error?.status || 500);
  }
};
