import type { APIRoute } from "astro";
import { buildCustomerCareHtml, buildCustomerCareText, customerCareAdminEmail, sanitizeCustomerCarePayload, saveCustomerCareCase, validateCustomerCarePayload } from "../../../lib/customer-care";
import { sendMail } from "../../../lib/mail";

export const POST: APIRoute = async ({ request }) => {
  try {
    const input = await request.json().catch(() => ({}));
    const payload = sanitizeCustomerCarePayload(input);
    const error = validateCustomerCarePayload("reklamacia", payload);
    if (error) return new Response(JSON.stringify({ ok: false, error }), { status: 400 });

    const record = await saveCustomerCareCase("reklamacia", payload, {
      userAgent: request.headers.get("user-agent") || "",
      referer: request.headers.get("referer") || "",
    });

    const text = buildCustomerCareText("reklamacia", record.caseNumber, payload);
    const html = buildCustomerCareHtml("reklamacia", record.caseNumber, payload);

    await Promise.allSettled([
      sendMail({ to: payload.email, subject: `Reklamácia ${record.caseNumber} bola prijatá | ToneryMAXIM.sk`, text, html }),
      sendMail({ to: customerCareAdminEmail(), subject: `Nová reklamácia ${record.caseNumber}`, text, html, replyTo: payload.email }),
    ]);

    return new Response(JSON.stringify({ ok: true, caseNumber: record.caseNumber }), { status: 200 });
  } catch (error: any) {
    console.error("Customer care claim error:", error?.message || error);
    return new Response(JSON.stringify({ ok: false, error: "Reklamáciu sa nepodarilo odoslať." }), { status: 500 });
  }
};
