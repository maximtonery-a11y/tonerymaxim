import { createHash } from "node:crypto";
import { cleanGtin, cleanProductBrand } from "./product-identifiers";
import { getProductsCache, stripHtml, type TmProduct } from "./tm-products-cache";

const ORIGIN = "https://www.tonerymaxim.sk";
const PLACEHOLDER_IMAGE = /placeholder|no-image|image-coming-soon|tm-product-placeholder|tm-ink-placeholder/i;

function envNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = String(process.env[name] || import.meta.env[name] || "").trim().replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function xml(value: unknown) {
  return String(value ?? "").replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;",
  })[char] || char);
}

function text(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function itemId(product: TmProduct) {
  return text(product.id || product.sku || product.slug, 80)
    .replace(/[^_\/0-9a-zA-Z-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}

function productUrl(product: TmProduct) {
  const slug = text(product.slug, 240);
  if (!slug) return "";
  return `${ORIGIN}/produkt/${encodeURIComponent(slug)}`;
}

function imageUrl(product: TmProduct) {
  const raw = String(product.image || (Array.isArray(product.images) ? product.images[0] : "") || "").trim();
  if (!raw || PLACEHOLDER_IMAGE.test(raw)) return "";
  try {
    const url = new URL(raw, ORIGIN);
    return url.protocol === "https:" && url.toString().length <= 255 ? url.toString() : "";
  } catch {
    return "";
  }
}

function inStock(product: TmProduct) {
  if (String(product.stock_status || "").toLowerCase() !== "instock") return false;
  const quantity = Number(product.stock_quantity);
  return !Number.isFinite(quantity) || quantity > 0;
}

function materialType(product: TmProduct) {
  const haystack = `${product.name || ""} ${product.slug || ""} ${product.description || ""}`.toLowerCase();
  return /atrament|ink|náplň|napln|cartridge/.test(haystack) ? "Atramentová náplň" : "Toner";
}

function category(product: TmProduct) {
  const base = "Elektronika | Počítače a kancelária | Tlačiarne a príslušenstvo";
  return product.product_type_key === "original"
    ? `${base} | Náplne a tonery - originálne`
    : `${base} | Náplne a tonery - kompatibilné`;
}

function parameter(name: string, value: unknown) {
  const clean = text(value, 160);
  if (!clean) return [];
  return [
    "    <PARAM>",
    `      <PARAM_NAME>${xml(name)}</PARAM_NAME>`,
    `      <VAL>${xml(clean)}</VAL>`,
    "    </PARAM>",
  ];
}

export function buildHeurekaFeed(products: TmProduct[]) {
  const deliveryDays = Math.round(envNumber("HEUREKA_DELIVERY_DAYS", 1, 0, 30));
  const minimumProducts = Math.round(envNumber("HEUREKA_FEED_MIN_PRODUCTS", 50, 1, 50_000));
  const seen = new Set<string>();

  const included = products.filter((product) => {
    const id = itemId(product);
    const price = Number(product.price || 0);
    const url = productUrl(product);
    if (!id || seen.has(id) || !Number.isFinite(price) || price <= 0 || !url || !inStock(product)) return false;
    seen.add(id);
    return true;
  });

  if (included.length < minimumProducts) {
    throw new Error(`Heureka feed safety gate: ${included.length} products, minimum ${minimumProducts}.`);
  }

  const items = included.map((product) => {
    const name = text(product.name, 200);
    const description = text(stripHtml(product.description_html || product.short_description_html || product.description || name), 10_000);
    const image = imageUrl(product);
    const price = Number(product.price).toFixed(2);
    const manufacturer = cleanProductBrand(product.product_brand || product.manufacturer_name);
    const ean = cleanGtin(product.gtin);
    const validEan = ean.length === 13 ? ean : "";
    const type = "new";

    return [
      "  <SHOPITEM>",
      `    <ITEM_ID>${xml(itemId(product))}</ITEM_ID>`,
      `    <PRODUCTNAME>${xml(name)}</PRODUCTNAME>`,
      `    <PRODUCT>${xml(name)}</PRODUCT>`,
      `    <DESCRIPTION>${xml(description)}</DESCRIPTION>`,
      `    <URL>${xml(productUrl(product))}</URL>`,
      ...(image ? [`    <IMGURL>${xml(image)}</IMGURL>`] : []),
      `    <PRICE_VAT>${price}</PRICE_VAT>`,
      `    <VAT>0.23</VAT>`,
      `    <ITEM_TYPE>${type}</ITEM_TYPE>`,
      ...(manufacturer ? [`    <MANUFACTURER>${xml(manufacturer)}</MANUFACTURER>`] : []),
      `    <CATEGORYTEXT>${xml(category(product))}</CATEGORYTEXT>`,
      ...(validEan ? [`    <EAN>${validEan}</EAN>`] : []),
      `    <DELIVERY_DATE>${deliveryDays}</DELIVERY_DATE>`,
      ...parameter("Typ", materialType(product)),
      ...parameter("Farba", product.color || product.farba),
      ...parameter("Výťažnosť", product.capacity || product.kapacita || product.yield || product.page_yield),
      ...parameter("Prevedenie", product.product_type_label),
      "  </SHOPITEM>",
    ].join("\n");
  }).join("\n");

  return {
    xml: ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<SHOP>", items, "</SHOP>", ""].join("\n"),
    count: included.length,
  };
}

export async function heurekaFeedResponse(request?: Request) {
  try {
    const cache = await getProductsCache();
    const build = buildHeurekaFeed(cache.products);
    const etag = `"${createHash("sha256").update(build.xml).digest("hex").slice(0, 24)}"`;
    const headers = new Headers({
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": 'inline; filename="heureka.xml"',
      "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=21600",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "ETag": etag,
      "X-Heureka-Feed-Items": String(build.count),
    });
    const modified = new Date(cache.generated_at);
    if (!Number.isNaN(modified.getTime())) headers.set("Last-Modified", modified.toUTCString());
    if (request?.headers.get("if-none-match")?.split(",").map((value) => value.trim()).includes(etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(build.xml, { status: 200, headers });
  } catch (error: any) {
    console.error("[TM Heureka feed]", error?.message || error);
    return new Response("Heureka feed je dočasne nedostupný.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "900" },
    });
  }
}
