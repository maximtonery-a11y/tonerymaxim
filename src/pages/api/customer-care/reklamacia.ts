import type { APIRoute } from "astro";
import { sanitizeCustomerCarePayload, validateCustomerCarePayload } from "../../../lib/customer-care";
import { ClaimInputError, resolvePublicClaim, submitOnlineClaim } from "../../../lib/online-claims";

export const prerender = false;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ ok: false, error: "Neplatné dáta reklamácie." }, 400);
    const contact = sanitizeCustomerCarePayload(input);
    const error = validateCustomerCarePayload("reklamacia", contact);
    if (error) return json({ ok: false, error }, 400);
    const { payload, displayOrderNumber } = await resolvePublicClaim(contact);
    contact.product = payload.product_name;
    contact.orderNumber = payload.order_number;
    const result = await submitOnlineClaim(`public:${contact.email}`, input.submissionId, contact, payload, displayOrderNumber);
    // Public callers receive only their receipt, never WordPress/internal notes.
    return json({ ok: result.ok, caseNumber: result.caseNumber, wooSaved: result.wooSaved, emailSent: result.emailSent, emailPending: result.emailPending });
  } catch (error) {
    const known = error instanceof ClaimInputError;
    return json({ ok: false, error: known ? error.message : "Reklamáciu sa nepodarilo odoslať. Skúste rovnaké podanie zopakovať." }, known ? error.status : 500);
  }
};
