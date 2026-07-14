import type { APIRoute } from "astro";
import { buildAdsProducts, csvCell } from "../../lib/ads-products";
import { getProductsCache } from "../../lib/tm-products-cache";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const cache = await getProductsCache();
    const products = buildAdsProducts(cache.products, url.origin, true);
    const rows = [
      ["Page URL", "Custom label"].map(csvCell).join(","),
      ...products.map((product) => [product.url, product.dsa_labels.join(";")].map(csvCell).join(",")),
    ];

    return new Response(`\uFEFF${rows.join("\r\n")}\r\n`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'inline; filename="tonerymaxim-dsa-page-feed.csv"',
        "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
      },
    });
  } catch (error: any) {
    return new Response(`Nepodarilo sa vytvoriť DSA feed: ${error?.message || "neznáma chyba"}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};
