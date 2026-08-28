import type { APIRoute } from "astro";
import { findWooCustomerByEmail, markWooCustomerAsToneryMaxim } from "../../../lib/woo-client";
import { sendPasswordResetEmail } from "../../../lib/mail";
import { makePasswordResetToken } from "../../../lib/password-reset";

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

const PASSWORD_RESET_SITE_URL = "https://www.tonerymaxim.sk";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return json({ ok: false, error: "Zadajte platný e-mail." }, 400);
    }

    const customer = await findWooCustomerByEmail(email).catch(() => null);

    if (customer?.id) {
      await markWooCustomerAsToneryMaxim(customer.id).catch((error) => {
        console.error("ToneryMAXIM customer meta update failed:", error);
      });

      const token = await makePasswordResetToken(customer.id, email);
      const resetUrl = `${PASSWORD_RESET_SITE_URL}/reset-hesla?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail({ email, resetUrl });
    }

    return json({
      ok: true,
      message: "Ak účet s týmto e-mailom existuje, poslali sme vám odkaz na obnovu hesla.",
    });
  } catch (error: any) {
    console.error("ToneryMAXIM password reset email failed:", error);
    return json({
      ok: false,
      error: error?.message || "Obnovu hesla sa nepodarilo odoslať.",
    }, 500);
  }
};
