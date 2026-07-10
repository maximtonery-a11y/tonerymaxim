import type { APIRoute } from "astro";
import { buildCustomerCareHtml, buildCustomerCareText, customerCareAdminEmail, sanitizeCustomerCarePayload, saveCustomerCareCase, validateCustomerCarePayload } from "../../../lib/customer-care";
import { sendMail } from "../../../lib/mail";

export const POST: APIRoute = async ({ request }) => {
  try {
    const input = await request.json().catch(() => ({}));
    const payload = sanitizeCustomerCarePayload(input);
    const error = validateCustomerCarePayload("odstupenie", payload);
    if (error) return new Response(JSON.stringify({ ok: false, error }), { status: 400 });

    const record = await saveCustomerCareCase("odstupenie", payload, {
      userAgent: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "",
    });

    const text = buildCustomerCareText("odstupenie", record.caseNumber, payload);
    const html = buildCustomerCareHtml("odstupenie", record.caseNumber, payload);

    await Promise.allSettled([
      sendMail({ to: payload.email, subject: `Odstúpenie ${record.caseNumber} bolo prijaté | ToneryMAXIM.sk`, text, html }),
      sendMail({ to: customerCareAdminEmail(), subject: `Nové odstúpenie ${record.caseNumber}`, text, html, replyTo: payload.email }),
    ]);

    return new Response(JSON.stringify({ ok: true, caseNumber: record.caseNumber }), { status: 200 });
  } catch (error: any) {
    console.error("Customer care withdrawal error:", error?.message || error);
    return new Response(JSON.stringify({ ok: false, error: "Odstúpenie sa nepodarilo odoslať." }), { status: 500 });
  }
};
