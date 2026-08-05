export const BANK_TRANSFER_DETAILS = Object.freeze({
  bank: "VÚB",
  accountHolder: "Roman Babčan INkarus",
  iban: "SK6202000000003299323851",
  ibanFormatted: "SK62 0200 0000 0032 9932 3851",
});

export function bankTransferVariableSymbol(orderNumber: unknown): string {
  const digits = String(orderNumber || "").replace(/\D/g, "");
  return digits || "—";
}

export function isBankPrepaidPayment(code: unknown, title: unknown = ""): boolean {
  const normalizedCode = String(code || "").trim().toLowerCase().replace(/_/g, "-");
  const normalizedTitle = String(title || "").trim().toLocaleLowerCase("sk");
  if (normalizedCode) return normalizedCode === "bank-prepaid" || normalizedCode === "bacs";
  return normalizedTitle.includes("platba prevodom") || normalizedTitle.includes("bankový prevod");
}
