import type { APIRoute } from "astro";
import { findWooCustomerByEmail, requestWordPressPasswordReset } from "../../../lib/woo-client";

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
    const email = String(body.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return json({ ok: false, error: "Zadajte platný e-mail." }, 400);
    }

    const customer = await findWooCustomerByEmail(email).catch(() => null);

    if (customer) {
      await requestWordPressPasswordReset(email);
    }

    return json({
      ok: true,
      message: "Ak účet s týmto e-mailom existuje, poslali sme vám odkaz na obnovu hesla.",
    });
  } catch (error: any) {
    return json({
      ok: false,
      error: error?.message || "Obnovu hesla sa nepodarilo odoslať.",
    }, 500);
  }
};
