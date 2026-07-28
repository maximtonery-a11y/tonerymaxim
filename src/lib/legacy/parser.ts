// Compatibility parser for historical Shopion URLs.

export const LEGACY_BRANDS = {
  hp: "HP",
  brother: "Brother",
  canon: "Canon",
  epson: "Epson",
  samsung: "Samsung",
  oki: "OKI",
  xerox: "Xerox",
  "konica-minolta": "Konica Minolta",
  minolta: "Konica Minolta",
  kyocera: "Kyocera",
  lexmark: "Lexmark",
  philips: "Philips",
  dell: "Dell",
  ibm: "IBM",
  toshiba: "Toshiba",
  panasonic: "Panasonic",
  sharp: "Sharp",
  ricoh: "Ricoh",
  pantum: "Pantum",
  utax: "Utax",
  develop: "Develop",
  "triumph-adler": "Triumph-Adler",
} as const;

export type LegacyBrandSlug = keyof typeof LEGACY_BRANDS;
export type LegacyRouteKind =
  | "product"
  | "brand"
  | "brand-tree"
  | "manufacturer"
  | "category"
  | "article"
  | "other"
  | "static"
  | "unknown";

export interface ParsedLegacyRoute {
  originalPath: string;
  normalizedPath: string;
  segments: string[];
  kind: LegacyRouteKind;
  brandSlug?: LegacyBrandSlug;
  brandName?: string;
  productSlug?: string;
  legacySlug?: string;
}

const LEGACY_CATEGORY_ROOTS = new Set([
  "kalendare-a-diare-2026",
]);

const LEGACY_OTHER_ROOTS = new Set([
  "ostatne",
  "import-eurodata",
  "undef",
]);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeLegacyPath(input: unknown): string {
  let raw = String(input || "").trim();
  if (!raw) return "/";

  try {
    if (/^https?:\/\//i.test(raw)) raw = new URL(raw).pathname;
  } catch {
    // Invalid absolute URL continues as a normal path.
  }

  raw = raw.split(/[?#]/, 1)[0] || "/";
  raw = raw.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!raw.startsWith("/")) raw = `/${raw}`;

  const segments = raw
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecode(segment).trim().toLowerCase())
    .filter(Boolean);

  return segments.length ? `/${segments.join("/")}` : "/";
}

export function legacySlugToText(value: unknown): string {
  return safeDecode(String(value || ""))
    .replace(/[+_]+/g, " ")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLegacyBrandSlug(value: unknown): value is LegacyBrandSlug {
  return Object.prototype.hasOwnProperty.call(LEGACY_BRANDS, String(value || "").toLowerCase());
}

export function findLegacyBrand(value: unknown): { slug: LegacyBrandSlug; name: string } | null {
  const normalized = normalizeLegacyPath(`/${String(value || "")}`).slice(1);
  const compact = normalized.replace(/[^a-z0-9]+/g, "");

  for (const [slug, name] of Object.entries(LEGACY_BRANDS) as [LegacyBrandSlug, string][]) {
    const slugCompact = slug.replace(/[^a-z0-9]+/g, "");
    const nameCompact = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const slugBoundary = new RegExp(`(?:^|-)${escapedSlug}(?:-|$)`).test(normalized);
    if (
      normalized === slug
      || normalized.startsWith(`${slug}-`)
      || slugBoundary
      || compact.startsWith(slugCompact)
      || compact.startsWith(nameCompact)
    ) {
      return { slug, name };
    }
  }

  return null;
}

export function parseLegacyPath(input: unknown): ParsedLegacyRoute {
  const originalPath = String(input || "") || "/";
  const normalizedPath = normalizeLegacyPath(originalPath);
  const segments = normalizedPath.split("/").filter(Boolean);

  if (!segments.length) {
    return { originalPath, normalizedPath, segments, kind: "unknown" };
  }

  if (segments[0] === "p") {
    const productSlug = segments.slice(1).join("/");
    return {
      originalPath,
      normalizedPath,
      segments,
      kind: productSlug ? "product" : "static",
      productSlug: productSlug || undefined,
      legacySlug: productSlug || undefined,
    };
  }

  if (segments[0] === "vyrobci") {
    const legacySlug = segments.slice(1).join("/");
    const brand = findLegacyBrand(legacySlug);
    return {
      originalPath,
      normalizedPath,
      segments,
      kind: "manufacturer",
      legacySlug: legacySlug || undefined,
      brandSlug: brand?.slug,
      brandName: brand?.name,
    };
  }

  if (segments[0] === "clanky") {
    return {
      originalPath,
      normalizedPath,
      segments,
      kind: "article",
      legacySlug: segments.slice(1).join("/") || undefined,
    };
  }

  if (LEGACY_CATEGORY_ROOTS.has(segments[0])) {
    return {
      originalPath,
      normalizedPath,
      segments,
      kind: "category",
      legacySlug: segments.join("/"),
    };
  }

  if (LEGACY_OTHER_ROOTS.has(segments[0])) {
    return {
      originalPath,
      normalizedPath,
      segments,
      kind: "other",
      legacySlug: segments.join("/"),
    };
  }

  const first = segments[0];
  if (isLegacyBrandSlug(first)) {
    const brandSlug = first;
    return {
      originalPath,
      normalizedPath,
      segments,
      kind: segments.length === 1 ? "brand" : "brand-tree",
      brandSlug,
      brandName: LEGACY_BRANDS[brandSlug],
      legacySlug: segments.at(-1),
    };
  }

  return {
    originalPath,
    normalizedPath,
    segments,
    kind: segments.length === 1 ? "static" : "unknown",
    legacySlug: segments.at(-1),
  };
}
