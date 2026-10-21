import { forbidsCartMutation, isNonExecutingShoppingRequest } from './ai-cart-safety.ts';

export function normalizeOrderQuestion(value: unknown) {
  return String(value || '')
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isDeliveredButMissingQuestion(value: unknown) {
  const text = normalizeOrderQuestion(value);
  return /\b(?:dorucen|dorucil|odovzdan)\w*\b/.test(text)
    && /\b(?:nemam|nepris|nedostal|neprevzal|neobdrzal|chyba|nenasiel|nie je)\w*\b/.test(text)
    && /\b(?:objednavk|zasielk|balik|tracking|track|kurier|dopravc)\w*\b/.test(text);
}

// Opakovanie objednávky mení košík. Zmienka o poslednej objednávke ani
// otázka na postup nie sú súhlasom s touto akciou.
export function isOrderRepeatCommand(value: unknown) {
  const text = normalizeOrderQuestion(value);
  if (forbidsCartMutation(value) || isNonExecutingShoppingRequest(value)) return false;
  if (/\b(?:ako|preco|mozem|da sa|nezopak\w*|neopak\w*)\b/.test(text.replace(/ako naposledy/g, 'naposledy'))) return false;
  const target = /\b(?:objednavk\w*|nakup\w*|naposledy)\b/.test(text);
  const imperative = /\b(?:zopakuj(?:te)?|objednaj(?:te)?|posli(?:te)?)\b/.test(text);
  const explicitWish = /^(?:prosim\s+)?chcem\s+(?:si\s+)?zopakovat\b/.test(text);
  return target && (imperative || explicitWish);
}

export function requestedOrderNumber(value: unknown) {
  return normalizeOrderQuestion(value).match(/\b(?:tm\s*)?(\d{5,12})\b/)?.[1] || null;
}

export function selectRequestedOrder<T extends { number?: unknown }>(orders: T[], question: unknown): T | undefined {
  const number = requestedOrderNumber(question);
  return number ? orders.find(order => String(order.number) === number) : orders[0];
}

export function isOrderStatusQuestion(value: unknown) {
  const text = normalizeOrderQuestion(value);
  // „Kde nájdem 7 % odmenu za objednávku?“ asks about a benefit, not the
  // customer's last order. Keep it in advice, including before the API call.
  const benefitQuestion = /\b(?:zlav|kupon|vernost|odmen)\w*\b|\bbod(?:y|ov|mi|och|u|om)?\b/.test(text);
  const explicitOrderStatus = /\b(?:stav\w*\s+objednavk\w*|tracking|sledovanie\s+zasielk\w*)\b|\bkde\s+(?:je|su)\s+(?:(?:moja|moje|ta|tato)\s+)?(?:objednavk|zasielk|balik)\w*\b/.test(text);
  if (benefitQuestion && !explicitOrderStatus) return false;
  // Storno, zmena, reklamácia, vrátenie či refundácia sú servisné otázky.
  // Ani slová „pred expedíciou“ ich nesmú presmerovať na poslednú objednávku.
  if (/\b(?:storno|stornovat|zrusit|zmena|zmenit|upravit|reklam|vratit|vraten|odstup|refund|peniaz|platb)\w*\b/.test(text)) return false;
  // „Tracking ukazuje doručené, ale balík nemám“ nie je požiadavka na
  // zobrazenie poslednej objednávky. Je to reklamačný/bezpečnostný scenár,
  // ktorý musí prejsť do poradenskej vrstvy aj prihlásenému zákazníkovi.
  if (isDeliveredButMissingQuestion(value)) return false;
  const hasOrder = /\b(?:objednavk|zasielk|balik)\w*\b/.test(text);
  const hasOrderNumber = /\b(?:tm\s*)?\d{5,12}\b/.test(text);
  const explicitStatus = /\b(?:kde|stav|zist|over|skontrol|sled|tracking|track)\w*\b/.test(text);
  // Otázka „kedy bude doručená?“ žiada všeobecnú dodaciu lehotu. Bez čísla
  // objednávky alebo výslovnej požiadavky na stav nesmie otvoriť formulár.
  const generalDeliveryTiming = /\b(?:kedy|ako dlho|kolko)\b[^.?!]*\b(?:doruc|pride|dodanie|dorucenie)\w*\b/.test(text)
    && !hasOrderNumber && !explicitStatus;
  const asksStatus = /\b(?:kde|stav|zist|over|skontrol|sled|tracking|track|doruc|odoslan|exped|pripraven|vybav)\w*\b/.test(text)
    || /\bco\s+je\s+s\b/.test(text);
  const shortStatusCommand = /^(?:zist|over|skontrol|ukaz|pozri)\w*(?:\s+(?:mi|prosim)){0,2}\s+stav\w*(?:\s+objednavk\w*)?$/.test(text);
  const inventoryQuestion = /\b(?:sklad|produkt|toner|napln)\w*\b/.test(text) && !hasOrder;
  return !inventoryQuestion && !generalDeliveryTiming && ((hasOrder && asksStatus) || (hasOrderNumber && asksStatus) || shortStatusCommand);
}
