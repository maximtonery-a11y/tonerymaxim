import { normalize, sortProducts, stripHtml, type TmProduct } from "./tm-products-cache";

export type { TmProduct } from "./tm-products-cache";

export type CatalogLandingKind = "toners" | "ink" | "compatible" | "original" | "renovated";

export type BrandDefinition = {
  slug: string;
  name: string;
  aliases: string[];
};

export type PrinterEntity = {
  brand: BrandDefinition;
  name: string;
  slug: string;
  products: TmProduct[];
};

export type OemEntity = {
  code: string;
  slug: string;
  products: TmProduct[];
  printers: string[];
};

export type CatalogStats = {
  total: number;
  inStock: number;
  compatible: number;
  original: number;
  renovated: number;
  other: number;
  minPrice: number;
  maxPrice: number;
  colors: string[];
};

export type EntityLink = {
  href: string;
  label: string;
  count?: number;
  description?: string;
};

export const SEO_BRANDS: BrandDefinition[] = [
  { slug: "hp", name: "HP", aliases: ["hp", "hewlett packard"] },
  { slug: "canon", name: "Canon", aliases: ["canon"] },
  { slug: "brother", name: "Brother", aliases: ["brother"] },
  { slug: "epson", name: "Epson", aliases: ["epson"] },
  { slug: "xerox", name: "Xerox", aliases: ["xerox"] },
  { slug: "samsung", name: "Samsung", aliases: ["samsung"] },
  { slug: "lexmark", name: "Lexmark", aliases: ["lexmark"] },
  { slug: "kyocera", name: "Kyocera", aliases: ["kyocera"] },
  { slug: "oki", name: "OKI", aliases: ["oki"] },
  { slug: "ricoh", name: "Ricoh", aliases: ["ricoh"] },
  { slug: "konica-minolta", name: "Konica Minolta", aliases: ["konica minolta", "konica-minolta"] },
  { slug: "utax", name: "Utax", aliases: ["utax"] },
  { slug: "panasonic", name: "Panasonic", aliases: ["panasonic"] },
  { slug: "toshiba", name: "Toshiba", aliases: ["toshiba"] },
  { slug: "dell", name: "Dell", aliases: ["dell"] },
  { slug: "philips", name: "Philips", aliases: ["philips"] },
  { slug: "ibm", name: "IBM", aliases: ["ibm"] },
  { slug: "sharp", name: "Sharp", aliases: ["sharp"] },
  { slug: "pantum", name: "Pantum", aliases: ["pantum"] },
];

const OEM_PATTERN = /\b(?:TN|DR|LC|CLI|PGI|PG|CL|CRG|CF|CE|W|Q|TK|MLT|CLT|T)[\s-]*\d{2,6}(?:[\s-]*[A-Z]{1,3})?\b|\b(?:C13T|C13S)\d{4,12}\b/gi;

export function entitySlug(value: unknown): string {
  return normalize(value)
    .replace(/&/g, " a ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function productSearchText(product: TmProduct): string {
  const categories = Array.isArray(product.categories)
    ? product.categories.map((item: any) => `${item?.name || ""} ${item?.slug || ""}`).join(" ")
    : "";
  const attributes = Array.isArray(product.attributes_all)
    ? product.attributes_all.map((item: any) => `${item?.name || ""} ${item?.value || ""}`).join(" ")
    : "";
  return normalize([
    product.name,
    product.sku,
    product.slug,
    categories,
    attributes,
    product.search_text,
    stripHtml(product.description || product.description_html || product.short_description_html || ""),
  ].join(" "));
}

export function validIndexableProduct(product: TmProduct): boolean {
  // Dočasne vypredaný produkt zostáva hodnotnou existujúcou stránkou a musí
  // zostať indexovateľný. Dostupnosť sa uvádza v obsahu a Product JSON-LD.
  // Ak vo WooCommerce chýba popis, produktová stránka vytvorí z názvu, typu a
  // SKU bezpečný unikátny SEO popis. Trvalo odstránené produkty rieši legacy
  // router samostatným stavom 410.
  return Boolean(
    String(product.slug || "").trim()
    && String(product.name || "").trim()
    && Number(product.price || 0) > 0
  );
}

export function isInkProduct(product: TmProduct): boolean {
  const text = productSearchText(product);
  return /\b(atrament|ink|inkjet|cartridge)\b/.test(text)
    || /\b(napln|naplne|náplň|náplne)\b/.test(text) && !/\btoner\b/.test(text);
}

export function isTonerProduct(product: TmProduct): boolean {
  return /\btoner\b/.test(productSearchText(product)) && !isInkProduct(product);
}

export function landingProducts(products: TmProduct[], kind: CatalogLandingKind): TmProduct[] {
  const filtered = products
    .filter(validIndexableProduct)
    .filter((product) => {
      if (kind === "compatible") return product.product_type_key === "compatible";
      if (kind === "original") return product.product_type_key === "original";
      if (kind === "renovated") return product.product_type_key === "renovated";
      if (kind === "ink") return isInkProduct(product);
      return isTonerProduct(product);
    });
  return sortProducts(filtered);
}

export function findBrand(slug: unknown): BrandDefinition | null {
  const key = entitySlug(slug);
  return SEO_BRANDS.find((brand) => brand.slug === key) || null;
}

function startsWithAlias(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => {
    const normalizedAlias = normalize(alias).replace(/\s+/g, "[\\s-]*");
    return new RegExp(`(^|[^a-z0-9])${normalizedAlias}([^a-z0-9]|$)`, "i").test(text);
  });
}

