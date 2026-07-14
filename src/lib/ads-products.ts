import type { TmProduct } from "./tm-products-cache";
import { compactKey, stripHtml } from "./tm-products-cache";

export type AdsProduct = {
  id: number | string;
  sku: string;
  name: string;
  slug: string;
  url: string;
  image: string;
  price: number;
  currency: "EUR";
  availability: "in_stock" | "out_of_stock";
  stock_quantity: number | null;
  product_type: "compatible";
  material_type: "toner" | "ink";
  brand: string;
  oem: string;
  color: string;
  capacity: string;
  compatible_printers: string[];
  description: string;
  dsa_labels: string[];
};

function attributeValues(product: TmProduct, aliases: string[]) {
  const keys = aliases.map(compactKey);
  const attributes = Array.isArray(product.attributes_all)
    ? product.attributes_all
    : Array.isArray(product.attributes)
      ? product.attributes
      : [];

  const found = attributes.find((attribute: any) => {
    const name = compactKey(attribute?.name || "");
    const slug = compactKey(attribute?.slug || "");
    return keys.some((key) => name === key || slug === key || name.includes(key) || slug.includes(key));
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

function absoluteProductUrl(origin: string, product: TmProduct) {
  const raw = String(product.detail_url || `/produkt/${product.slug || product.id}`).trim();
  try {
    return new URL(raw, origin).toString();
  } catch {
    return `${origin.replace(/\/$/, "")}/produkt/${encodeURIComponent(String(product.slug || product.id || ""))}`;
  }
}

function absoluteImageUrl(origin: string, value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, origin).toString();
  } catch {
    return raw;
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

export function toAdsProduct(product: TmProduct, origin: string): AdsProduct | null {
  if (product.product_type_key !== "compatible") return null;

  const type = materialType(product);
  if (!type) return null;

  const stockQuantity = Number(product.stock_quantity);
  const inStock = product.stock_status === "instock" && (!Number.isFinite(stockQuantity) || stockQuantity > 0);
  const brand = attributeValues(product, ["Výrobca tlačiarne", "vyrobcatlaciarne", "brand", "značka", "znacka"])[0] || "";
  const oem = attributeValues(product, ["OEM", "oem"])[0] || "";
  const printers = unique(
    Array.isArray(product.compatible_printers)
      ? product.compatible_printers
      : Array.isArray(product.printers)
        ? product.printers
        : attributeValues(product, ["Model tlačiarne", "modeltlaciarne"]),
  );
  const color = String(product.color || product.farba || attributeValues(product, ["Farba", "farba"])[0] || "").trim();
  const capacity = String(product.capacity || product.kapacita || product.yield || product.page_yield || attributeValues(product, ["Výťažnosť", "vytaznost"])[0] || "").trim();
  const labels = unique([
    "compatible",
    type,
    inStock ? "in-stock" : "out-of-stock",
    brand ? `brand-${compactKey(brand)}` : "",
  ], 10);

  return {
    id: product.id,
    sku: String(product.sku || ""),
    name: String(product.name || "").trim(),
    slug: String(product.slug || "").trim(),
    url: absoluteProductUrl(origin, product),
    image: absoluteImageUrl(origin, product.image || product.images?.[0]),
    price: Number(product.price || 0),
    currency: "EUR",
    availability: inStock ? "in_stock" : "out_of_stock",
    stock_quantity: Number.isFinite(stockQuantity) ? stockQuantity : null,
    product_type: "compatible",
    material_type: type,
    brand,
    oem,
    color,
    capacity,
    compatible_printers: printers,
    description: stripHtml(product.short_description_html || product.description_html || product.description || ""),
    dsa_labels: labels,
  };
}

export function buildAdsProducts(products: TmProduct[], origin: string, onlyInStock = true) {
  return products
    .map((product) => toAdsProduct(product, origin))
    .filter((product): product is AdsProduct => Boolean(product))
    .filter((product) => !onlyInStock || product.availability === "in_stock");
}

export function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
