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
  const asksStatus = /\b(?:kde|stav|sled|tracking|track|doruc|odoslan|exped|pripraven|vybav)\w*\b/.test(text)
    || /\bco\s+je\s+s\b/.test(text);
  return hasOrder && asksStatus;
}