export function brandProducts(products: TmProduct[], brand: BrandDefinition): TmProduct[] {
  return sortProducts(
    products
      .filter(validIndexableProduct)
      .filter((product) => startsWithAlias(productSearchText(product), brand.aliases)),
  );
}

export function printerBrandForName(name: unknown): BrandDefinition | null {
  const text = normalize(name);
  return SEO_BRANDS.find((brand) => startsWithAlias(text, brand.aliases)) || null;
}

export function printerEntities(products: TmProduct[]): PrinterEntity[] {
  const entities = new Map<string, PrinterEntity>();

  products.filter(validIndexableProduct).forEach((product) => {
    const printers = Array.isArray(product.compatible_printers)
      ? product.compatible_printers
      : Array.isArray(product.printers)
        ? product.printers
        : [];

    printers.forEach((printerName: unknown) => {
      const name = String(printerName || "").replace(/\s+/g, " ").trim();
      const brand = printerBrandForName(name);
      const slug = entitySlug(name);
      if (!brand || !slug || !/\d/.test(name)) return;

      const key = `${brand.slug}/${slug}`;
      const current = entities.get(key) || { brand, name, slug, products: [] };
      if (!current.products.some((item) => String(item.id) === String(product.id))) current.products.push(product);
      entities.set(key, current);
    });
  });

  return [...entities.values()]
    .map((entity) => ({ ...entity, products: sortProducts(entity.products) }))
    .sort((left, right) => left.name.localeCompare(right.name, "sk"));
}

export function findPrinterEntity(products: TmProduct[], brandSlug: unknown, modelSlug: unknown): PrinterEntity | null {
  const brand = findBrand(brandSlug);
  const wantedModel = entitySlug(modelSlug);
  if (!brand || !wantedModel) return null;
  return printerEntities(products).find((entity) => entity.brand.slug === brand.slug && entity.slug === wantedModel) || null;
}

