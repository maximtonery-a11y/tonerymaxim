import type { ParsedLegacyRoute } from "./parser";

export interface LegacyRedirect {
  location: string;
  status: 301 | 302;
  reason: "static-alias" | "brand-root" | "brand-fallback" | "manufacturer-brand";
}

const STATIC_REDIRECTS: Record<string, string> = {
  "/registrace": "/registracia",
  "/prihlaseni": "/prihlasenie",
  "/login": "/prihlasenie",
  "/doprava": "/doprava-a-platba",
  "/moznosti-platby": "/doprava-a-platba",
  "/platba": "/doprava-a-platba",
  "/reklamacia": "/reklamacie",
  "/reklamacny-poriadok": "/reklamacie",
  "/faq-caste-otazky": "/faq",
  "/caste-otazky": "/faq",
  "/zasady-ochrany-osobnych-udajov": "/ochrana-osobnych-udajov",
  "/ochrana-osobnych-udajov-gdpr": "/ochrana-osobnych-udajov",
  "/gdpr": "/ochrana-osobnych-udajov",
  "/mapa-stranek": "/sitemap.xml",
  "/sklad": "/produkty?stock=instock",
  "/vyhladavanie": "/produkty",
  "/hladat": "/produkty",
};

const MANUFACTURER_REDIRECT_BRANDS = new Set([
  "brother",
  "canon",
  "dell",
  "epson",
  "konica-minolta",
  "lexmark",
  "oki",
  "panasonic",
  "samsung",
  "toshiba",
  "utax",
  "xerox",
]);

const PRINTER_FINDER_BRANDS = new Set([
  "hp",
  "canon",
  "brother",
  "epson",
  "xerox",
  "samsung",
  "lexmark",
  "kyocera",
  "oki",
  "ricoh",
  "konica-minolta",
  "utax",
  "panasonic",
  "toshiba",
  "dell",
  "philips",
  "ibm",
  "sharp",
  "pantum",
]);

function brandTarget(route: ParsedLegacyRoute): string | null {
  if (!route.brandSlug || !route.brandName) return null;
  if (PRINTER_FINDER_BRANDS.has(route.brandSlug)) return `/tlaciarne/${route.brandSlug}`;
  return `/produkty?brand=${encodeURIComponent(route.brandName)}`;
}

export function resolveLegacyRedirect(route: ParsedLegacyRoute): LegacyRedirect | null {
  const staticTarget = STATIC_REDIRECTS[route.normalizedPath];
  if (staticTarget) return { location: staticTarget, status: 301, reason: "static-alias" };

  if (
    route.kind === "manufacturer"
    && route.brandSlug
    && route.legacySlug === route.brandSlug
    && MANUFACTURER_REDIRECT_BRANDS.has(route.brandSlug)
  ) {
    return {
      location: `/tlaciarne/${route.brandSlug}`,
      status: 301,
      reason: "manufacturer-brand",
    };
  }

  if (route.kind === "brand") {
    const location = brandTarget(route);
    if (location) return { location, status: 301, reason: "brand-root" };
  }

  return null;
}

export function resolveLegacyBrandFallback(route: ParsedLegacyRoute): LegacyRedirect | null {
  if (route.kind !== "brand-tree") return null;

  // Category and series URLs are redirected to the relevant brand page. A path
  // ending in a model-like segment (usually contains a number) must not become
  // a soft 404 redirect; an unresolved model is served as a real 404 instead.
  const lastSegment = route.segments.at(-1) || "";
  const looksLikeModel = /\d/.test(lastSegment);
  if (looksLikeModel) return null;

  const location = brandTarget(route);
  return location ? { location, status: 301, reason: "brand-fallback" } : null;
}
