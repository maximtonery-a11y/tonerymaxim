import { createHash } from "node:crypto";
import { buildAdsProducts } from "./ads-products";
import { getProductsCache, type TmProduct } from "./tm-products-cache";

const PRODUCTION_ORIGIN = "https://www.tonerymaxim.sk";
const GOOGLE_PRODUCT_CATEGORY = "356";
const PLACEHOLDER_IMAGE = /placeholder|no-image|image-coming-soon|tm-product-placeholder|tm-ink-placeholder/i;

export type MerchantFeedConfig = {
  origin: string;
  minimumProducts: number;
  shippingPrice: number;
  freeShippingFrom: number;
  minHandlingTime: number;
  maxHandlingTime: number;
  minTransitTime: number;
  maxTransitTime: number;
};

export type MerchantFeedStats = {
  sourceProducts: number;
  compatibleCandidates: number;
  transformedCandidates: number;
  includedProducts: number;
  excludedProducts: number;
  excluded: Record<string, number>;
  withGtin: number;
  withBrandAndMpn: number;
  withFreeShipping: number;
};

export type MerchantFeedBuild = {
  xml: string;
  stats: MerchantFeedStats;
};

function envNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const configured = String(process.env[name] || import.meta.env[name] || "").trim();
  if (!configured) return fallback;
  const value = Number(configured.replace(",", "."));
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function merchantFeedConfig(): MerchantFeedConfig {
  return {
    origin: PRODUCTION_ORIGIN,
    minimumProducts: Math.round(envNumber("MERCHANT_FEED_MIN_PRODUCTS", 50, 1, 50_000)),
    shippingPrice: envNumber("MERCHANT_SHIPPING_PRICE", 3.9, 0, 1_000),
    freeShippingFrom: envNumber("MERCHANT_FREE_SHIPPING_FROM", 29, 0, 100_000),
    minHandlingTime: Math.round(envNumber("MERCHANT_MIN_HANDLING_DAYS", 0, 0, 30)),
    maxHandlingTime: Math.round(envNumber("MERCHANT_MAX_HANDLING_DAYS", 1, 0, 30)),
    minTransitTime: Math.round(envNumber("MERCHANT_MIN_TRANSIT_DAYS", 1, 0, 30)),
    maxTransitTime: Math.round(envNumber("MERCHANT_MAX_TRANSIT_DAYS", 2, 0, 30)),
  };
}

function xml(value: unknown): string {
  return String(value ?? "").replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;",
  })[char] || char);
}

function validMerchantUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.origin === origin
      && url.pathname.startsWith("/produkt/")
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function validMerchantImage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !PLACEHOLDER_IMAGE.test(url.toString());
  } catch {
    return false;
  }
}

function increase(stats: MerchantFeedStats, reason: string): void {
  stats.excluded[reason] = (stats.excluded[reason] || 0) + 1;
}

function productTypeName(materialType: "toner" | "ink"): string {
  return materialType === "ink"
    ? "ToneryMaxim > Kompatibilné atramentové náplne"
    : "ToneryMaxim > Kompatibilné tonery";
}

function shippingXml(price: number, config: MerchantFeedConfig): string[] {
  const shippingPrice = price >= config.freeShippingFrom ? 0 : config.shippingPrice;
  return [
    "      <g:shipping>",
    "        <g:country>SK</g:country>",
    "        <g:service>Kuriér DPD alebo GLS</g:service>",
    `        <g:price>${shippingPrice.toFixed(2)} EUR</g:price>`,
    `        <g:min_handling_time>${config.minHandlingTime}</g:min_handling_time>`,
    `        <g:max_handling_time>${Math.max(config.minHandlingTime, config.maxHandlingTime)}</g:max_handling_time>`,
    `        <g:min_transit_time>${config.minTransitTime}</g:min_transit_time>`,
    `        <g:max_transit_time>${Math.max(config.minTransitTime, config.maxTransitTime)}</g:max_transit_time>`,
    "      </g:shipping>",
  ];
}

