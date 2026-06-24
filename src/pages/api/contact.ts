import type { APIRoute } from "astro";
import { sendMail } from "../../lib/mail";

const CONTACT_TO = "info@tonerymaxim.sk";

function clean(value: FormDataEntryValue | null): string {
  return String(value || "").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const name = clean(form.get("name"));
    const email = clean(form.get("email"));
    const phone = clean(form.get("phone"));
    const order = clean(form.get("order"));
    const type = clean(form.get("type")) || "Kontakt";
    const message = clean(form.get("message"));
    const privacy = clean(form.get("privacy"));

    if (!name || !email || !message || !privacy) {
      return new Response(JSON.stringify({ message: "Vyplňte meno, e-mail, správu a súhlas so spracovaním údajov." }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ message: "Zadajte platnú e-mailovú adresu." }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const subject = `${type} | ToneryMaxim.sk${order ? ` | objednávka ${order}` : ""}`;
    const text = [
      `Nová správa z ToneryMaxim.sk`,
      "",
      `Typ: ${type}`,
      `Meno: ${name}`,
      `E-mail: ${email}`,
      `Telefón: ${phone || "neuvedený"}`,
      `Objednávka: ${order || "neuvedená"}`,
      "",
      "Správa:",
      message,
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:680px;margin:0 auto;padding:24px">
        <h1 style="font-size:22px;margin:0 0 18px">Nová správa z ToneryMaxim.sk</h1>
        <table style="width:100%;border-collapse:collapse;margin:0 0 22px">
          <tr><td style="padding:8px 0;color:#64748b;width:150px">Typ</td><td style="padding:8px 0;font-weight:700">${escapeHtml(type)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Meno</td><td style="padding:8px 0;font-weight:700">${escapeHtml(name)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">E-mail</td><td style="padding:8px 0;font-weight:700">${escapeHtml(email)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Telefón</td><td style="padding:8px 0">${escapeHtml(phone || "neuvedený")}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Objednávka</td><td style="padding:8px 0">${escapeHtml(order || "neuvedená")}</td></tr>
        </table>
        <div style="background:#f4f8fd;border:1px solid #dfe8f5;border-radius:16px;padding:18px;white-space:pre-wrap">${escapeHtml(message)}</div>
      </div>`;

    await sendMail({ to: CONTACT_TO, subject, text, html, replyTo: email });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return new Response(JSON.stringify({ message: "Správu sa nepodarilo odoslať. Skúste to prosím neskôr alebo napíšte priamo na info@tonerymaxim.sk." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
