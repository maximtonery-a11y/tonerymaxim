import type { APIRoute } from "astro";
import { PUT as updatePlan } from "./saved-printers";
import { bratislavaDay } from "../../../lib/toner-care-rules";

export const prerender = false;

// Native form fallback uses the same authenticated validation/write path as AJAX.
// Middleware applies the same Origin and rate checks as other account mutations.
export const POST: APIRoute = async (context) => {
  const fields = await context.request.formData().catch(() => null);
  if (!fields) return new Response("Neplatný formulár.", { status: 400 });
  const action = String(fields.get("action") || "");
  const body = {
    title: String(fields.get("title") || ""),
    action: action === "disable" ? "disable" : undefined,
    care_enabled: action === "replaced" || fields.get("care_enabled") === "on",
    installed_at: action === "replaced" ? bratislavaDay() : String(fields.get("installed_at") || ""),
    expected_months: Number(fields.get("expected_months") || 3),
    preferred_type: String(fields.get("preferred_type") || "any"),
  };
  const response = await updatePlan({ ...context, request: new Request(context.request.url, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) });
  const result = await response.json().catch(() => ({}));
  const returnTo = fields.get("return_to") === "/ucet/tlaciarne" ? "/ucet/tlaciarne" : "/ucet/upozornenia";
  const target = new URL(returnTo, context.request.url);
  if (response.ok && result.ok) target.searchParams.set("saved", "1");
  else target.searchParams.set("error", String(result.error || "Nastavenie sa nepodarilo uložiť.").slice(0, 300));
  return new Response(null, { status: 303, headers: { Location: target.pathname + target.search, "Cache-Control": "no-store" } });
};
