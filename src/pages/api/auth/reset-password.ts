import type { APIRoute } from "astro";
import { markWooCustomerAsToneryMaxim, updateWooCustomerPassword, getWooCustomerById } from "../../../lib/woo-client";
import { verifyPasswordResetToken } from "../../../lib/password-reset";
import { sendPasswordChangedEmail } from "../../../lib/mail";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function siteUrl(request: Request): string {
  const configured = import.meta.env.SITE_URL || import.meta.env.PUBLIC_SITE_URL;
  if (configured) return String(configured).replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    const password2 = String(body.password2 || "");

    if (!token) return json({ ok: false, error: "Odkaz na obnovu hesla je neplatný." }, 400);
    if (password.length < 8) return json({ ok: false, error: "Heslo musí mať aspoň 8 znakov." }, 400);
    if (password !== password2) return json({ ok: false, error: "Heslá sa nezhodujú." }, 400);

    const payload = verifyPasswordResetToken(token);
    if (!payload) return json({ ok: false, error: "Odkaz na obnovu hesla je neplatný alebo expiroval." }, 400);

    await markWooCustomerAsToneryMaxim(payload.customerId).catch(() => null);
    await updateWooCustomerPassword(payload.customerId, password);

    const customer = await getWooCustomerById(payload.customerId);
    if (customer?.email) {
      await sendPasswordChangedEmail({
        email: customer.email,
        loginUrl: `${siteUrl(request)}/prihlasenie`,
      });
    }

    return json({
      ok: true,
      message: "Heslo bolo úspešne zmenené. Teraz sa môžete prihlásiť.",
      redirect: "/novy/prihlasenie?password-reset=1",
    });
  } catch (error: any) {
    return json({
      ok: false,
      error: error?.message || "Heslo sa nepodarilo zmeniť.",
    }, error?.status || 500);
  }
};
