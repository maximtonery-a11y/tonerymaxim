import type { ReorderPlan } from './account-reorder';

/** Build the whole merge before saving; existing, unrelated cart items are preserved. */
export function mergeAccountReorder(current: Array<Record<string, any>>, plan: ReorderPlan) {
  if (!Array.isArray(current) || !Array.isArray(plan.items) || !plan.items.length) throw new Error('Nie sú dostupné produkty na vloženie.');
  const cart = current.map(item => ({ ...item }));
  const limited: string[] = [];
  let added = 0;
  for (const item of plan.items) {
    if (!item.sku || !Number.isFinite(item.price) || item.price <= 0 || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 99) {
      throw new Error('Produkty sa nepodarilo overiť. Skúste objednávku načítať znova.');
    }
    const existing = cart.find(entry => entry.sku === item.sku && entry.loyalty_reward !== true);
    const previous = existing ? Math.max(1, Math.min(99, Number.parseInt(String(existing.qty), 10) || 1)) : 0;
    const qty = Math.min(99, previous + item.qty);
    if (previous + item.qty > 99) limited.push(item.name);
    added += qty - previous;
    const fresh = { ...item, qty, catalog_verified: true, catalog_missing: false };
    if (existing) Object.assign(existing, fresh);
    else cart.push(fresh);
  }
  return { cart, added, limited };
}
