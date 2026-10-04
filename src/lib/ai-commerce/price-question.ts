// Recognize a quotation for product quantities, not payment/service instructions.
export function isProductPriceQuestion(message: string): boolean {
  const n=message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (!/\b\d{1,3}\s*(?:ks|kus\w*)\b/.test(n)) return false;
  if (/\b(?:doprav\w*|postovn\w*|dobier\w*|gopay|kartou|prevod\w*|platb\w*|faktur\w*|objednavk\w*|reklam\w*|refund\w*|vratit\w*|vraten\w*|odstup\w*)\b/.test(n)) return false;
  return /\b(?:kolko\s+(?:(?:ma|nas|to|budem|budeme|mam|mame)\s+){0,3}(?:zaplat\w*|platit|stoji|stoja|stoj\w*|vyjde|vyjdu)|ak[aue]\s+(?:je\s+|bude\s+)?cena|cen[auy]|nacen\w*|vypocitaj\s+(?:cenu|sumu))\b/.test(n);
}
