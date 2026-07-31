import {
  SEO_BRANDS,
  brandProducts,
  catalogStats,
  landingProducts,
  oemEntities,
  printerEntities,
  productOemCodes,
  validIndexableProduct,
} from "./seo-catalog";
import { getProductsCache, stripHtml, type TmProduct } from "./tm-products-cache";

export type SeoOpportunityKind = "landing" | "brand" | "printer" | "oem" | "product";
export type SeoOpportunityStatus = "ready" | "improve" | "blocked";
export type SeoOpportunityImpact = "high" | "medium" | "low";

export type SeoOpportunity = {
  id: string;
  kind: SeoOpportunityKind;
  label: string;
  url: string;
  productCount: number;
  inStockCount: number;
  seoScore: number;
  opportunityScore: number;
  status: SeoOpportunityStatus;
  impact: SeoOpportunityImpact;
  suggestedTitle: string;
  suggestedDescription: string;
  directAnswer: string;
  reasons: string[];
  actions: string[];
};

export type SeoOpportunityReport = {
  generatedAt: string;
  sourceGeneratedAt: string;
  sourceProducts: number;
  candidatePages: number;
  limit: number;
  opportunities: SeoOpportunity[];
  counts: {
    ready: number;
    improve: number;
    blocked: number;
    highImpact: number;
    byKind: Record<SeoOpportunityKind, number>;
  };
};

type Quality = {
  total: number;
  inStock: number;
  minPrice: number;
  descriptionCoverage: number;
  imageCoverage: number;
  compatibilityCoverage: number;
  identifierCoverage: number;
  score: number;
};

const PRODUCTION_ORIGIN = "https://www.tonerymaxim.sk";
const PLACEHOLDER_IMAGE = /placeholder|no-image|image-coming-soon|tm-product-placeholder|tm-ink-placeholder/i;
const KINDS: SeoOpportunityKind[] = ["landing", "brand", "printer", "oem", "product"];
const REPORT_CACHE = globalThis as typeof globalThis & {
  __TM_SEO_OPPORTUNITIES__?: { key: string; report: SeoOpportunityReport };
};

function text(value: unknown, max = 5_000): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function ratio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function unique(values: string[], limit = 8): string[] {
  return [...new Set(values.map((value) => text(value, 240)).filter(Boolean))].slice(0, limit);
}

