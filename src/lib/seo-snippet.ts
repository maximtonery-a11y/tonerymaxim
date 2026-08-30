export const SEO_TITLE_LIMIT = 65;
export const SEO_DESCRIPTION_LIMIT = 160;
export const SEO_SITE_SUFFIX = " | ToneryMaxim.sk";

function plainText(value: unknown): string {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(value: string, limit: number): string {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const candidate = text.slice(0, limit + 1).replace(/\s+\S*$/, "").replace(/[\s,;:–—-]+$/g, "");
  return (candidate || text.slice(0, limit)).trim();
}

export function normalizeSeoTitle(value: unknown, fallback = "ToneryMaxim.sk"): string {
  const title = plainText(value) || fallback;
  if (title.length <= SEO_TITLE_LIMIT) return title;
  if (title.endsWith(SEO_SITE_SUFFIX)) {
    const heading = title.slice(0, -SEO_SITE_SUFFIX.length);
    return `${truncateAtWord(heading, SEO_TITLE_LIMIT - SEO_SITE_SUFFIX.length)}${SEO_SITE_SUFFIX}`;
  }
  return truncateAtWord(title, SEO_TITLE_LIMIT);
}

export function normalizeSeoDescription(value: unknown, fallback = "Tonery, náplne a príslušenstvo do tlačiarní skladom na ToneryMaxim.sk."): string {
  const description = plainText(value) || fallback;
  const compact = truncateAtWord(description, SEO_DESCRIPTION_LIMIT);
  if (/[.!?]$/.test(compact)) return compact;
  return `${truncateAtWord(compact, SEO_DESCRIPTION_LIMIT - 1)}.`;
}

export function normalizeCanonical(value: unknown, fallback: string, productionOrigin: string): string {
  let url: URL;
  try {
    url = new URL(String(value || fallback), productionOrigin);
  } catch {
    url = new URL(fallback, productionOrigin);
  }
  const production = new URL(productionOrigin);
  url.protocol = production.protocol;
  url.host = production.host;
  url.hash = "";
  const page = url.searchParams.get("page");
  url.search = "";
  if (page && /^\d+$/.test(page) && Number(page) > 1) url.searchParams.set("page", String(Number(page)));
  return url.toString();
}
