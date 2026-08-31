const labels: Record<string, string> = {
  pending: 'Čaká na platbu', processing: 'Spracováva sa', 'on-hold': 'Pozastavená',
  completed: 'Dokončená', cancelled: 'Zrušená', refunded: 'Refundovaná', failed: 'Neúspešná',
};

export function publicOrderStatus(order: any) {
  const status = String(order?.status || '').toLowerCase();
  return {
    number: String(order?.number || order?.id || '').replace(/[^a-z0-9._/-]/gi, '').slice(0, 40),
    status,
    statusLabel: labels[status] || 'Stav sa overuje',
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
