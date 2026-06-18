import type { APIRoute } from "astro";
import { sendMail } from "../../../lib/mail";

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
    const to = String(body.to || "").trim().toLowerCase();

    if (!to || !to.includes("@")) {
      return json({ ok: false, error: "Zadajte platný testovací e-mail." }, 400);
    }

    await sendMail({
      to,
      subject: "Test SMTP | ToneryMAXIM.sk",
      text: "Toto je testovací e-mail odoslaný priamo z Astro cez SMTP ToneryMAXIM.sk.",
      html: `<p>Toto je testovací e-mail odoslaný priamo z <strong>Astro</strong> cez SMTP ToneryMAXIM.sk.</p>`,
    });

    return json({ ok: true, message: "Testovací e-mail bol odoslaný." });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Testovací e-mail sa nepodarilo odoslať." }, 500);
  }
};
