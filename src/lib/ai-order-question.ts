export function normalizeOrderQuestion(value: unknown) {
  return String(value || '')
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isOrderStatusQuestion(value: unknown) {
  const text = normalizeOrderQuestion(value);
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
