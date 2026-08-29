export const CALENDAR_SOURCE = "kalendare-2027";

export function calendarDiscountRate(quantity: unknown) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (qty >= 21) return 0.15;
  if (qty >= 3) return 0.05;
  return 0;
}
