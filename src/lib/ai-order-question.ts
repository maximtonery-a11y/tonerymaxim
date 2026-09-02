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
  const asksStatus = /\b(?:kde|stav|zist|over|skontrol|sled|tracking|track|doruc|odoslan|exped|pripraven|vybav)\w*\b/.test(text)
    || /\bco\s+je\s+s\b/.test(text);
  const shortStatusCommand = /^(?:zist|over|skontrol|ukaz|pozri)\w*(?:\s+(?:mi|prosim)){0,2}\s+stav\w*(?:\s+objednavk\w*)?$/.test(text);
  const inventoryQuestion = /\b(?:sklad|produkt|toner|napln)\w*\b/.test(text) && !hasOrder;
  return !inventoryQuestion && ((hasOrder && asksStatus) || (hasOrderNumber && asksStatus) || shortStatusCommand);
}
