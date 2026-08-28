function safeDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysUntil(value: string, now = new Date()): number | null {
  const due = safeDate(value);
  if (!due) return null;
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((dueDay - start) / 86_400_000);
}

export function shouldSendTonerCareReminder(value: string, now = new Date()): boolean {
  const remaining = daysUntil(value, now);
  return remaining !== null && remaining <= 21 && remaining >= -7;
}
