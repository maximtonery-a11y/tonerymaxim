import type { APIRoute } from "astro";
import { updateWooCustomerPassword } from "../../../lib/woo-client";
import { verifyPasswordResetToken } from "../../../lib/password-reset";

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
    if (password.length < 8) return json({ ok: false, error: "Heslo musí mať aspoň 8 znakov." }, 400);
    if (password !== password2) return json({ ok: false, error: "Heslá sa nezhodujú." }, 400);

    const payload = verifyPasswordResetToken(token);
    if (!payload) return json({ ok: false, error: "Odkaz na obnovu hesla je neplatný alebo expiroval." }, 400);

    await updateWooCustomerPassword(payload.customerId, password);

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
