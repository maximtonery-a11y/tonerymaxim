import { normalize, sortProducts, stripHtml, type TmProduct } from "./tm-products-cache.ts";
import { sameConsumablePrinterFamily } from "./printer-model-family.ts";
import { publicationEligibleProduct } from "./product-publication-policy.ts";

export type { TmProduct } from "./tm-products-cache.ts";

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

const OEM_PATTERN = /\b(?:TN|DR|LC|CLI|PGI|PG|CL|CRG|CF|CE|W|Q|TK|MLT|CLT|T)[\s-]*\d{2,6}(?:[\s-]*[A-Z]{1,3})?\b|\b(?:C13T|C13S)[A-Z0-9]{4,12}\b|\b\d{3}R\d{5}\b/gi;

// Derived SEO indexes are expensive to rebuild for every SSR request.
// Product cache objects are replaced when the catalogue is refreshed, so WeakMap
// entries automatically follow the lifetime of the corresponding product arrays.
// This keeps storefront output identical while avoiding repeated normalization,
// filtering, sorting and entity-index construction under concurrent traffic.
const productSearchTextCache = new WeakMap<TmProduct, string>();
const landingProductsCache = new WeakMap<TmProduct[], Map<CatalogLandingKind, TmProduct[]>>();
const brandProductsCache = new WeakMap<TmProduct[], Map<string, TmProduct[]>>();
const printerEntitiesCache = new WeakMap<TmProduct[], PrinterEntity[]>();
const printerEntityLookupCache = new WeakMap<TmProduct[], Map<string, PrinterEntity | null>>();
const oemEntitiesCache = new WeakMap<TmProduct[], OemEntity[]>();
const oemEntityLookupCache = new WeakMap<TmProduct[], Map<string, OemEntity>>();
const catalogStatsCache = new WeakMap<TmProduct[], CatalogStats>();
const topBrandLinksCache = new WeakMap<TmProduct[], Map<number, EntityLink[]>>();
const topPrinterLinksCache = new WeakMap<TmProduct[], Map<number, EntityLink[]>>();
const topOemLinksCache = new WeakMap<TmProduct[], Map<number, EntityLink[]>>();

export function entitySlug(value: unknown): string {
  return normalize(value)
    .replace(/&/g, " a ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function productSearchText(product: TmProduct): string {
  const cached = productSearchTextCache.get(product);
  if (cached !== undefined) return cached;

  // Runtime katalóg už obsahuje normalizovaný search_text s názvom, SKU,
  // kategóriou, parametrami a kompatibilnými tlačiarňami. Jeho opätovné
  // skladanie vytváralo pri 7 000+ produktoch druhú veľkú sadu reťazcov v RAM.
  const runtimeText = String(product.search_text || "").trim();
  if (runtimeText) {
    productSearchTextCache.set(product, runtimeText);
    return runtimeText;
  }

  const categories = Array.isArray(product.categories)
    ? product.categories.map((item: any) => `${item?.name || ""} ${item?.slug || ""}`).join(" ")
    : "";
  const attributes = Array.isArray(product.attributes_all)
    ? product.attributes_all.map((item: any) => `${item?.name || ""} ${item?.value || ""}`).join(" ")
    : "";
  const text = normalize([
    product.name,
    product.sku,
    product.slug,
    categories,
    attributes,
    product.search_text,
    stripHtml(product.description || product.description_html || product.short_description_html || ""),
  ].join(" "));
  productSearchTextCache.set(product, text);
  return text;
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
    && publicationEligibleProduct(product)
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
  let byKind = landingProductsCache.get(products);
  if (!byKind) {
    byKind = new Map<CatalogLandingKind, TmProduct[]>();
    landingProductsCache.set(products, byKind);
  }
  const cached = byKind.get(kind);
  if (cached) return cached;

  const filtered = products
    .filter(validIndexableProduct)
    .filter((product) => {
      // Typové landing stránky sú podstránkami sekcie Tonery. Preto musia
      // vychádzať z rovnakého laserového sortimentu ako /tonery a nesmú do
      // štatistík primiešať atramenty, valce ani ostatné komponenty.
      if (kind === "compatible") return product.product_type_key === "compatible" && isTonerProduct(product);
      if (kind === "original") return product.product_type_key === "original" && isTonerProduct(product);
      if (kind === "renovated") return product.product_type_key === "renovated" && isTonerProduct(product);
      if (kind === "ink") return isInkProduct(product);
      return isTonerProduct(product);
    });
  const result = sortProducts(filtered);
  byKind.set(kind, result);
  return result;
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
  let byBrand = brandProductsCache.get(products);
  if (!byBrand) {
    byBrand = new Map<string, TmProduct[]>();
    brandProductsCache.set(products, byBrand);
  }
  const cached = byBrand.get(brand.slug);
  if (cached) return cached;

  const result = sortProducts(
    products
      .filter(validIndexableProduct)
      .filter((product) => startsWithAlias(productSearchText(product), brand.aliases)),
  );
  byBrand.set(brand.slug, result);
  return result;
}

export function printerBrandForName(name: unknown): BrandDefinition | null {
  const text = normalize(name);
  return SEO_BRANDS.find((brand) => startsWithAlias(text, brand.aliases)) || null;
}

export function printerEntities(products: TmProduct[]): PrinterEntity[] {
  const cached = printerEntitiesCache.get(products);
  if (cached) return cached;

  const entities = new Map<string, PrinterEntity>();
  const productIdsByEntity = new Map<string, Set<string>>();

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
      const productId = String(product.id || product.slug || product.sku || "");
      const productIds = productIdsByEntity.get(key) || new Set<string>();
      if (productId && !productIds.has(productId)) {
        productIds.add(productId);
        current.products.push(product);
      }
      productIdsByEntity.set(key, productIds);
      entities.set(key, current);
    });
  });

  const result = [...entities.values()]
    .map((entity) => ({ ...entity, products: sortProducts(entity.products) }))
    .sort((left, right) => left.name.localeCompare(right.name, "sk"));
  printerEntitiesCache.set(products, result);
  const lookup = printerEntityLookupCache.get(products) || new Map<string, PrinterEntity | null>();
  for (const entity of result) lookup.set(`${entity.brand.slug}/${entity.slug}`, entity);
  printerEntityLookupCache.set(products, lookup);
  return result;
}

