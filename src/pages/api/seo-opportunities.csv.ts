import type { APIRoute } from "astro";
import { getAdminAccessKey, isAdminLocked } from "../../lib/admin-access";
import { filterSeoOpportunities, getSeoOpportunityReport } from "../../lib/seo-opportunities";

export const prerender = false;

function csv(value: unknown): string {
  const clean = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${clean.replace(/\r?\n/g, " ").replace(/"/g, '""')}"`;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const adminKey = getAdminAccessKey(locals);
  const suppliedKey = url.searchParams.get("key") || "";
  if (isAdminLocked({ adminKey, suppliedKey, hostname: url.hostname })) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }

  const report = await getSeoOpportunityReport();
  const opportunities = filterSeoOpportunities(report.opportunities, {
    kind: url.searchParams.get("kind") || "all",
    status: url.searchParams.get("status") || "all",
    impact: url.searchParams.get("impact") || "all",
    query: url.searchParams.get("q") || "",
  });
  const rows = [
    [
      "Poradie",
      "Typ",
      "Dopad",
      "Stav",
      "Opportunity score",
      "SEO/GEO score",
      "Názov",
      "URL",
      "Produktov",
      "Skladom",
      "Odporúčaný title",
      "Odporúčaná meta description",
      "Priama odpoveď pre AI",
      "Dôvody",
      "Ďalšie kroky",
    ],
    ...opportunities.map((item, index) => [
      index + 1,
      item.kind,
      item.impact,
      item.status,
      item.opportunityScore,
      item.seoScore,
      item.label,
      item.url,
      item.productCount,
      item.inStockCount,
      item.suggestedTitle,
      item.suggestedDescription,
      item.directAnswer,
      item.reasons,
      item.actions,
    ]),
  ];
  const body = `\uFEFF${rows.map((row) => row.map(csv).join(";")).join("\r\n")}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tm-seo-dominator-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};
