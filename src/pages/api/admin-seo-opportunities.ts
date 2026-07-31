import type { APIRoute } from "astro";
import { getAdminAccessKey, isAdminLocked } from "../../lib/admin-access";
import { filterSeoOpportunities, getSeoOpportunityReport } from "../../lib/seo-opportunities";

export const prerender = false;

export const GET: APIRoute = async ({ request, url, locals }) => {
  const adminKey = getAdminAccessKey(locals);
  const suppliedKey = request.headers.get("x-admin-key") || url.searchParams.get("key") || "";
  if (isAdminLocked({ adminKey, suppliedKey, hostname: url.hostname })) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  try {
    const report = await getSeoOpportunityReport();
    const opportunities = filterSeoOpportunities(report.opportunities, {
      kind: url.searchParams.get("kind") || "all",
      status: url.searchParams.get("status") || "all",
      impact: url.searchParams.get("impact") || "all",
      query: url.searchParams.get("q") || "",
    });
    return new Response(JSON.stringify({ ok: true, ...report, opportunities }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: error?.message || "SEO Dominator report sa nepodarilo vytvoriť.",
    }), {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "300",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }
};