export function findPrinterEntity(products: TmProduct[], brandSlug: unknown, modelSlug: unknown): PrinterEntity | null {
  const brand = findBrand(brandSlug);
  const wantedModel = entitySlug(modelSlug);
  if (!brand || !wantedModel) return null;
  const lookupKey = `${brand.slug}/${wantedModel}`;
  let lookup = printerEntityLookupCache.get(products);
  if (!lookup) {
    lookup = new Map<string, PrinterEntity | null>();
    printerEntityLookupCache.set(products, lookup);
  }
  if (lookup.has(lookupKey)) return lookup.get(lookupKey) || null;
  let exactName = "";
  const exactProducts = new Map<string, TmProduct>();

  // Detail jedného modelu nesmie kvôli jednej zhode zostavovať a triediť
  // globálny index všetkých tisícov tlačiarní. Priamo prejdeme kompaktné
  // priradenia produktov a ponecháme iba požadovaný model.
  for (const product of products) {
    if (!validIndexableProduct(product)) continue;
    const names = Array.isArray(product.compatible_printers)
      ? product.compatible_printers
      : Array.isArray(product.printers) ? product.printers : [];
    for (const rawName of names) {
      const name = String(rawName || "").replace(/\s+/g, " ").trim();
      if (entitySlug(name) !== wantedModel || printerBrandForName(name)?.slug !== brand.slug) continue;
      exactName ||= name;
      const key = String(product.id || product.slug || product.sku || "");
      if (key) exactProducts.set(key, product);
      break;
    }
  }
  if (!exactName) {
    lookup.set(lookupKey, null);
    return null;
  }

  if (!["xerox", "samsung"].includes(brand.slug)) {
    const result = { brand, name: exactName, slug: wantedModel, products: sortProducts([...exactProducts.values()]) };
    lookup.set(lookupKey, result);
    return result;
  }

  const familyProducts = new Map(exactProducts);
  for (const product of products) {
    const names = Array.isArray(product.compatible_printers) ? product.compatible_printers : [];
    if (!names.some((name: unknown) => printerBrandForName(name)?.slug === brand.slug && sameConsumablePrinterFamily(exactName, String(name || "")))) continue;
    const key = String(product.id || product.slug || product.sku || "");
    if (key) familyProducts.set(key, product);
  }
  const result = { brand, name: exactName, slug: wantedModel, products: sortProducts([...familyProducts.values()]) };
  lookup.set(lookupKey, result);
  return result;
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
  const cached = oemEntitiesCache.get(products);
  if (cached) return cached;

  const entities = new Map<string, OemEntity>();
  const productIdsByEntity = new Map<string, Set<string>>();
  const printersByEntity = new Map<string, Set<string>>();

  products.filter(validIndexableProduct).forEach((product) => {
    productOemCodes(product).forEach((code) => {
      const slug = code.toLowerCase();
      const current = entities.get(slug) || { code, slug, products: [], printers: [] };
      const productId = String(product.id || product.slug || product.sku || "");
      const productIds = productIdsByEntity.get(slug) || new Set<string>();
      if (productId && !productIds.has(productId)) {
        productIds.add(productId);
        current.products.push(product);
      }
      productIdsByEntity.set(slug, productIds);

      const printers = Array.isArray(product.compatible_printers) ? product.compatible_printers : [];
      const printerSet = printersByEntity.get(slug) || new Set<string>();
      for (const printer of printers) {
        if (printerSet.size >= 80) break;
        const name = String(printer || "").replace(/\s+/g, " ").trim();
        if (name) printerSet.add(name);
      }
      printersByEntity.set(slug, printerSet);
      entities.set(slug, current);
    });
  });

  const result = [...entities.values()]
    .map((entity) => ({
      ...entity,
      products: sortProducts(entity.products),
      printers: [...(printersByEntity.get(entity.slug) || [])],
    }))
    .sort((left, right) => left.code.localeCompare(right.code, "sk"));
  oemEntitiesCache.set(products, result);
  oemEntityLookupCache.set(products, new Map(result.map((entity) => [entity.slug, entity])));
  return result;
}

