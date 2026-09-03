const PRODUCT_SLUG_ALIASES: Record<string, string> = {
  // Pôvodné verejné URL pred doplnením farby do názvu produktu.
  'brother-tn-2421-kompatibilny-toner': 'brother-tn-2421-cierny-kompatibilny-toner',
  'brother-tn-2421-originalny-toner': 'brother-tn-2421-cierny-originalny-toner',
  'brother-tn-2421-renovovany-toner': 'brother-tn-2421-cierny-renovovany-toner',
};

export function currentProductSlug(value: unknown) {
  const slug = String(value || '').trim().toLowerCase();
  return PRODUCT_SLUG_ALIASES[slug] || slug;
}

export function isLegacyProductSlug(value: unknown) {
  const slug = String(value || '').trim().toLowerCase();
  return Boolean(PRODUCT_SLUG_ALIASES[slug]);
}
