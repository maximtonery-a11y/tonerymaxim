import type { TmProduct } from "./tm-products-cache.ts";
import { compactKey, stripHtml } from "./tm-products-cache.ts";
import { cleanGtin, cleanMpn, cleanProductBrand } from "./product-identifiers.ts";

export type MerchantProductType = "compatible" | "original" | "renovated" | "product";
export type MerchantMaterialType = "toner" | "ink" | "drum" | "component";

export type MerchantProduct = {
  id: string;
  name: string;
  slug: string;
  url: string;
  image: string;
  additionalImages: string[];
  price: number;
  availability: "in_stock" | "out_of_stock";
  productType: MerchantProductType;
  materialType: MerchantMaterialType;
  brand: string;
  gtin: string;
  mpn: string;
  identifierExists: boolean;
  color: string;
  description: string;
  labels: string[];
};

const SUPPORTED_PRODUCT_TYPES = new Set<MerchantProductType>([
  "compatible",
  "original",
  "renovated",
  "product",
]);

function cleanText(value: unknown, max: number): string {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function unique(values: unknown[], max = 10): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = cleanText(value, 2_000);
    const key = compactKey(clean);
    if (!clean || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= max) break;
  }
  return result;
}

function categoryText(product: TmProduct): string {
  if (!Array.isArray(product.categories)) return "";
  return product.categories.map((category: any) => (
    typeof category === "string"
      ? category
      : `${category?.name || ""} ${category?.slug || ""}`
  )).join(" ");
}

function materialType(product: TmProduct): MerchantMaterialType | null {
  const text = `${product.name || ""} ${product.slug || ""} ${product.product_type_detail_label || ""} ${categoryText(product)}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (/atrament|\bink\b|inkjet|cartridge|napln/.test(text)) return "ink";
  if (/optick.*valec|fotovalec|\bdrum\b/.test(text)) return "drum";
  if (/toner/.test(text)) return "toner";
  if (/zapek|fuser|transfer|prenosov|odpadov|maintenance|paska|belt|valec|komponent|spotrebny material/.test(text)) return "component";
  return null;
}

function stableId(product: TmProduct): string {
  return cleanText(product.id || product.sku || product.slug, 50)
    .replace(/[^a-zA-Z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function absoluteUrl(origin: string, value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, origin);
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function landingPage(origin: string, product: TmProduct): string {
  const slug = cleanText(product.slug, 300);
  if (!slug) return "";
  const url = new URL(`/produkt/${encodeURIComponent(slug)}`, origin);
  return url.toString();
}

function productImages(origin: string, product: TmProduct): string[] {
  const source = Array.isArray(product.images) ? product.images : [product.image];
  return unique(source.map((entry: any) => absoluteUrl(origin, entry?.src || entry?.url || entry)), 11);
}

function priceBucket(price: number): string {
  if (price < 10) return "price-under-10";
  if (price < 20) return "price-10-20";
  if (price < 30) return "price-20-30";
  return "price-30-plus";
}

function description(product: TmProduct, type: MerchantProductType, material: MerchantMaterialType): string {
  const supplied = cleanText(stripHtml(
    product.short_description_html || product.description_html || product.description || "",
  ), 5_000);
  if (supplied.length >= 40) return supplied;

  const typeLabel = {
    compatible: "kompatibilný",
    original: "originálny",
    renovated: "renovovaný",
    product: "",
  }[type];
  const materialLabel = {
    toner: "toner",
    ink: "atramentová náplň",
    drum: "optický valec",
    component: "spotrebný materiál pre tlačiarne",
  }[material];
  const printers = unique(
    Array.isArray(product.compatible_printers) ? product.compatible_printers : [],
    5,
  );
  return cleanText([
    product.name,
    typeLabel && `${typeLabel} ${materialLabel}`,
    printers.length ? `Určené pre tlačiarne ${printers.join(", ")}.` : "Spotrebný materiál pre tlačiarne.",
  ].filter(Boolean).join(". "), 5_000);
}

function originalMpnFromName(product: TmProduct, brand: string): string {
  if (!brand) return "";
  const name = cleanText(product.name, 150);
  const remainder = name.toLowerCase().startsWith(brand.toLowerCase())
    ? name.slice(brand.length).trim()
    : name;
  const parenthesized = remainder.match(/\(([A-Z0-9][A-Z0-9._/-]*\d[A-Z0-9._/-]*)\)/i)?.[1] || "";
  if (parenthesized) return cleanMpn(parenthesized);

  const tokens = remainder.replace(/^no\.?\s+/i, "").split(/\s+/);
  const candidate = tokens.find((token) => /^(?=.*\d)[A-Z0-9][A-Z0-9._/-]{1,69}$/i.test(token)) || "";
  return cleanMpn(candidate.replace(/[(),]/g, ""));
}

function identifiers(product: TmProduct, type: MerchantProductType) {
  // Pri kompatibilných a renovovaných produktoch značka tlačiarne nie je značkou
  // produktu. Neposielame preto vymyslené identifikátory, ktoré Merchant zamieta.
  if (type !== "original") {
    return { brand: "", gtin: "", mpn: "", identifierExists: false };
  }

  const brand = cleanProductBrand(product.product_brand);
  const gtin = cleanGtin(product.gtin || product.global_unique_id);
  // Katalóg má výrobné označenie originálu v názve produktu aj v prípadoch,
  // keď WooCommerce samostatné pole MPN neposlal.
  const mpn = cleanMpn(product.mpn) || originalMpnFromName(product, brand);
  return {
    brand,
    gtin,
    mpn,
    identifierExists: Boolean(gtin || (brand && mpn)),
  };
}

export function toMerchantProduct(product: TmProduct, origin: string): MerchantProduct | null {
  const productType = String(product.product_type_key || "") as MerchantProductType;
  if (!SUPPORTED_PRODUCT_TYPES.has(productType)) return null;

  const material = materialType(product);
  if (!material) return null;

  const price = Number(product.price || 0);
  const stockQuantity = Number(product.stock_quantity);
  const inStock = product.stock_status === "instock" && (!Number.isFinite(stockQuantity) || stockQuantity > 0);
  const images = productImages(origin, product);
  const ids = identifiers(product, productType);

  return {
    id: stableId(product),
    name: cleanText(product.name, 150),
    slug: cleanText(product.slug, 300),
    url: landingPage(origin, product),
    image: images[0] || "",
    additionalImages: images.slice(1),
    price,
    availability: inStock ? "in_stock" : "out_of_stock",
    productType,
    materialType: material,
    brand: ids.brand,
    gtin: ids.gtin,
    mpn: ids.mpn,
    identifierExists: ids.identifierExists,
    color: cleanText(product.color || product.farba, 100),
    description: description(product, productType, material),
    labels: [
      productType,
      material,
      inStock ? "in-stock" : "out-of-stock",
      priceBucket(price),
      price >= 29 ? "free-shipping" : "paid-shipping",
    ],
  };
}

export function buildMerchantProducts(products: TmProduct[], origin: string): MerchantProduct[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  return products
    .map((product) => toMerchantProduct(product, origin))
    .filter((product): product is MerchantProduct => Boolean(product))
    .filter((product) => {
      if (!product.id || !product.url || seenIds.has(product.id) || seenUrls.has(product.url)) return false;
      seenIds.add(product.id);
      seenUrls.add(product.url);
      return true;
    });
}