export function findOemEntity(products: TmProduct[], code: unknown): OemEntity | null {
  const wanted = normalizeOemCode(code).toLowerCase();
  if (!wanted) return null;
  let lookup = oemEntityLookupCache.get(products);
  if (!lookup) {
    oemEntities(products);
    lookup = oemEntityLookupCache.get(products);
  }
  return lookup?.get(wanted) || null;
}

export function catalogStats(products: TmProduct[]): CatalogStats {
  const cached = catalogStatsCache.get(products);
  if (cached) return cached;

  const valid = products.filter(validIndexableProduct);
  const prices = valid.map((product) => Number(product.price || 0)).filter((price) => price > 0);
  const colors = [...new Set(valid
    .map((product) => String(product.color || product.farba || "").replace(/\s+/g, " ").trim())
    .filter(Boolean))]
    .slice(0, 8);

  const compatible = valid.filter((product) => product.product_type_key === "compatible").length;
  const original = valid.filter((product) => product.product_type_key === "original").length;
  const renovated = valid.filter((product) => product.product_type_key === "renovated").length;

  const result = {
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
  catalogStatsCache.set(products, result);
  return result;
}

export function topBrandLinks(products: TmProduct[], limit = 10): EntityLink[] {
  let byLimit = topBrandLinksCache.get(products);
  if (!byLimit) { byLimit = new Map<number, EntityLink[]>(); topBrandLinksCache.set(products, byLimit); }
  const cached = byLimit.get(limit);
  if (cached) return cached;
  const result = SEO_BRANDS
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
  byLimit.set(limit, result);
  return result;
}

export function topPrinterLinks(products: TmProduct[], limit = 12): EntityLink[] {
  let byLimit = topPrinterLinksCache.get(products);
  if (!byLimit) { byLimit = new Map<number, EntityLink[]>(); topPrinterLinksCache.set(products, byLimit); }
  const cached = byLimit.get(limit);
  if (cached) return cached;
  const result = [...printerEntities(products)]
    .sort((left, right) => right.products.length - left.products.length || left.name.localeCompare(right.name, "sk"))
    .slice(0, limit)
    .map((printer) => ({
      href: `/tlaciarne/${printer.brand.slug}/${printer.slug}`,
      label: printer.name,
      count: printer.products.length,
      description: `Kompatibilné produkty pre model ${printer.name}`,
    }));
  byLimit.set(limit, result);
  return result;
}

export function topOemLinks(products: TmProduct[], limit = 12): EntityLink[] {
  let byLimit = topOemLinksCache.get(products);
  if (!byLimit) { byLimit = new Map<number, EntityLink[]>(); topOemLinksCache.set(products, byLimit); }
  const cached = byLimit.get(limit);
  if (cached) return cached;
  const result = [...oemEntities(products)]
    .sort((left, right) => right.products.length - left.products.length || left.code.localeCompare(right.code, "sk"))
    .slice(0, limit)
    .map((oem) => ({
      href: `/oem/${oem.slug}`,
      label: oem.code,
      count: oem.products.length,
      description: `Produkty s OEM označením ${oem.code}`,
    }));
  byLimit.set(limit, result);
  return result;
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