function validImage(product: TmProduct): boolean {
  const source = text(product.image || product.images?.[0], 1_000);
  if (!source || PLACEHOLDER_IMAGE.test(source)) return false;
  try {
    const url = new URL(source, PRODUCTION_ORIGIN);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasDescription(product: TmProduct): boolean {
  return stripHtml(product.short_description_html || product.description_html || product.description || "").length >= 80;
}

function hasCompatibility(product: TmProduct): boolean {
  const printers = Array.isArray(product.compatible_printers)
    ? product.compatible_printers
    : Array.isArray(product.printers)
      ? product.printers
      : [];
  return printers.some((printer: unknown) => text(printer).length >= 4);
}

function hasIdentifier(product: TmProduct): boolean {
  return Boolean(text(product.gtin) || text(product.mpn) || productOemCodes(product).length);
}

function productQuality(products: TmProduct[]): Quality {
  const valid = products.filter(validIndexableProduct);
  const total = valid.length;
  const prices = valid.map((product) => Number(product.price || 0)).filter((price) => price > 0);
  const inStock = valid.filter((product) => (
    product.stock_status === "instock"
    && Number(product.stock_quantity ?? 1) > 0
  )).length;
  const descriptionCoverage = ratio(valid.filter(hasDescription).length, total);
  const imageCoverage = ratio(valid.filter(validImage).length, total);
  const compatibilityCoverage = ratio(valid.filter(hasCompatibility).length, total);
  const identifierCoverage = ratio(valid.filter(hasIdentifier).length, total);
  const stockCoverage = ratio(inStock, total);
  const score = clamp(
    descriptionCoverage * 25
    + imageCoverage * 25
    + compatibilityCoverage * 18
    + identifierCoverage * 12
    + stockCoverage * 20,
  );

  return {
    total,
    inStock,
    minPrice: prices.length ? Math.min(...prices) : 0,
    descriptionCoverage,
    imageCoverage,
    compatibilityCoverage,
    identifierCoverage,
    score,
  };
}

function opportunityScore(kind: SeoOpportunityKind, quality: Quality): number {
  const size = Math.min(42, Math.log2(quality.total + 1) * 8.5);
  const stock = Math.min(23, Math.log2(quality.inStock + 1) * 5);
  const commercial = quality.minPrice > 0 ? 8 : 0;
  const kindBonus: Record<SeoOpportunityKind, number> = {
    landing: 12,
    brand: 10,
    printer: 14,
    oem: 15,
    product: 6,
  };
  return clamp(size + stock + commercial + kindBonus[kind] + quality.score * 0.18);
}

function opportunityState(quality: Quality): SeoOpportunityStatus {
  if (!quality.total || !quality.minPrice || quality.score < 45) return "blocked";
  if (!quality.inStock || quality.score < 78) return "improve";
  return "ready";
}

function impactFor(score: number): SeoOpportunityImpact {
  if (score >= 72) return "high";
  if (score >= 48) return "medium";
  return "low";
}

function percentage(value: number): number {
  return Math.round(value * 100);
}

function actionsFor(quality: Quality, kind: SeoOpportunityKind): string[] {
  const actions: string[] = [];
  if (!quality.inStock) actions.push("Stránka nemá skladový produkt; zatiaľ ju neposilňovať externými odkazmi.");
  if (quality.descriptionCoverage < 0.8) actions.push(`Doplniť plnohodnotné popisy produktov; pokrytie je ${percentage(quality.descriptionCoverage)} %.`);
  if (quality.imageCoverage < 0.9) actions.push(`Nahradiť zástupné alebo neplatné obrázky; pokrytie je ${percentage(quality.imageCoverage)} %.`);
  if (kind !== "product" && quality.compatibilityCoverage < 0.75) actions.push(`Doplniť presné modely kompatibilných tlačiarní; pokrytie je ${percentage(quality.compatibilityCoverage)} %.`);
  if (quality.identifierCoverage < 0.6) actions.push(`Doplniť OEM/MPN/GTIN identifikátory; pokrytie je ${percentage(quality.identifierCoverage)} %.`);
  if (!quality.minPrice) actions.push("Doplniť platnú cenu najmenej jednému produktu.");
  if (!actions.length) actions.push("Stránka je dátovo pripravená; sledovať zobrazenia, CTR a dopyty v Google Search Console.");
  return unique(actions, 6);
}

function reasonsFor(kind: SeoOpportunityKind, quality: Quality): string[] {
  const labels: Record<SeoOpportunityKind, string> = {
    landing: "Hlavná komerčná kategória",
    brand: "Značkový dopyt",
    printer: "Presný model tlačiarne",
    oem: "Presné OEM označenie",
    product: "Konkrétny produkt pripravený na nákup",
  };
  return unique([
    labels[kind],
    `${quality.total} relevantných produktov`,
    `${quality.inStock} produktov skladom`,
    quality.minPrice > 0 ? `Cena od ${quality.minPrice.toFixed(2).replace(".", ",")} €` : "",
  ], 5);
}

function buildOpportunity(options: {
  kind: SeoOpportunityKind;
  id: string;
  label: string;
  url: string;
  products: TmProduct[];
  title: string;
  description: string;
  answer: string;
}): SeoOpportunity {
  const quality = productQuality(options.products);
  const score = opportunityScore(options.kind, quality);
  return {
    id: options.id,
    kind: options.kind,
    label: text(options.label, 180),
    url: new URL(options.url, PRODUCTION_ORIGIN).toString(),
    productCount: quality.total,
    inStockCount: quality.inStock,
    seoScore: quality.score,
    opportunityScore: score,
    status: opportunityState(quality),
    impact: impactFor(score),
    suggestedTitle: text(options.title, 65),
    suggestedDescription: text(options.description, 160),
    directAnswer: text(options.answer, 500),
    reasons: reasonsFor(options.kind, quality),
    actions: actionsFor(quality, options.kind),
  };
}

function landingOpportunities(products: TmProduct[]): SeoOpportunity[] {
  const definitions = [
    { key: "toners", path: "/tonery", label: "Tonery", title: "Tonery do tlačiarní – kompatibilné aj originálne", description: "Vyberte toner podľa tlačiarne alebo OEM označenia. Aktuálne ceny, skladová dostupnosť a kompatibilné alternatívy na jednom mieste." },
    { key: "ink", path: "/atramentove-naplne", label: "Atramentové náplne", title: "Atramentové náplne do tlačiarní – skladom", description: "Atramentové náplne pre HP, Canon, Epson, Brother a ďalšie značky. Vyhľadanie podľa modelu tlačiarne, ceny a dostupnosti." },
    { key: "compatible", path: "/kompatibilne-tonery", label: "Kompatibilné tonery", title: "Kompatibilné tonery – výhodné náplne do tlačiarní", description: "Skladové kompatibilné tonery s overenou vhodnosťou pre konkrétne modely tlačiarní. Porovnajte cenu, kapacitu a dostupnosť." },
    { key: "original", path: "/originalne-tonery", label: "Originálne tonery", title: "Originálne tonery pre HP, Canon, Brother a ďalšie", description: "Originálne tonery a náplne výrobcov tlačiarní. Aktuálne ceny, sklad a presná kompatibilita podľa modelu zariadenia." },
    { key: "renovated", path: "/renovovane-tonery", label: "Renovované tonery", title: "Renovované tonery – ekologická a úsporná voľba", description: "Renovované tonery s aktuálnou cenou, dostupnosťou a zoznamom podporovaných tlačiarní. Vyberte podľa modelu alebo OEM kódu." },
  ] as const;

  return definitions.map((definition) => {
    const matches = landingProducts(products, definition.key);
    const stats = catalogStats(matches);
    return buildOpportunity({
      kind: "landing",
      id: `landing:${definition.key}`,
      label: definition.label,
      url: definition.path,
      products: matches,
      title: definition.title,
      description: definition.description,
      answer: `${definition.label} na ToneryMaxim zahŕňajú ${stats.total} produktov, z toho ${stats.inStock} skladom${stats.minPrice ? ` s cenou od ${stats.minPrice.toFixed(2).replace(".", ",")} €` : ""}.`,
    });
  });
}

function brandOpportunities(products: TmProduct[]): SeoOpportunity[] {
  return SEO_BRANDS.flatMap((brand) => {
    const matches = brandProducts(products, brand);
    if (!matches.length) return [];
    const stats = catalogStats(matches);
    return [buildOpportunity({
      kind: "brand",
      id: `brand:${brand.slug}`,
      label: brand.name,
      url: `/znacky/${brand.slug}`,
      products: matches,
      title: `Tonery ${brand.name} – kompatibilné a originálne náplne`,
      description: `Tonery a atramentové náplne pre tlačiarne ${brand.name}. ${stats.inStock} produktov skladom, výber podľa presného modelu a OEM označenia.`,
      answer: `Pre tlačiarne ${brand.name} evidujeme ${stats.total} vhodných produktov, z toho ${stats.inStock} skladom${stats.minPrice ? ` s cenou od ${stats.minPrice.toFixed(2).replace(".", ",")} €` : ""}.`,
    })];
  });
}

function printerOpportunities(products: TmProduct[]): SeoOpportunity[] {
  return printerEntities(products).map((printer) => {
    const stats = catalogStats(printer.products);
    return buildOpportunity({
      kind: "printer",
      id: `printer:${printer.brand.slug}:${printer.slug}`,
      label: printer.name,
      url: `/tlaciarne/${printer.brand.slug}/${printer.slug}`,
      products: printer.products,
      title: `Tonery pre ${printer.name} – ceny a kompatibilita`,
      description: `Náplne a tonery pre ${printer.name}. ${stats.inStock} možností skladom, aktuálne ceny a overená kompatibilita pre tento model tlačiarne.`,
      answer: `Pre tlačiareň ${printer.name} máme ${stats.total} vhodných produktov, z toho ${stats.inStock} skladom${stats.minPrice ? ` s cenou od ${stats.minPrice.toFixed(2).replace(".", ",")} €` : ""}.`,
    });
  });
}

function oemOpportunities(products: TmProduct[]): SeoOpportunity[] {
  return oemEntities(products).map((entity) => {
    const stats = catalogStats(entity.products);
    return buildOpportunity({
      kind: "oem",
      id: `oem:${entity.slug}`,
      label: entity.code,
      url: `/oem/${entity.slug}`,
      products: entity.products,
      title: `${entity.code} toner a náplne – ceny a kompatibilita`,
      description: `Produkty s OEM označením ${entity.code}. ${stats.inStock} možností skladom, aktuálne ceny a zoznam kompatibilných tlačiarní.`,
      answer: `Pre OEM označenie ${entity.code} evidujeme ${stats.total} produktov, z toho ${stats.inStock} skladom${stats.minPrice ? ` s cenou od ${stats.minPrice.toFixed(2).replace(".", ",")} €` : ""}.`,
    });
  });
}

function productOpportunities(products: TmProduct[]): SeoOpportunity[] {
  return products
    .filter(validIndexableProduct)
    .filter((product) => product.stock_status === "instock" && Number(product.stock_quantity ?? 1) > 0)
    .map((product) => {
      const name = text(product.name, 150);
      const description = stripHtml(product.short_description_html || product.description_html || product.description || "");
      return buildOpportunity({
        kind: "product",
        id: `product:${text(product.id || product.slug, 80)}`,
        label: name,
        url: `/produkt/${encodeURIComponent(String(product.slug))}`,
        products: [product],
        title: name,
        description: description || `${name} – aktuálna cena, dostupnosť, parametre a kompatibilné modely tlačiarní na ToneryMaxim.`,
        answer: `${name} je ${product.stock_status === "instock" ? "skladom" : "momentálne vypredaný"} za ${Number(product.price || 0).toFixed(2).replace(".", ",")} €.`,
      });
    });
}

function configuredLimit(): number {
  const raw = String(process.env.SEO_DOMINATOR_LIMIT || import.meta.env.SEO_DOMINATOR_LIMIT || "").trim();
  const value = raw ? Number(raw) : 100;
  return Math.min(100, Math.max(20, Number.isFinite(value) ? Math.round(value) : 100));
}

export function buildSeoOpportunityReport(
  products: TmProduct[],
  sourceGeneratedAt = "",
  limit = configuredLimit(),
): SeoOpportunityReport {
  const candidates = [
    ...landingOpportunities(products),
    ...brandOpportunities(products),
    ...printerOpportunities(products),
    ...oemOpportunities(products),
    ...productOpportunities(products),
  ];
  const safeLimit = Math.min(100, Math.max(20, Math.round(limit || 100)));
  const opportunities = candidates
    .sort((left, right) => (
      right.opportunityScore - left.opportunityScore
      || right.seoScore - left.seoScore
      || right.inStockCount - left.inStockCount
      || left.label.localeCompare(right.label, "sk")
    ))
    .slice(0, safeLimit);

  const byKind = Object.fromEntries(KINDS.map((kind) => [
    kind,
    opportunities.filter((item) => item.kind === kind).length,
  ])) as Record<SeoOpportunityKind, number>;

  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt,
    sourceProducts: products.length,
    candidatePages: candidates.length,
    limit: safeLimit,
    opportunities,
    counts: {
      ready: opportunities.filter((item) => item.status === "ready").length,
      improve: opportunities.filter((item) => item.status === "improve").length,
      blocked: opportunities.filter((item) => item.status === "blocked").length,
      highImpact: opportunities.filter((item) => item.impact === "high").length,
      byKind,
    },
  };
}

export async function getSeoOpportunityReport(): Promise<SeoOpportunityReport> {
  const cache = await getProductsCache();
  const limit = configuredLimit();
  const key = `${cache.generated_at}:${cache.products.length}:${limit}`;
  if (REPORT_CACHE.__TM_SEO_OPPORTUNITIES__?.key === key) {
    return REPORT_CACHE.__TM_SEO_OPPORTUNITIES__.report;
  }
  const report = buildSeoOpportunityReport(cache.products, cache.generated_at, limit);
  REPORT_CACHE.__TM_SEO_OPPORTUNITIES__ = { key, report };
  return report;
}

export function filterSeoOpportunities(
  opportunities: SeoOpportunity[],
  filters: { kind?: string; status?: string; impact?: string; query?: string },
): SeoOpportunity[] {
  const query = text(filters.query).toLocaleLowerCase("sk");
  return opportunities.filter((item) => {
    if (filters.kind && filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.status && filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.impact && filters.impact !== "all" && item.impact !== filters.impact) return false;
    if (query) {
      const haystack = `${item.label} ${item.url} ${item.suggestedTitle} ${item.reasons.join(" ")} ${item.actions.join(" ")}`.toLocaleLowerCase("sk");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
