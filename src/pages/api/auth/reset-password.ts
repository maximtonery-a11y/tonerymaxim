import type { APIRoute } from "astro";
import { markWooCustomerAsToneryMaxim, updateWooCustomerPassword, getWooCustomerById } from "../../../lib/woo-client";
import { consumePasswordResetToken } from "../../../lib/password-reset";
import { sendPasswordChangedEmail } from "../../../lib/mail";
import { storefrontUrl } from "../../../lib/storefront-url";

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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    const password2 = String(body.password2 || "");

    if (!token) return json({ ok: false, error: "Odkaz na obnovu hesla je neplatný." }, 400);
    if (password.length < 12 || password.length > 128) return json({ ok: false, error: "Heslo musí mať 12 až 128 znakov." }, 400);
    if (password !== password2) return json({ ok: false, error: "Heslá sa nezhodujú." }, 400);

    const customer = await consumePasswordResetToken(token, async (payload) => {
      await markWooCustomerAsToneryMaxim(payload.customerId).catch(() => null);
      await updateWooCustomerPassword(payload.customerId, password);
      return getWooCustomerById(payload.customerId);
    });
    if (!customer) return json({ ok: false, error: "Odkaz na obnovu hesla je neplatný, použitý alebo expiroval." }, 400);
    if (customer?.email) {
      await sendPasswordChangedEmail({
        email: customer.email,
        loginUrl: storefrontUrl("/prihlasenie"),
      });
    }

    return json({
      ok: true,
      message: "Heslo bolo úspešne zmenené. Teraz sa môžete prihlásiť.",
      redirect: "/prihlasenie?password-reset=1",
    });
  } catch (error: any) {
    return json({
      ok: false,
      error: error?.message || "Heslo sa nepodarilo zmeniť.",
    }, error?.status || 500);
  }
};
