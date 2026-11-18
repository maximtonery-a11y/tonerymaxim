import { getOrderStatusLabel, normalizeOrderStatus } from './order-statuses.ts';
import { tmOrderNumber as publicOrderNumber } from './order-display.ts';
export { publicOrderNumber };

export function publicOrderStatus(order: any) {
  const status = normalizeOrderStatus(order?.status);
  const knownLabel = getOrderStatusLabel(status);
  return {
    number: publicOrderNumber(order).replace(/[^a-z0-9._/-]/gi, '').slice(0, 40),
    status,
    statusLabel: knownLabel && knownLabel !== status ? knownLabel : 'Stav sa overuje',
    date: String(order?.date_created || '').slice(0, 32),
    shipping: String(order?.shipping_lines?.[0]?.method_title || '').slice(0, 100),
    tracking: extractTracking(order?.meta_data),
  };
}

function extractTracking(meta: any) {
  const rows = Array.isArray(meta) ? meta : [];
  const hit = rows.find((row: any) => /tracking.*(?:number|cislo)|(?:cislo|number).*tracking|shipment.*number/i.test(String(row?.key || '')));
  return hit ? String(hit.value || '').replace(/[^a-z0-9._/-]/gi, '').slice(0, 100) : '';
}

export function isOrderStatusQuestion(value: unknown) {
  const text = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\b(kde|stav|sleduj|tracking|doruc|odoslan|objednavk)\w*/.test(text) && /\b(objednavk|tracking|zasielk)\w*/.test(text);
}
