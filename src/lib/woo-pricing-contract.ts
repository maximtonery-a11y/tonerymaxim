import { wooRequest } from './woo-client';

export const WOO_GROSS_PRICE_CONTRACT = 'gross-v1';
type PricingContext = { contract: string; rate_id: number; rate_percent: number; prices_include_tax: boolean; tax_enabled: boolean;
  currency: string; decimals: number; country: string; round_at_subtotal: boolean; compound: boolean; shipping_taxable: boolean };
let cached: { until: number; context: PricingContext } | undefined;
let pending: Promise<PricingContext> | undefined;
const unavailable = () => new Error('Daňové nastavenia obchodu sa nepodarilo bezpečne overiť. Skúste to o chvíľu alebo nás kontaktujte.');

/** Check the matching Woo handler before a new order or a GoPay payment can be started. */
export async function getWooPricingContext(): Promise<PricingContext> {
  if (cached && cached.until > Date.now()) return cached.context;
  if (pending) return pending;
  pending = (async () => {
    let context: PricingContext;
    try { context = await wooRequest<PricingContext>('/tm-pricing-context'); } catch { throw unavailable(); }
    if (context?.contract !== WOO_GROSS_PRICE_CONTRACT || context.rate_percent !== 23 || !Number.isSafeInteger(context.rate_id) || context.rate_id < 1
      || context.prices_include_tax !== true || context.tax_enabled !== true || context.currency !== 'EUR' || context.decimals !== 2
      || context.country !== 'SK' || context.round_at_subtotal !== false || context.compound !== false || context.shipping_taxable !== true) throw unavailable();
    cached = { until: Date.now() + 60_000, context };
    return context;
  })();
  try { return await pending; } finally { pending = undefined; }
}
