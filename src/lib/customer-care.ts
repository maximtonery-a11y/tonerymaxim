import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type CustomerCareKind = "reklamacia" | "odstupenie";

const STORE_DIR = join(process.cwd(), ".tm-cache", "customer-care");

function clean(value: unknown, max = 2000): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function sanitizeCustomerCarePayload(input: Record<string, unknown>) {
  return {
    orderNumber: clean(input.orderNumber, 80),
    email: clean(input.email, 180).toLowerCase(),
    name: clean(input.name, 180),
    phone: clean(input.phone, 80),
    product: clean(input.product, 500),
    reason: clean(input.reason, 300),
    message: clean(input.message, 3000),
    iban: clean(input.iban, 80),
    address: clean(input.address, 800),
    products: clean(input.products, 2000),
    receivedAt: clean(input.receivedAt, 80),
  };
}

export function validateCustomerCarePayload(kind: CustomerCareKind, payload: ReturnType<typeof sanitizeCustomerCarePayload>) {
  if (!payload.orderNumber) return "Vyplňte číslo objednávky.";
  if (!/^\S+@\S+\.\S+$/.test(payload.email)) return "Vyplňte platný e-mail.";
  if (!payload.name) return "Vyplňte meno a priezvisko.";

  if (kind === "reklamacia") {
    if (!payload.product) return "Vyplňte reklamovaný produkt.";
    if (!payload.reason) return "Vyberte dôvod reklamácie.";
    if (!payload.message) return "Popíšte problém s produktom.";
  }

  if (kind === "odstupenie") {
    if (!payload.iban) return "Vyplňte IBAN pre vrátenie peňazí.";
    if (!payload.address) return "Vyplňte adresu kupujúceho.";
    if (!payload.products) return "Vyplňte produkty, ktorých sa odstúpenie týka.";
  }

  return "";
}

export function createCaseNumber(kind: CustomerCareKind) {
  const prefix = kind === "reklamacia" ? "R" : "O";
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${stamp}-${random}`;
}

export async function saveCustomerCareCase(kind: CustomerCareKind, payload: ReturnType<typeof sanitizeCustomerCarePayload>, requestMeta: Record<string, string> = {}) {
  await mkdir(STORE_DIR, { recursive: true });
  const caseNumber = createCaseNumber(kind);
  const record = {
    kind,
    caseNumber,
    status: "received",
    createdAt: new Date().toISOString(),
    payload,
    requestMeta,
  };
  await writeFile(join(STORE_DIR, `${caseNumber}.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

export function customerCareAdminEmail() {
  return "info@tonerymaxim.sk";
}

export function buildCustomerCareText(kind: CustomerCareKind, caseNumber: string, payload: ReturnType<typeof sanitizeCustomerCarePayload>) {
  const title = kind === "reklamacia" ? "Reklamácia" : "Odstúpenie od zmluvy";
  const rows = [
    `${title}: ${caseNumber}`,
    `Objednávka: ${payload.orderNumber}`,
    `Meno: ${payload.name}`,
    `E-mail: ${payload.email}`,
    `Telefón: ${payload.phone || "-"}`,
    payload.product ? `Produkt: ${payload.product}` : "",
    payload.reason ? `Dôvod: ${payload.reason}` : "",
    payload.products ? `Produkty: ${payload.products}` : "",
    payload.iban ? `IBAN: ${payload.iban}` : "",
    payload.address ? `Adresa: ${payload.address}` : "",
    payload.receivedAt ? `Dátum prevzatia: ${payload.receivedAt}` : "",
    payload.message ? `Popis: ${payload.message}` : "",
  ].filter(Boolean);
  return rows.join("\n");
}

export function buildCustomerCareHtml(kind: CustomerCareKind, caseNumber: string, payload: ReturnType<typeof sanitizeCustomerCarePayload>) {
  const title = kind === "reklamacia" ? "Reklamácia bola prijatá" : "Odstúpenie od zmluvy bolo prijaté";
  const label = kind === "reklamacia" ? "Reklamácia" : "Odstúpenie";
  const row = (name: string, value: string) => value ? `<tr><td style="padding:8px 0;color:#64748b;border-bottom:1px solid #e6edf5">${escapeHtml(name)}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e6edf5"><strong>${escapeHtml(value)}</strong></td></tr>` : "";
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:680px;margin:0 auto;padding:24px">
    <div style="font-size:13px;color:#1d6cf2;font-weight:800;margin-bottom:8px">ToneryMAXIM.sk</div>
    <h1 style="font-size:26px;margin:0 0 12px">${escapeHtml(title)}</h1>
    <p>Dobrý deň, ${escapeHtml(payload.name)},</p>
    <p>vaše podanie sme prijali a budeme ho spracovávať čo najskôr.</p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0">
      ${row("Číslo prípadu", caseNumber)}
      ${row("Typ", label)}
      ${row("Objednávka", payload.orderNumber)}
      ${row("Produkt", payload.product)}
      ${row("Dôvod", payload.reason)}
      ${row("IBAN", payload.iban)}
    </table>
    <p style="color:#64748b">Ak potrebujete doplniť fotografie alebo dokumenty, odpovedzte na tento e-mail.</p>
    <p>ToneryMAXIM.sk<br><a href="mailto:info@tonerymaxim.sk">info@tonerymaxim.sk</a><br><a href="tel:+421917859206">+421917859206</a></p>
  </div>`;
}

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
