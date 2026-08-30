import type { TmProduct } from "./tm-products-cache.ts";
import { compactKey, stripHtml } from "./tm-products-cache.ts";
import { cleanGtin, cleanMpn, cleanProductBrand } from "./product-identifiers.ts";
import { publicationEligibleProduct } from "./product-publication-policy.ts";
import { buildProductSeo } from "./catalog-seo-text.ts";

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
  oemCodes: string[];
  excludedDestinations: string[];
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
  if (/toner|\bc\s*-?\s*exv\s*\d+|\b(?:crg|cf|ce|cb|cc|q|w)\s*-?\s*\d{2,5}[a-z]*/.test(text)) return "toner";
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

function attributeValues(product: TmProduct, aliases: string[]): string[] {
  const wanted = aliases.map(compactKey);
  const attributes = Array.isArray(product.attributes_all)
    ? product.attributes_all
    : Array.isArray(product.attributes)
      ? product.attributes
      : [];
  const found = attributes.find((attribute: any) => {
    const name = compactKey(attribute?.name || "");
    const slug = compactKey(attribute?.slug || "");
    return wanted.includes(name) || wanted.includes(slug);
  });
  if (!found) return [];
  const values = Array.isArray(found.values)
    ? found.values
    : Array.isArray(found.options)
      ? found.options
      : [found.value || found.option];
  return unique(values, 10);
}

function oemCodes(product: TmProduct): string[] {
  const explicit = attributeValues(product, ["OEM"]);
  const source = explicit.length ? explicit : [product.name || ""];
  const codes: string[] = [];
  for (const value of source) {
    for (const match of String(value).toUpperCase().matchAll(/\b(?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{2,24}\b/g)) {
      const code = match[0].replace(/^NO\.?$/i, "").replace(/[.,;:]+$/, "");
      if (code && !/^\d+(?:[.,]\d+)?$/.test(code)) codes.push(code);
    }
  }
  return unique(codes, 8);
}

function oemFamilyLabel(codes: string[]): string {
  const primary = codes[0] || "";
  if (!primary) return "oem-unclassified";
  // A/X/XL/Y sú kapacitné varianty tej istej OEM rodiny (W1420A -> W1420).
  const family = primary.replace(/(?:XL|XXL|[AXY])$/i, "");
  return `oem-${compactKey(family || primary)}`.slice(0, 100);
}

function productTypeLabel(type: MerchantProductType, material: MerchantMaterialType): string {
  const feminine = material === "ink";
  return {
    compatible: feminine ? "Kompatibilná" : "Kompatibilný",
    original: feminine ? "Originálna" : "Originálny",
    renovated: feminine ? "Renovovaná" : "Renovovaný",
    product: "",
  }[type];
}

function materialLabel(material: MerchantMaterialType): string {
  return {
    toner: "toner",
    ink: "atramentová náplň",
    drum: "optický valec",
    component: "spotrebný materiál pre tlačiarne",
  }[material];
}

function merchantTitle(product: TmProduct, allProducts?: TmProduct[]): string {
  // Rovnaký kanonický názov používame na produktovej stránke aj vo feedoch.
  // Google tak nedostane všeobecný názov odlišný od organického výsledku.
  return cleanText(
    buildProductSeo(product, allProducts).title.replace(/\s*\|\s*ToneryMaxim\.sk\s*$/i, ""),
    150,
  );
}

function description(product: TmProduct, type: MerchantProductType, material: MerchantMaterialType): string {
  const shortDescription = cleanText(stripHtml(product.short_description_html || ""), 1_500);
  const longDescription = cleanText(stripHtml(product.description_html || product.description || ""), 3_000);
  const printers = unique(
    Array.isArray(product.compatible_printers) ? product.compatible_printers : [],
    8,
  );
  const compatibility = printers.length
    ? `Určené pre tlačiarne ${printers.join(", ")}.`
    : "";

  // Description vždy obsahuje názov/OEM kód a kompatibilné tlačiarne. Predtým
  // sa pri dostatočne dlhom short_description vracal iba všeobecný text
  // (farba, kapacita, záruka), takže Google strácal hlavný signál kompatibility.
  return cleanText([
    buildProductSeo(product).description,
    `${productTypeLabel(type, material)} ${materialLabel(material)}`.trim(),
    compatibility,
    shortDescription,
    longDescription,
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

export function toMerchantProduct(product: TmProduct, origin: string, allProducts?: TmProduct[]): MerchantProduct | null {
  if (!publicationEligibleProduct(product)) return null;
  const productType = String(product.product_type_key || "") as MerchantProductType;
  if (!SUPPORTED_PRODUCT_TYPES.has(productType)) return null;

  const material = materialType(product);
  if (!material) return null;

  const price = Number(product.price || 0);
  const stockQuantity = Number(product.stock_quantity);
  const inStock = product.stock_status === "instock" && (!Number.isFinite(stockQuantity) || stockQuantity > 0);
  const images = productImages(origin, product);
  const ids = identifiers(product, productType);
  const exactOemCodes = oemCodes(product);

  return {
    id: stableId(product),
    name: merchantTitle(product, allProducts),
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
    oemCodes: exactOemCodes,
    // Originály a renovované výrobky ostávajú v bezplatných záznamoch, ale
    // samotný feed ich už technicky nepustí do platenej Shopping inzercie.
    excludedDestinations: productType === "compatible" ? [] : ["Shopping_ads"],
    labels: [
      productType,
      material,
      productType === "compatible" ? "ads-compatible" : "organic-only",
      oemFamilyLabel(exactOemCodes),
      price >= 29 ? "free-shipping" : "paid-shipping",
    ],
  };
}

export function buildMerchantProducts(products: TmProduct[], origin: string): MerchantProduct[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  return products
    .map((product) => toMerchantProduct(product, origin, products))
    .filter((product): product is MerchantProduct => Boolean(product))
    .filter((product) => {
      if (!product.id || !product.url || seenIds.has(product.id) || seenUrls.has(product.url)) return false;
      seenIds.add(product.id);
      seenUrls.add(product.url);
      return true;
    });
}
