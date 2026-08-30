import type { TmProduct } from "./tm-products-cache.ts";

const ALIASES: Record<string, string> = {
  hp: "HP", "hewlett packard": "HP", canon: "Canon", brother: "Brother",
  epson: "Epson", xerox: "Xerox", samsung: "Samsung", lexmark: "Lexmark",
  kyocera: "Kyocera", oki: "OKI", ricoh: "Ricoh", dell: "Dell", utax: "Utax",
  toshiba: "Toshiba", panasonic: "Panasonic", sharp: "Sharp", pantum: "Pantum",
  dymo: "Dymo", ibm: "IBM", develop: "Develop", minolta: "Konica Minolta",
  konica: "Konica Minolta", "konica minolta": "Konica Minolta", philips: "Philips",
  star: "STAR", seikosha: "Seikosha", selex: "Selex", olivetti: "Olivetti",
  citizen: "Citizen", fujitsu: "Fujitsu", casio: "Casio",
};
const BRAND_MATCHERS = Object.entries(ALIASES).map(([alias, brand]) => {
  const escaped = alias.replace(/[.*+?^()|[\]\\]/g, "\\$&");
  return { brand, pattern: new RegExp('(^|[^a-zá-ž0-9])' + escaped + '([^a-zá-ž0-9]|$)', "iu") };
});
const resolvedBrandCache = new WeakMap<TmProduct, string>();

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonical(value: unknown): string {
  return ALIASES[clean(value).toLocaleLowerCase("sk")] || "";
}

function brandsInName(name: string): string[] {
  const found = new Set<string>();
  for (const matcher of BRAND_MATCHERS) {
    if (matcher.pattern.test(name)) found.add(matcher.brand);
  }
  return [...found];
}

/** Značku vráti iba z jednoznačného zdroja, nikdy ju neodhaduje podľa tlačiarne. */
export function resolvedPublicationBrand(product: TmProduct): string {
  const cached = resolvedBrandCache.get(product);
  if (cached !== undefined) return cached;
  const explicit = canonical(product.product_brand);
  const name = clean(product.name);
  const named = brandsInName(name);
  let resolved = "";
  if (explicit) {
    resolved = named.length > 1 && !named.includes(explicit) ? "" : explicit;
  } else if (named.length === 1) {
    resolved = named[0];
  } else if (named.length > 1) {
    resolved = named.find((brand) => name.toLocaleLowerCase("sk").startsWith(brand.toLocaleLowerCase("sk"))) || "";
  } else if (/\bC\s*-?\s*EXV\s*-?\s*\d/i.test(name)) {
    resolved = "Canon";
  }
  resolvedBrandCache.set(product, resolved);
  return resolved;
}

export function publicationEligibleProduct(product: TmProduct): boolean {
  return Boolean(resolvedPublicationBrand(product)
    && clean(product.slug)
    && clean(product.name)
    && Number(product.price || 0) > 0);
}
