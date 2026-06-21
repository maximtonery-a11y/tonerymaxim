import type { APIRoute } from "astro";
import { readCustomerSession } from "../../../lib/auth-session";
import { updateWooCustomerPassword, verifyWordPressLogin } from "../../../lib/woo-client";
import { sendPasswordChangedEmail } from "../../../lib/mail";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function siteUrl(request: Request): string {
  const configured = import.meta.env.SITE_URL || import.meta.env.PUBLIC_SITE_URL;
  if (configured) return String(configured).replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
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
    if (password.length < 8) return json({ ok: false, error: "Nové heslo musí mať aspoň 8 znakov." }, 400);
    if (password !== password2) return json({ ok: false, error: "Nové heslá sa nezhodujú." }, 400);

    const verified = await verifyWordPressLogin(session.email, currentPassword);
    if (!verified) return json({ ok: false, error: "Aktuálne heslo nie je správne." }, 401);

    await updateWooCustomerPassword(session.id, password);
    await sendPasswordChangedEmail({
      email: session.email,
      loginUrl: `${siteUrl(request)}/prihlasenie`,
    });

    return json({ ok: true, message: "Heslo bolo zmenené." });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Heslo sa nepodarilo zmeniť." }, error?.status || 500);
  }
};
