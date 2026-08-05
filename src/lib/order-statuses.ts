const STATUS_LABELS: Record<string, string> = {
  pending: "Čaká na platbu",
  "on-hold": "Čaká na úhradu",
  processing: "Spracováva sa",
  completed: "Dokončená",
  shipped: "Expedovaná",
  expedovana: "Expedovaná",
  "tm-await-pay": "Čaká na úhradu",
  "tm-paid": "Uhradená",
  "tm-processing": "Spracováva sa",
  "tm-shipped": "Expedovaná",
  "tm-returned": "Vrátená",
  cancelled: "Zrušená",
  refunded: "Refundovaná",
  failed: "Neúspešná",
  trash: "Kôš",
  "checkout-draft": "Koncept pokladne",
};

export function normalizeOrderStatus(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("sk")
    .replace(/^wc-/, "")
    .replace(/_/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function getOrderStatusLabel(value: unknown): string {
  const original = String(value || "").trim();
  if (!original) return "—";
  return STATUS_LABELS[normalizeOrderStatus(original)] || original;
}

export function isAwaitingBankPaymentStatus(value: unknown): boolean {
  return new Set(["pending", "on-hold", "tm-await-pay"]).has(normalizeOrderStatus(value));
}

export function isLoyaltyCreditStatus(value: unknown): boolean {
  return new Set(["shipped", "expedovana", "tm-shipped", "completed"]).has(normalizeOrderStatus(value));
}

