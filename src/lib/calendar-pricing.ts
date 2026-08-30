export const CALENDAR_SOURCE = "kalendare-2027";

export function calendarDiscountRate(quantity: unknown) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (qty >= 21) return 0.15;
  if (qty >= 3) return 0.05;
  return 0;
}

export function calendarDiscountedUnitPrice(price: unknown, quantity: unknown) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * (1 - calendarDiscountRate(quantity)) * 100) / 100;
}