export function buildMerchantFeed(
  sourceProducts: TmProduct[],
  generatedAt: string,
  config: MerchantFeedConfig = merchantFeedConfig(),
): MerchantFeedBuild {
  const compatibleCandidates = sourceProducts.filter((product) => product.product_type_key === "compatible");
  const transformed = buildAdsProducts(sourceProducts, config.origin, false);
  const stats: MerchantFeedStats = {
    sourceProducts: sourceProducts.length,
    compatibleCandidates: compatibleCandidates.length,
    transformedCandidates: transformed.length,
    includedProducts: 0,
    excludedProducts: 0,
    excluded: {},
    withGtin: 0,
    withBrandAndMpn: 0,
    withFreeShipping: 0,
  };

  const products = transformed.filter((product) => {
    if (product.product_type !== "compatible") {
      increase(stats, "not_compatible");
      return false;
    }
    if (!product.id || !product.slug || product.name.length < 5) {
      increase(stats, "missing_identity");
      return false;
    }
    if (!Number.isFinite(product.price) || product.price <= 0) {
      increase(stats, "invalid_price");
      return false;
    }
    if (product.description.length < 40) {
      increase(stats, "missing_description");
      return false;
    }
    if (!validMerchantUrl(product.url, config.origin)) {
      increase(stats, "invalid_landing_page");
      return false;
    }
    if (!validMerchantImage(product.image)) {
      increase(stats, "invalid_image");
      return false;
    }
    if (product.availability !== "in_stock") {
      increase(stats, "out_of_stock");
      return false;
    }
    return true;
  });

  const untransformedCompatible = Math.max(0, compatibleCandidates.length - transformed.length);
  if (untransformedCompatible) stats.excluded.unsupported_or_duplicate = untransformedCompatible;
  stats.includedProducts = products.length;
  stats.excludedProducts = Math.max(0, stats.sourceProducts - products.length);
  stats.withGtin = products.filter((product) => product.gtin).length;
  stats.withBrandAndMpn = products.filter((product) => product.brand && product.mpn).length;
  stats.withFreeShipping = products.filter((product) => product.price >= config.freeShippingFrom).length;

  if (products.length < config.minimumProducts) {
    throw new Error(`Merchant feed safety gate: ${products.length} products, minimum ${config.minimumProducts}.`);
  }

  const items = products.map((product) => {
    const labels = product.dsa_labels.slice(0, 5);
    return [
      "    <item>",
      `      <g:id>${xml(product.id)}</g:id>`,
      `      <g:title>${xml(product.name)}</g:title>`,
      `      <g:description>${xml(product.description)}</g:description>`,
      `      <g:link>${xml(product.url)}</g:link>`,
      `      <g:image_link>${xml(product.image)}</g:image_link>`,
      ...product.additional_images
        .filter(validMerchantImage)
        .slice(0, 10)
        .map((image) => `      <g:additional_image_link>${xml(image)}</g:additional_image_link>`),
      "      <g:availability>in_stock</g:availability>",
      "      <g:condition>new</g:condition>",
      `      <g:price>${product.price.toFixed(2)} EUR</g:price>`,
      `      <g:google_product_category>${GOOGLE_PRODUCT_CATEGORY}</g:google_product_category>`,
      `      <g:product_type>${xml(productTypeName(product.material_type))}</g:product_type>`,
      ...(product.brand ? [`      <g:brand>${xml(product.brand)}</g:brand>`] : []),
      ...(product.gtin ? [`      <g:gtin>${xml(product.gtin)}</g:gtin>`] : []),
      ...(product.mpn ? [`      <g:mpn>${xml(product.mpn)}</g:mpn>`] : []),
      `      <g:identifier_exists>${product.identifier_exists ? "yes" : "no"}</g:identifier_exists>`,
      ...(product.color ? [`      <g:color>${xml(product.color)}</g:color>`] : []),
      "      <g:ships_from_country>SK</g:ships_from_country>",
      ...shippingXml(product.price, config),
      ...labels.map((label, index) => `      <g:custom_label_${index}>${xml(label)}</g:custom_label_${index}>`),
      "    </item>",
    ].join("\n");
  }).join("\n");

  const generatedDate = new Date(generatedAt);
  const lastBuildDate = Number.isNaN(generatedDate.getTime()) ? "" : generatedDate.toUTCString();
  const feedXml = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<rss version=\"2.0\" xmlns:g=\"http://base.google.com/ns/1.0\">",
    "  <channel>",
    "    <title>ToneryMaxim.sk – kompatibilné tonery a atramentové náplne</title>",
    `    <link>${config.origin}</link>`,
    "    <description>Skladové kompatibilné tonery a atramentové náplne s cenou s DPH a doručením na Slovensko.</description>",
    ...(lastBuildDate ? [`    <lastBuildDate>${lastBuildDate}</lastBuildDate>`] : []),
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  return { xml: feedXml, stats };
}

function responseWithCaching(build: MerchantFeedBuild, generatedAt: string, request?: Request): Response {
  const etag = `"${createHash("sha256").update(build.xml).digest("hex").slice(0, 24)}"`;
  const generatedDate = new Date(generatedAt);
  const headers = new Headers({
    "Content-Type": "application/xml; charset=utf-8",
    "Content-Disposition": 'inline; filename="tonerymaxim-merchant-feed.xml"',
    "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=21600",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Vary": "Accept-Encoding",
    "ETag": etag,
    "X-Merchant-Feed-Items": String(build.stats.includedProducts),
    "X-Merchant-Feed-Excluded": String(build.stats.excludedProducts),
  });
  if (!Number.isNaN(generatedDate.getTime())) headers.set("Last-Modified", generatedDate.toUTCString());

  const ifNoneMatch = request?.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").map((value) => value.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(build.xml, { status: 200, headers });
}

export async function merchantFeedResponse(request?: Request): Promise<Response> {
  try {
    const cache = await getProductsCache();
    const build = buildMerchantFeed(cache.products, cache.generated_at);
    return responseWithCaching(build, cache.generated_at, request);
  } catch (error: any) {
    console.error("[TM Merchant feed]", error?.message || error);
    return new Response("Merchant feed je dočasne nedostupný. Google ho môže skúsiť načítať neskôr.", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "900",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }
}
