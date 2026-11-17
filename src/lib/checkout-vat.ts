import { CALENDAR_SOURCE, calendarDiscountedUnitPrice } from './calendar-pricing.ts';

const cents = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};

/** Retail prices already include SK 23% VAT. Split each monetary line once, in cents. */
export function grossVatParts(value: unknown) {
  const gross = cents(value);
  const sign = gross < 0 ? -1 : 1;
  const net = Math.round(Math.abs(gross) * 100 / 123) * sign;
  return { gross: gross / 100, net: net / 100, tax: (gross - net) / 100 };
}

export function grossVatTotals(lines: readonly unknown[], displayedGross?: unknown) {
  let gross = 0, tax = 0;
  for (const value of lines) { const parts = grossVatParts(value); gross += cents(parts.gross); tax += cents(parts.tax); }
  if (displayedGross !== undefined) gross = cents(displayedGross);
  return { gross: gross / 100, net: (gross - tax) / 100, tax: tax / 100 };
}

/** Same existing quantity rules as the authoritative server; never discounts unrelated CMYK lines. */
export function discountedGrossLine(item: Record<string, any>) {
  const quantity = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
  const price = Number(item.price) || 0;
  const original = cents(price * quantity) / 100;
  if (String(item.source || '') === CALENDAR_SOURCE || String(item.id || '').startsWith('calendar:')) {
    return cents(calendarDiscountedUnitPrice(price, quantity) * quantity) / 100;
  }
  const compatible = String(item.product_type_key || '').toLowerCase() === 'compatible' || String(item.product_type_label || item.name || '').toLowerCase().includes('kompatibil');
  const rate = compatible ? quantity >= 4 ? 0.25 : quantity >= 2 ? 0.1 : 0 : 0;
  // Keep the established server's line-discount rounding, including its order of operations.
  return cents(Math.max(0, original - cents(original * rate) / 100)) / 100;
}

export function checkoutGrossLines(source: { cart?: Record<string, any>[]; shippingPrice?: unknown; paymentPrice?: unknown; coupon?: { discount?: unknown } | null; loyaltyDiscount?: unknown }) {
  return [...(source.cart || []).map(discountedGrossLine), Number(source.shippingPrice || 0), Number(source.paymentPrice || 0),
    -Number(source.coupon?.discount || 0), -Number(source.loyaltyDiscount || 0)];
}
