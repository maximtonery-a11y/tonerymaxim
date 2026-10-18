import { analyzeCatalogQuery } from './catalog-query.ts';

export function isGeneralProductTypeComparison(message: string) {
  const n = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const types = [/\boriginal\w*\b/, /\bkompatibil\w*\b/, /\b(?:renov|repas)\w*\b/].filter(pattern => pattern.test(n));
  return types.length >= 2
    && /\b(?:rozdiel\w*|porovnaj|porovnat|versus|vs|alebo|leps\w*|oplat\w*)\b/.test(n)
    && !analyzeCatalogQuery(message).hasReference;
}
