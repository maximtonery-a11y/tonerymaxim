import type { WooCustomer, WooOrder } from "./woo-client";
import type { CustomerSession } from "./auth-session";

export function customerToSession(customer: WooCustomer): CustomerSession {
  return {
    id: customer.id,
    email: customer.email,
    first_name: customer.first_name || customer.billing?.first_name || "",
    last_name: customer.last_name || customer.billing?.last_name || "",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14,
  };
}

export function formatMoney(value: unknown, currency = "EUR"): string {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: currency || "EUR",
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function orderStatusLabel(status?: string): string {
  const map: Record<string, string> = {
    pending: "Čaká na platbu",
    processing: "Spracováva sa",
    "on-hold": "Čaká na úhradu",
    completed: "Dokončená",
    cancelled: "Zrušená",
    refunded: "Vrátená",
    failed: "Neúspešná",
    trash: "Kôš",
  };
  return map[String(status || "")] || status || "—";
}

export function orderNumber(order: WooOrder): string {
  return order.number ? `#${order.number}` : `#${order.id}`;
}

export function getBilling(customer: WooCustomer): Record<string, any> {
  return customer.billing || {};
}

export function getShipping(customer: WooCustomer): Record<string, any> {
  return customer.shipping || {};
}

export function safeText(value: unknown, fallback = "—"): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}


export type SavedPrinter = {
  id: string;
  title: string;
  brand?: string;
  product_count?: number;
  url?: string;
  added_at?: string;
};

export function getCustomerMeta(customer: WooCustomer, key: string): any {
  const meta = Array.isArray((customer as any).meta_data) ? (customer as any).meta_data : [];
  const item = [...meta].reverse().find((entry: any) => entry?.key === key);
  return item?.value;
}

export function getSavedPrinters(customer: WooCustomer): SavedPrinter[] {
  const raw = getCustomerMeta(customer, "tm_saved_printers");
  let parsed: any = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => ({
      id: String(item?.id || item?.title || "").trim(),
      title: String(item?.title || "").trim(),
      brand: String(item?.brand || "").trim(),
      product_count: Number(item?.product_count || 0),
      url: String(item?.url || "").trim(),
      added_at: String(item?.added_at || "").trim(),
    }))
    .filter((item) => item.id && item.title);
}
