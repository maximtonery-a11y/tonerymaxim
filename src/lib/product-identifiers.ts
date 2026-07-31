const INVALID_BRANDS = new Set([
  "n/a",
  "na",
  "none",
  "no brand",
  "bez značky",
  "bez znacky",
  "generic",
  "generická",
  "genericka",
  "kompatibilný",
  "kompatibilny",
  "alternatívny",
  "alternativny",
]);

export function cleanGtin(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return "";

  const checkDigit = Number(digits.at(-1));
  const body = digits.slice(0, -1);
  let sum = 0;

  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }

  const expected = (10 - (sum % 10)) % 10;
  return expected === checkDigit ? digits : "";
}

export function cleanMpn(value: unknown): string {
  const clean = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  if (!clean || /^(?:n\/?a|none|null|undefined|neuveden[ýáe]|bez mpn)$/i.test(clean)) return "";
  return clean;
}

export function cleanProductBrand(value: unknown): string {
  const clean = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  if (!clean || INVALID_BRANDS.has(clean.toLowerCase())) return "";
  return clean;
}

export function gtinSchemaProperty(gtin: string): "gtin8" | "gtin12" | "gtin13" | "gtin14" | null {
  if (gtin.length === 8) return "gtin8";
  if (gtin.length === 12) return "gtin12";
  if (gtin.length === 13) return "gtin13";
  if (gtin.length === 14) return "gtin14";
  return null;
}
