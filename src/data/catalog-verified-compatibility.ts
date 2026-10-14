// Verified 2026-10-14 against Lexmark's exact 56F2X0E device list.
// The supplier names SKU 16043 as a replacement for this exact OEM cartridge.
// Use its OEM device list only for this record, and only when supplier models
// are missing. This is not a brand/number heuristic or a firmware guarantee.
export const lexmark56F2X0E = {
  id: 53282,
  sku: '16043',
  source: 'https://www.lexmark.com/sk_sk/printers/supply/11899/Lexmark-56F2X0E-Black-Extra-High-Yield-Corporate-Toner-Cartr',
  printers: [
    'Lexmark MX521de', 'Lexmark MS421dw', 'Lexmark MS521dn',
    'Lexmark MX521ade', 'Lexmark MX622ade', 'Lexmark MS621dn',
    'Lexmark MX522adhe', 'Lexmark MS622de', 'Lexmark MX622adhe',
    'Lexmark MS421dn', 'Lexmark MX421ade',
  ],
};

export function fillVerifiedCompatibility(product: Record<string, any>) {
  if (Number(product.id) !== lexmark56F2X0E.id || String(product.sku) !== lexmark56F2X0E.sku
    || !/\bLexmark\b/i.test(product.name || '') || !/\b56F2X0E\b/i.test(product.name || '')
    || product.compatible_printers?.length || product.printers?.length) return false;
  product.compatible_printers = [...lexmark56F2X0E.printers];
  product.printers = product.compatible_printers;
  product.compatibility_source = lexmark56F2X0E.source;
  return true;
}
