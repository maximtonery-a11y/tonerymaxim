// Recognize a quotation for product quantities, not payment/service instructions.
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const priceService = /\b(?:doprav\w*|postovn\w*|dobier\w*|gopay|kartou|prevod\w*|platb\w*|faktur\w*|objednavk\w*|reklam\w*|refund\w*|vratit\w*|vraten\w*|odstup\w*)\b/;

export function isProductUnitPriceQuestion(message: string): boolean {
  const n=normalize(message);
  return !priceService.test(n) && /\b(?:cen[auy]|stoji|stoja|vyjde|vychadza)\b/.test(n)
    && /\b(?:za|na)\s+(?:(?:1|jeden|jednu|jedno)\s+)?(?:ks|kus)\b|\bjednotkov\w*\s+cen[auy]\b/.test(n);
}

// In "4 kusy, cena za 1 kus" the second number is a price basis,
// not a second requested quantity and not a replacement for four units.
export function productPriceQuantityText(message: string): string {
  return isProductUnitPriceQuestion(message)
    ? message.replace(/\b(?:za|na)\s+(?:1|jeden|jednu|jedno)\s+(?:ks|kus)\b/gi,' ')
    : message;
}

export function productPriceQuantityCount(message: string): number {
  return [...normalize(productPriceQuantityText(message)).matchAll(/\b(?:\d+(?:[.,]\d+)?|jeden|jednu|jedno|dva|dve|tri|styri|pat)\s*(?:ks|kus\w*)\b/g)].length;
}

export function isProductDeliveryPriceQuestion(message: string, deliveryContext = false): boolean {
  const n=normalize(message);
  if (/\b(?:reklam\w*|refund\w*|vratit\w*|vraten\w*|odstup\w*|stav\w*\s+objednavk\w*)\b/.test(n)) return false;
  const price=/\b(?:kolko|cena|cenu|ceny|sum[au]|vyjde|vyjdu|nacen\w*)\b/.test(n);
  const delivery=/\b(?:doprav\w*|postovn\w*|kurier\w*|dorucen\w*|balikomat\w*|pickup|parcelshop|box\w*|dobierk\w*)\b/.test(n);
  const total=/\b(?:spolu|celkom|dokopy|dohromady|celkov\w*)\b/.test(n);
  const product=/\b(?:toner\w*|napln\w*|produkt\w*|tovar\w*|sada|sadu|sady|atrament\w*|to|ho|ju|ich)\b/.test(n);
  const quantity=/\b\d+\s*(?:ks|kus\w*)\b/.test(n);
  const shippingOnly=/\b(?:stoji|stoja|stat|zaplat\w*)\s+(?:za\s+)?(?:doprav\w*|postovn\w*|dobierk\w*)\b/.test(n);
  return price && (delivery && (product || total || quantity&&!shippingOnly) || deliveryContext && total);
}

export function isProductPriceQuestion(message: string): boolean {
  const n=normalize(message);
  if (priceService.test(n)) return false;
  if (isProductUnitPriceQuestion(message)) return true;
  if (!/\b(?:\d{1,3}|jeden|jednu|jedno|dva|dve|tri|styri|pat)\s*(?:ks|kus\w*)\b/.test(n)) return false;
  return /\b(?:kolko\s+(?:(?:ma|nas|to|budem|budeme|mam|mame)\s+){0,3}(?:zaplat\w*|platit|stoji|stoja|stoj\w*|vyjde|vyjdu)|ak[aue]\s+(?:je\s+|bude\s+)?cena|cen[auy]|nacen\w*|vypocitaj\s+(?:cenu|sumu))\b/.test(n);
}