function normalizeOemCode(value: unknown): string {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function productOemCodes(product: TmProduct): string[] {
  const source = `${product.name || ""} ${product.sku || ""}`.toUpperCase();
  const found = source.match(OEM_PATTERN) || [];
  return [...new Set(found.map(normalizeOemCode).filter((code) => code.length >= 4))];
}

export function oemEntities(products: TmProduct[]): OemEntity[] {
  const entities = new Map<string, OemEntity>();

  products.filter(validIndexableProduct).forEach((product) => {
    productOemCodes(product).forEach((code) => {
      const slug = code.toLowerCase();
      const current = entities.get(slug) || { code, slug, products: [], printers: [] };
      if (!current.products.some((item) => String(item.id) === String(product.id))) current.products.push(product);

      const printers = Array.isArray(product.compatible_printers) ? product.compatible_printers : [];
      current.printers.push(...printers.map(String));
      current.printers = [...new Set(current.printers.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 80);
      entities.set(slug, current);
    });
  });

  return [...entities.values()]
    .map((entity) => ({ ...entity, products: sortProducts(entity.products) }))
    .sort((left, right) => left.code.localeCompare(right.code, "sk"));
}

export function findOemEntity(products: TmProduct[], code: unknown): OemEntity | null {
  const wanted = normalizeOemCode(code).toLowerCase();
  if (!wanted) return null;
  return oemEntities(products).find((entity) => entity.slug === wanted) || null;
}

export function catalogStats(products: TmProduct[]): CatalogStats {
  const valid = products.filter(validIndexableProduct);
  const prices = valid.map((product) => Number(product.price || 0)).filter((price) => price > 0);
  const colors = [...new Set(valid
    .map((product) => String(product.color || product.farba || "").replace(/\s+/g, " ").trim())
    .filter(Boolean))]
    .slice(0, 8);

  const compatible = valid.filter((product) => product.product_type_key === "compatible").length;
  const original = valid.filter((product) => product.product_type_key === "original").length;
  const renovated = valid.filter((product) => product.product_type_key === "renovated").length;

  return {
    total: valid.length,
    inStock: valid.filter((product) => product.stock_status === "instock" && Number(product.stock_quantity ?? 1) > 0).length,
    compatible,
    original,
    renovated,
    other: Math.max(0, valid.length - compatible - original - renovated),
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    colors,
  };
}

export function topBrandLinks(products: TmProduct[], limit = 10): EntityLink[] {
  return SEO_BRANDS
    .map((brand) => ({ brand, count: brandProducts(products, brand).length }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.brand.name.localeCompare(right.brand.name, "sk"))
    .slice(0, limit)
    .map(({ brand, count }) => ({
      href: `/znacky/${brand.slug}`,
      label: brand.name,
      count,
      description: `Tonery a náplne pre tlačiarne ${brand.name}`,
    }));
}

export function topPrinterLinks(products: TmProduct[], limit = 12): EntityLink[] {
  return printerEntities(products)
    .sort((left, right) => right.products.length - left.products.length || left.name.localeCompare(right.name, "sk"))
    .slice(0, limit)
    .map((printer) => ({
      href: `/tlaciarne/${printer.brand.slug}/${printer.slug}`,
      label: printer.name,
      count: printer.products.length,
      description: `Kompatibilné produkty pre model ${printer.name}`,
    }));
}

export function topOemLinks(products: TmProduct[], limit = 12): EntityLink[] {
  return oemEntities(products)
    .sort((left, right) => right.products.length - left.products.length || left.code.localeCompare(right.code, "sk"))
    .slice(0, limit)
    .map((oem) => ({
      href: `/oem/${oem.slug}`,
      label: oem.code,
      count: oem.products.length,
      description: `Produkty s OEM označením ${oem.code}`,
    }));
}

export function printerLinksFromNames(allProducts: TmProduct[], names: string[], limit = 16): EntityLink[] {
  const wanted = new Set(names.map((name) => entitySlug(name)).filter(Boolean));
  return printerEntities(allProducts)
    .filter((printer) => wanted.has(printer.slug))
    .sort((left, right) => right.products.length - left.products.length || left.name.localeCompare(right.name, "sk"))
    .slice(0, limit)
    .map((printer) => ({
      href: `/tlaciarne/${printer.brand.slug}/${printer.slug}`,
      label: printer.name,
      count: printer.products.length,
      description: `Tonery a náplne pre ${printer.name}`,
    }));
}

export function collectionJsonLd(
  origin: string,
  canonicalPath: string,
  name: string,
  description: string,
  products: TmProduct[],
  options: {
    generatedAt?: string;
    about?: Array<{ name: string; url?: string }>;
  } = {},
) {
  const url = new URL(canonicalPath, origin).toString();
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name,
    description,
    url,
    isPartOf: { "@id": `${origin}/#website` },
    dateModified: options.generatedAt || undefined,
    about: options.about?.map((entity) => ({
      "@type": "Thing",
      name: entity.name,
      url: entity.url ? new URL(entity.url, origin).toString() : undefined,
    })),
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: products.length,
      itemListElement: products.slice(0, 50).map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: product.name,
        url: new URL(`/produkt/${encodeURIComponent(String(product.slug))}`, origin).toString(),
      })),
    },
  };
}
