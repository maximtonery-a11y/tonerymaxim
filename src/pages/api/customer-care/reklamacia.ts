import type { APIRoute } from "astro";
import { deliverCustomerCareCase, sanitizeCustomerCarePayload, saveCustomerCareCase, validateCustomerCarePayload } from "../../../lib/customer-care";

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

    const delivery = await deliverCustomerCareCase(record);
    return new Response(JSON.stringify({
      ok: true, caseNumber: record.caseNumber,
      emailSent: delivery.customer,
      emailPending: !delivery.customer,
      message: delivery.customer
        ? "Podanie bolo uložené a potvrdenie odoslané."
        : "Podanie bolo bezpečne uložené. Potvrdzovací e-mail sa nepodarilo odoslať a systém ho zopakuje automaticky.",
    }), { status: 200 });
  } catch (error: any) {
    console.error("Customer care claim error:", error?.message || error);
    return new Response(JSON.stringify({ ok: false, error: "Reklamáciu sa nepodarilo odoslať." }), { status: 500 });
  }
};
