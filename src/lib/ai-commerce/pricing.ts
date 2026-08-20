export type QuantityOffer = { quantity: number; discountPercent: number; unitPrice: number; totalPrice: number; label: string };

export function isCompatibleType(type: unknown) {
  return String(type || '').toLowerCase() === 'compatible';
}

export function quantityDiscount(type: unknown, quantity: number) {
  if (!isCompatibleType(type)) return 0;
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  if (q >= 4) return 25;
  if (q >= 2) return 10;
  return 0;
}

export function priceForQuantity(price: number, type: unknown, quantity: number) {
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  const base = Math.max(0, Number(price) || 0);
  const discountPercent = quantityDiscount(type, q);
  const unitPrice = Math.round(base * (1 - discountPercent / 100) * 100) / 100;
  const totalPrice = Math.round(unitPrice * q * 100) / 100;
  return { quantity: q, discountPercent, unitPrice, totalPrice };
}

export function quantityOffers(price: number, type: unknown): QuantityOffer[] {
  const quantities = isCompatibleType(type) ? [1, 2, 3, 4] : [1, 2, 3, 4];
  return quantities.map(quantity => {
    const p = priceForQuantity(price, type, quantity);
    return { ...p, label: p.discountPercent ? `${quantity} ks – zľava ${p.discountPercent} %` : `${quantity} ks` };
  });
}
