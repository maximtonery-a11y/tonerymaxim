export type TonerCareReminder = { scheduled_for: string; customer_sent_at?: string; admin_sent_at?: string };
export type TonerCareHistoryEntry = {
  cycle_id: string;
  installed_at: string;
  expected_replacement_at: string;
  ended_at: string;
  reason: "expired" | "disabled" | "changed";
  reminders: TonerCareReminder[];
};
export type TonerCarePlan = {
  title: string;
  care_enabled?: boolean;
  installed_at?: string;
  expected_replacement_at?: string;
  expected_months?: number;
  care_cycle_id?: string;
  care_ended_at?: string;
  care_end_reason?: TonerCareHistoryEntry["reason"];
  care_reminders?: TonerCareReminder[];
  care_history?: TonerCareHistoryEntry[];
  customer_reminder_sent_for?: string;
  admin_reminder_sent_for?: string;
  last_reminder_at?: string;
};

export function validPlanDate(value: unknown): string {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const date = new Date(`${raw}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : "";
}

export function bratislavaDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(value: string): number {
  return Date.parse(`${value}T12:00:00.000Z`) / 86_400_000;
}

export function daysUntil(value: string, now = new Date()): number | null {
  const due = validPlanDate(value);
  return due ? Math.round(dayNumber(due) - dayNumber(bratislavaDay(now))) : null;
}

export function replacementDate(installedAt: string, months: number): string {
  if (!validPlanDate(installedAt) || !Number.isInteger(months) || months < 1 || months > 24) return "";
  const start = new Date(`${installedAt}T12:00:00.000Z`);
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

export function tonerCareReminderDates(value: string): string[] {
  const due = validPlanDate(value);
  if (!due) return [];
  const end = new Date(`${due}T12:00:00.000Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1, 12));
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 12)).getUTCDate();
  start.setUTCDate(Math.min(end.getUTCDate(), lastDay));
  const dates: string[] = [];
  while (start.getTime() <= end.getTime()) {
    dates.push(start.toISOString().slice(0, 10));
    start.setUTCDate(start.getUTCDate() + 7);
  }
  return dates;
}

export function shouldSendTonerCareReminder(value: string, now = new Date()): boolean {
  const due = validPlanDate(value);
  const today = bratislavaDay(now);
  const first = tonerCareReminderDates(due)[0];
  return Boolean(first && today >= first && today <= due);
}

export function tonerCareCycleKey(plan: TonerCarePlan): string {
  return plan.care_cycle_id || [plan.title, plan.installed_at, plan.expected_replacement_at].join("|");
}

// Retain already sent reminders when upgrading an existing single-reminder plan.
export function tonerCareReminders(plan: TonerCarePlan): TonerCareReminder[] {
  const reminders = (plan.care_reminders || []).map((item) => ({ ...item }));
  const at = String(plan.last_reminder_at || "");
  const date = new Date(at);
  if (!at || Number.isNaN(date.getTime())) return reminders;
  const key = [plan.title, plan.installed_at, plan.expected_replacement_at].join("|");
  const sentDay = bratislavaDay(date);
  const scheduled = tonerCareReminderDates(plan.expected_replacement_at || "").filter((item) => item <= sentDay).at(-1);
  if (!scheduled) return reminders;
  const legacyCustomer = plan.customer_reminder_sent_for === key;
  const legacyAdmin = plan.admin_reminder_sent_for === key;
  if (!legacyCustomer && !legacyAdmin) return reminders;
  const item = reminders.find((entry) => entry.scheduled_for === scheduled) || { scheduled_for: scheduled };
  if (legacyCustomer && !item.customer_sent_at) item.customer_sent_at = at;
  if (legacyAdmin && !item.admin_sent_at) item.admin_sent_at = at;
  if (!reminders.includes(item)) reminders.push(item);
  return reminders;
}

export function dueTonerCareReminder(plan: TonerCarePlan, recipient: "customer" | "admin", now = new Date()): string | null {
  if (!plan.care_enabled || !plan.installed_at || !shouldSendTonerCareReminder(plan.expected_replacement_at || "", now)) return null;
  const today = bratislavaDay(now);
  const scheduled = tonerCareReminderDates(plan.expected_replacement_at || "").filter((date) => date <= today).at(-1);
  if (!scheduled) return null;
  const field = recipient === "customer" ? "customer_sent_at" : "admin_sent_at";
  const reminders = tonerCareReminders(plan);
  if (reminders.some((item) => item.scheduled_for === scheduled && item[field])) return null;
  const sent = reminders.map((item) => item[field]).filter((at): at is string => Boolean(at && !Number.isNaN(Date.parse(at)))).sort().at(-1);
  if (sent) {
    const sentDay = bratislavaDay(new Date(sent));
    if (scheduled <= sentDay || dayNumber(today) - dayNumber(sentDay) < 7) return null;
  }
  return scheduled;
}

export function endTonerCare<T extends TonerCarePlan>(plan: T, reason: TonerCareHistoryEntry["reason"], now = new Date()): T {
  if (!plan.care_enabled && plan.care_ended_at) return plan;
  const reminders = tonerCareReminders(plan);
  const endedAt = now.toISOString();
  const cycleId = tonerCareCycleKey(plan);
  const history = [...(plan.care_history || [])];
  if (plan.installed_at && plan.expected_replacement_at && !history.some((item) => item.cycle_id === cycleId)) {
    history.unshift({ cycle_id: cycleId, installed_at: plan.installed_at, expected_replacement_at: plan.expected_replacement_at, ended_at: endedAt, reason, reminders });
  }
  return { ...plan, care_enabled: false, care_ended_at: endedAt, care_end_reason: reason, care_reminders: reminders, care_history: history };
}

export function expireTonerCare<T extends TonerCarePlan>(plan: T, now = new Date()): T {
  const due = validPlanDate(plan.expected_replacement_at);
  return plan.care_enabled && due && due < bratislavaDay(now) ? endTonerCare(plan, "expired", now) : plan;
}

// Background scans must not restore a plan the customer changed or disabled.
export function mergeTonerCareUpdate<T extends TonerCarePlan>(original: T, updated: T, latest: T): T {
  const identity = (plan: T) => JSON.stringify([tonerCareCycleKey(plan), plan.installed_at, plan.expected_months, plan.expected_replacement_at, plan.care_enabled]);
  if (identity(original) !== identity(latest)) return latest;
  const reminders = new Map((updated.care_reminders || []).map((item) => [item.scheduled_for, { ...item }]));
  for (const item of latest.care_reminders || []) reminders.set(item.scheduled_for, { ...reminders.get(item.scheduled_for), ...item });
  const history = new Map((latest.care_history || []).map((item) => [item.cycle_id, item]));
  for (const item of updated.care_history || []) history.set(item.cycle_id, item);
  return {
    ...latest,
    care_enabled: updated.care_enabled,
    care_ended_at: updated.care_ended_at,
    care_end_reason: updated.care_end_reason,
    care_reminders: [...reminders.values()],
    care_history: [...history.values()],
    customer_reminder_sent_for: updated.customer_reminder_sent_for,
    admin_reminder_sent_for: updated.admin_reminder_sent_for,
    last_reminder_at: updated.last_reminder_at,
  };
}
