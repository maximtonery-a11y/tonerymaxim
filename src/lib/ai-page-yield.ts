const normalize = (value: unknown) => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A volume/weight is never a page yield. Bare integer legacy values denote pages. */
export function parsePageYieldValue(value: unknown): number | null {
  const text = normalize(value);
  const number = '(?:\\d{1,3}(?:[ .,]\\d{3})+|\\d+)';
  const valid = (raw: string) => {
    const n = Number(raw.replace(/[ .,]/g, ''));
    return Number.isSafeInteger(n) && n > 0 && n <= 10_000_000 ? n : null;
  };
  // A labelled page count may coexist with ink volume (e.g. 130 ml / 3000 pages).
  // Keep all declared yields in a CMYK pack; its lowest yield is the limit.
  const labelled = [...text.matchAll(new RegExp(`(?:^|[^a-z0-9.,+\\-])(${number})\\s*(?:stran(?:a|y|ok)?|pages?|str\\.)(?=$|[^a-z])`, 'g'))]
    .map(match => valid(match[1])).filter((n): n is number => n !== null);
  if (/(?:^|\s)[-−]\s*\d|\d\s*[-–—]\s*\d/.test(text)) return null; // a range is not an exact yield
  if (labelled.length) return Math.min(...labelled);
  return new RegExp(`^${number}$`).test(text) ? valid(text) : null;
}

/** Shared by Advisor and the rendered product/quantity/set cards. */
export function productPageYield(product: Record<string, any>): number | null {
  const candidates = [product?.page_yield, product?.capacity, product?.kapacita, product?.yield];
  for (const attribute of Array.isArray(product?.attributes) ? product.attributes : []) {
    const name = normalize(attribute?.name);
    if (!/kapacit|vytaz|yield|stran|page/.test(name)) continue;
    const values = [attribute?.value, ...(Array.isArray(attribute?.options) ? attribute.options : [])];
    for (const value of values) {
      // The attribute itself may supply the unit for a numeric value.
      if (/\b(?:ml|cl|dl|l|g|kg|lit\w*|gram\w*)\b/.test(name)) candidates.push(`${value} ${name}`);
      else candidates.push(value);
    }
  }
  for (const value of candidates) {
    const pages = parsePageYieldValue(value);
    if (pages !== null) return pages;
  }
  return null;
}
