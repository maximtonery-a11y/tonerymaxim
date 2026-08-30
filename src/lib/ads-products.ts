import type { TmProduct } from "./tm-products-cache";
import { compactKey, stripHtml } from "./tm-products-cache";
import { cleanGtin, cleanMpn, cleanProductBrand } from "./product-identifiers";
import { publicationEligibleProduct } from "./product-publication-policy.ts";

export type AdsProduct = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  url: string;
  image: string;
  additional_images: string[];
  price: number;
  currency: "EUR";
  availability: "in_stock" | "out_of_stock";
  stock_quantity: number | null;
  product_type: "compatible";
  material_type: "toner" | "ink";
  brand: string;
  printer_brand: string;
  gtin: string;
  mpn: string;
  identifier_exists: boolean;
  oem: string;
  color: string;
  capacity: string;
  compatible_printers: string[];
  description: string;
  dsa_labels: string[];
};

function cleanText(value: unknown, max: number): string {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function attributeValues(product: TmProduct, aliases: string[], exact = false) {
  const keys = aliases.map(compactKey);
  const attributes = Array.isArray(product.attributes_all)
    ? product.attributes_all
    : Array.isArray(product.attributes)
      ? product.attributes
      : [];

  const found = attributes.find((attribute: any) => {
    const name = compactKey(attribute?.name || "");
    const slug = compactKey(attribute?.slug || "");
    return keys.some((key) => (
      name === key
      || slug === key
      || (!exact && (name.includes(key) || slug.includes(key)))
    ));
  });

  if (!found) return [];
  if (Array.isArray(found.values)) return found.values.map(String).map((value: string) => value.trim()).filter(Boolean);
  if (Array.isArray(found.options)) return found.options.map(String).map((value: string) => value.trim()).filter(Boolean);
  return String(found.value || found.option || "")
    .split(/\s*[,;|]\s*/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function materialType(product: TmProduct): "toner" | "ink" | null {
  const explicit = attributeValues(product, ["Typ produktu", "typproduktu"]).join(" ");
  const text = `${product.name || ""} ${product.slug || ""} ${explicit}`.toLowerCase();

  if (/atrament|ink|napln|náplň|cartridge/.test(text)) return "ink";
  if (/toner/.test(text)) return "toner";
  return null;
}

function stableProductId(product: TmProduct): string {
  const raw = cleanText(product.id || product.sku || product.slug, 50);
  return raw.replace(/[^a-zA-Z0-9._:-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function absoluteProductUrl(origin: string, product: TmProduct) {
  const slug = cleanText(product.slug, 300);
  const raw = slug ? `/produkt/${encodeURIComponent(slug)}` : String(product.detail_url || "").trim();
  try {
    const url = new URL(raw, origin);
    if (url.protocol !== "https:") return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function absoluteImageUrl(origin: string, value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, origin);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function unique(values: unknown[], max = 80) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const key = compactKey(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= max) break;
  }
  return output;
}

function printerBrand(product: TmProduct, printers: string[]): string {
  const explicit = attributeValues(product, [
    "Výrobca tlačiarne",
    "Vyrobca tlaciarne",
    "Značka tlačiarne",
    "Znacka tlaciarne",
  ], true)[0];
  if (explicit) return cleanText(explicit, 70);

  const known = [
    "HP",
    "Brother",
    "Canon",
    "Epson",
    "Xerox",
    "Samsung",
    "Lexmark",
    "Kyocera",
    "OKI",
    "Ricoh",
    "Konica Minolta",
    "Utax",
    "Panasonic",
    "Toshiba",
    "Dell",
    "Philips",
    "IBM",
    "Sharp",
    "Pantum",
  ];
  const firstPrinter = printers[0] || "";
  return known.find((brand) => new RegExp(`^${brand.replace(/\s+/g, "\\s+")}\\b`, "i").test(firstPrinter)) || "";
}

function productBrand(product: TmProduct): string {
  const explicit = product.product_brand
    || attributeValues(product, [
      "Značka produktu",
      "Znacka produktu",
      "Výrobca produktu",
      "Vyrobca produktu",
      "Product brand",
      "Product manufacturer",
    ], true)[0];
  return cleanProductBrand(explicit);
}

function priceBucket(price: number): string {
  if (price < 10) return "price-under-10";
  if (price < 20) return "price-10-20";
  if (price < 30) return "price-20-30";
  return "price-30-plus";
}

export function toAdsProduct(product: TmProduct, origin: string): AdsProduct | null {
  if (!publicationEligibleProduct(product)) return null;
  if (product.product_type_key !== "compatible") return null;

  const type = materialType(product);
  if (!type) return null;

  const stockQuantity = Number(product.stock_quantity);
  const inStock = product.stock_status === "instock" && (!Number.isFinite(stockQuantity) || stockQuantity > 0);
  const oem = attributeValues(product, ["OEM", "oem"])[0] || "";
  const printers = unique(
    Array.isArray(product.compatible_printers)
      ? product.compatible_printers
      : Array.isArray(product.printers)
        ? product.printers
        : attributeValues(product, ["Model tlačiarne", "modeltlaciarne"]),
  );
  const actualBrand = productBrand(product);
  const compatiblePrinterBrand = printerBrand(product, printers);
  const gtin = cleanGtin(product.gtin || attributeValues(product, ["GTIN", "EAN", "UPC"], true)[0]);
  const mpn = cleanMpn(product.mpn || attributeValues(product, ["MPN", "Manufacturer Part Number"], true)[0]);
  const color = String(product.color || product.farba || attributeValues(product, ["Farba", "farba"])[0] || "").trim();
  const capacity = String(product.capacity || product.kapacita || product.yield || product.page_yield || attributeValues(product, ["Výťažnosť", "vytaznost"])[0] || "").trim();
  const price = Number(product.price || 0);
  const images = unique(
    (Array.isArray(product.images) ? product.images : [product.image])
      .map((image) => absoluteImageUrl(origin, image)),
    10,
  );
  const labels = unique([
    "compatible",
    type,
    inStock ? "in-stock" : "out-of-stock",
    priceBucket(price),
    price >= 29 ? "free-shipping" : "paid-shipping",
    compatiblePrinterBrand ? `printer-brand-${compactKey(compatiblePrinterBrand)}` : "",
  ], 10);

  return {
    id: stableProductId(product),
    sku: cleanText(product.sku, 100),
    name: cleanText(product.name, 150),
    slug: cleanText(product.slug, 300),
    url: absoluteProductUrl(origin, product),
    image: images[0] || "",
    additional_images: images.slice(1, 11),
    price,
    currency: "EUR",
    availability: inStock ? "in_stock" : "out_of_stock",
    stock_quantity: Number.isFinite(stockQuantity) ? stockQuantity : null,
    product_type: "compatible",
    material_type: type,
    brand: actualBrand,
    printer_brand: compatiblePrinterBrand,
    gtin,
    mpn,
    identifier_exists: Boolean(gtin || (actualBrand && mpn)),
    oem: cleanText(oem, 100),
    color: cleanText(color, 100),
    capacity: cleanText(capacity, 100),
    compatible_printers: printers,
    description: cleanText(stripHtml(product.short_description_html || product.description_html || product.description || ""), 5_000),
    dsa_labels: labels,
  };
}

export function buildAdsProducts(products: TmProduct[], origin: string, onlyInStock = true) {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  return products
    .map((product) => toAdsProduct(product, origin))
    .filter((product): product is AdsProduct => Boolean(product))
    .filter((product) => !onlyInStock || product.availability === "in_stock")
    .filter((product) => {
      if (!product.id || !product.url || seenIds.has(product.id) || seenUrls.has(product.url)) return false;
      seenIds.add(product.id);
      seenUrls.add(product.url);
      return true;
    });
}

export function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
