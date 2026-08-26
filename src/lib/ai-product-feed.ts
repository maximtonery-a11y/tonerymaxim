import { createHash } from "node:crypto";
import { getProductsCache, stripHtml, type TmProduct } from "./tm-products-cache.ts";

const ORIGIN = "https://www.tonerymaxim.sk";

function xml(value: unknown): string {
  return String(value ?? "").replace(/[<>&"']/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;",
  })[char] || char);
}

function absoluteImage(product: TmProduct): string {
  const raw = String(product.image || (Array.isArray(product.images) ? product.images[0] : "") || "").trim();
  if (!raw) return "";
  try { return new URL(raw, ORIGIN).toString(); } catch { return ""; }
}

function productUrl(product: TmProduct): string {
  const slug = String(product.slug || "").trim();
  return slug ? `${ORIGIN}/produkt/${encodeURIComponent(slug)}` : "";
}

function availability(product: TmProduct): string {
  const status = String(product.stock_status || "").toLowerCase();
  const quantity = Number(product.stock_quantity);
  return status === "instock" && (!Number.isFinite(quantity) || quantity > 0) ? "in_stock" : "out_of_stock";
}

function text(value: unknown, max = 5000): string {
  return stripHtml(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function printers(product: TmProduct): string[] {
  const values = Array.isArray(product.compatible_printers) ? product.compatible_printers : [];
  return values.map((value: unknown) => text(value, 200)).filter(Boolean);
}

export function buildAiProductFeed(products: TmProduct[], generatedAt: string): string {
  const items = products.map((product) => {
    const id = text(product.id || product.sku || product.slug, 100);
    const name = text(product.name, 300);
    const url = productUrl(product);
    const image = absoluteImage(product);
    const price = Number(product.price || 0);
    const stockQuantity = Number(product.stock_quantity);
    const quantity = Number.isFinite(stockQuantity) ? Math.max(0, Math.trunc(stockQuantity)) : "";
    const description = text(product.description || product.short_description_html || product.description_html || name, 10000);
    const compatible = printers(product);
    return [
      "    <item>",
      `      <g:id>${xml(id)}</g:id>`,
      ...(product.sku ? [`      <g:mpn>${xml(text(product.sku, 100))}</g:mpn>`] : []),
      `      <g:title>${xml(name)}</g:title>`,
      `      <g:description>${xml(description)}</g:description>`,
      ...(url ? [`      <g:link>${xml(url)}</g:link>`] : []),
      ...(image ? [`      <g:image_link>${xml(image)}</g:image_link>`] : []),
      `      <g:price>${Number.isFinite(price) ? price.toFixed(2) : "0.00"} EUR</g:price>`,
      `      <g:availability>${availability(product)}</g:availability>`,
      `      <tm:stock_quantity>${quantity}</tm:stock_quantity>`,
      `      <tm:stock_status>${xml(product.stock_status || "")}</tm:stock_status>`,
      `      <tm:product_type>${xml(product.product_type_key || "product")}</tm:product_type>`,
      `      <tm:product_type_label>${xml(product.product_type_label || "")}</tm:product_type_label>`,
      ...(product.color ? [`      <tm:color>${xml(product.color)}</tm:color>`] : []),
      ...(product.capacity ? [`      <tm:capacity>${xml(product.capacity)}</tm:capacity>`] : []),
      ...(product.warranty ? [`      <tm:warranty>${xml(product.warranty)}</tm:warranty>`] : []),
      ...compatible.map((printer) => `      <tm:compatible_printer>${xml(printer)}</tm:compatible_printer>`),
      "    </item>",
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0" xmlns:tm="https://www.tonerymaxim.sk/ns/product-feed/1.0">',
    "  <channel>",
    "    <title>ToneryMaxim.sk – kompletný produktový feed pre AI</title>",
    `    <link>${ORIGIN}</link>`,
    "    <description>Kompletný katalóg e-shopu vrátane skladových aj neskladových produktov, typu produktu a presného počtu kusov.</description>",
    `    <lastBuildDate>${xml(new Date(generatedAt).toUTCString())}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

export async function aiProductFeedResponse(request?: Request): Promise<Response> {
  try {
    const cache = await getProductsCache();
    const body = buildAiProductFeed(cache.products, cache.generated_at);
    const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 24)}"`;
    const headers = new Headers({
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": 'inline; filename="tonerymaxim-ai-product-feed.xml"',
      "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=21600",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "ETag": etag,
      "X-AI-Product-Feed-Items": String(cache.products.length),
      "X-AI-Product-Feed-Generated-At": cache.generated_at,
    });
    if (request?.headers.get("if-none-match")?.split(",").map((value) => value.trim()).includes(etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { status: 200, headers });
  } catch (error: any) {
    console.error("[TM AI product feed]", error?.message || error);
    return new Response("Produktový feed je dočasne nedostupný.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "900" },
    });
  }
}
