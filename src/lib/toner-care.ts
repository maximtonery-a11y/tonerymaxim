import { sendMail } from "./mail";
import {
  getSavedPrintersFromCustomer,
  getWooCustomersPage,
  saveWooCustomerPrinters,
  type SavedPrinter,
  type WooCustomer,
} from "./woo-client";
import { shouldSendTonerCareReminder } from "./toner-care-rules";
export { daysUntil, shouldSendTonerCareReminder } from "./toner-care-rules";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_START_DELAY_MS = 3 * 60 * 1000;
const MAX_CUSTOMER_PAGES = 500;

let running = false;
let timer: NodeJS.Timeout | null = null;
const WORKER_GLOBAL_KEY = Symbol.for("tm.toner-care-worker.started");

function env(name: string): string {
  return String(process.env[name] || import.meta.env[name] || "").trim();
}

function siteUrl(): string {
  return (env("PUBLIC_SITE_URL") || "https://www.tonerymaxim.sk").replace(/\/$/, "");
}

function adminEmail(): string {
  return env("ADMIN_EMAIL") || env("MAIL_FROM") || env("SMTP_USER");
}

function safeDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string): string {
  const date = safeDate(value);
  return date
    ? new Intl.DateTimeFormat("sk-SK", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Bratislava" }).format(date)
    : "—";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char] || char);
}

function preferenceLabel(value: SavedPrinter["preferred_type"]): string {
  const labels: Record<string, string> = {
    compatible: "kompatibilný toner",
    original: "originálny toner",
    renovated: "renovovaný toner",
    any: "najvhodnejšia dostupná možnosť",
  };
  return labels[String(value || "any")] || labels.any;
}

function reminderKey(printer: SavedPrinter): string {
  return [printer.title, printer.installed_at, printer.expected_replacement_at].join("|");
}

function customerName(customer: WooCustomer): string {
  return String(customer.first_name || customer.billing?.first_name || "zákazník").trim() || "zákazník";
}

async function sendCustomerReminder(customer: WooCustomer, printer: SavedPrinter): Promise<void> {
  const accountUrl = `${siteUrl()}/ucet/tlaciarne`;
  const productsUrl = new URL(printer.url || "/produkty", siteUrl()).toString();
  const name = customerName(customer);
  const due = formatDate(String(printer.expected_replacement_at || ""));
  const preference = preferenceLabel(printer.preferred_type);

  const text = `Dobrý deň, ${name},\n\npodľa plánu v časti Moje tlačiarne môže byť náplň v tlačiarni ${printer.title} potrebné vymeniť približne ${due}.\n\nPreferencia: ${preference}.\n\nVhodné náplne: ${productsUrl}\nUpraviť plán alebo označiť výmenu: ${accountUrl}\n\nIde o odhad podľa údajov, ktoré ste zadali. Toner vám bez potvrdenia objednávky automaticky neposielame.\n\nToneryMAXIM.sk`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:640px;margin:0 auto;padding:24px">
      <p style="margin:0 0 8px;color:#0588e8;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Toner bez starostí</p>
      <h1 style="font-size:25px;margin:0 0 16px">Náplň môže byť potrebné vymeniť približne o 3 týždne</h1>
      <p>Dobrý deň, ${escapeHtml(name)},</p>
      <p>podľa vášho nastavenia môže byť náplň v tlačiarni <strong>${escapeHtml(printer.title)}</strong> potrebné vymeniť približne <strong>${escapeHtml(due)}</strong>.</p>
      <p>Vaša preferencia: <strong>${escapeHtml(preference)}</strong>.</p>
      <p><a href="${escapeHtml(productsUrl)}" style="display:inline-block;background:#061735;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Zobraziť vhodné náplne</a></p>
      <p><a href="${escapeHtml(accountUrl)}" style="color:#066bc9;font-weight:700">Upraviť plán alebo označiť výmenu</a></p>
      <p style="padding:14px;border-radius:14px;background:#f3f8fd;color:#51627d;font-size:13px">Ide o odhad podľa údajov, ktoré ste zadali. Toner vám bez potvrdenia objednávky automaticky neposielame.</p>
      <p>ToneryMAXIM.sk</p>
    </div>`;

  await sendMail({
    to: customer.email,
    subject: `Pripomienka náplne pre ${printer.title} | ToneryMAXIM.sk`,
    text,
    html,
  });
}

async function sendAdminReminder(customer: WooCustomer, printer: SavedPrinter): Promise<void> {
  const to = adminEmail();
  if (!to) throw new Error("Pre upozornenia Strážcu tonera chýba ADMIN_EMAIL.");
  const productsUrl = new URL(printer.url || "/produkty", siteUrl()).toString();
  const fullName = [customer.first_name || customer.billing?.first_name, customer.last_name || customer.billing?.last_name].filter(Boolean).join(" ") || "Neuvedené";
  const phone = String(customer.billing?.phone || "").trim() || "Neuvedený";
  const due = formatDate(String(printer.expected_replacement_at || ""));

  const text = `Pripraviť ponuku toneru\n\nZákazník: ${fullName}\nE-mail: ${customer.email}\nTelefón: ${phone}\nTlačiareň: ${printer.title}\nOdhad výmeny: ${due}\nPreferencia: ${preferenceLabel(printer.preferred_type)}\n\nVhodné produkty: ${productsUrl}\n\nZákazník dostal informačnú pripomienku. Konkrétnu ponuku s aktuálnou cenou mu pošlite až po kontrole vhodného produktu a dostupnosti.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:680px;margin:0 auto;padding:24px">
      <p style="margin:0 0 8px;color:#f59e0b;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Obchodné upozornenie</p>
      <h1 style="font-size:25px;margin:0 0 18px">Pripraviť ponuku toneru</h1>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;border-bottom:1px solid #e5edf7;color:#64748b">Zákazník</td><td style="padding:8px;border-bottom:1px solid #e5edf7"><strong>${escapeHtml(fullName)}</strong></td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5edf7;color:#64748b">E-mail</td><td style="padding:8px;border-bottom:1px solid #e5edf7">${escapeHtml(customer.email)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5edf7;color:#64748b">Telefón</td><td style="padding:8px;border-bottom:1px solid #e5edf7">${escapeHtml(phone)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5edf7;color:#64748b">Tlačiareň</td><td style="padding:8px;border-bottom:1px solid #e5edf7"><strong>${escapeHtml(printer.title)}</strong></td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5edf7;color:#64748b">Odhad výmeny</td><td style="padding:8px;border-bottom:1px solid #e5edf7">${escapeHtml(due)}</td></tr>
        <tr><td style="padding:8px;color:#64748b">Preferencia</td><td style="padding:8px">${escapeHtml(preferenceLabel(printer.preferred_type))}</td></tr>
      </table>
      <p><a href="${escapeHtml(productsUrl)}" style="display:inline-block;background:#061735;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Vybrať vhodný produkt a cenu</a></p>
      <p style="padding:14px;border-radius:14px;background:#fff7e6;color:#6f5200;font-size:13px">Zákazník dostal informačnú pripomienku. Konkrétnu ponuku s aktuálnou cenou odošlite až po kontrole produktu a skladu.</p>
    </div>`;

  await sendMail({ to, subject: `Ponuka o 3 týždne: ${printer.title} – ${fullName}`, text, html });
}

async function processCustomer(customer: WooCustomer): Promise<number> {
  const printers = getSavedPrintersFromCustomer(customer);
  let changed = false;
  let sent = 0;

  for (const printer of printers) {
    if (!printer.care_enabled || !printer.installed_at || !printer.expected_replacement_at) continue;
    if (!shouldSendTonerCareReminder(printer.expected_replacement_at)) continue;

    const key = reminderKey(printer);
    if (printer.customer_reminder_sent_for !== key && customer.email) {
      try {
        await sendCustomerReminder(customer, printer);
        printer.customer_reminder_sent_for = key;
        printer.last_reminder_at = new Date().toISOString();
        changed = true;
        sent += 1;
      } catch (error) {
        console.error("[TM toner-care customer]", customer.id, printer.title, (error as Error)?.message || error);
      }
    }

    if (printer.admin_reminder_sent_for !== key) {
      try {
        await sendAdminReminder(customer, printer);
        printer.admin_reminder_sent_for = key;
        printer.last_reminder_at = new Date().toISOString();
        changed = true;
        sent += 1;
      } catch (error) {
        console.error("[TM toner-care admin]", customer.id, printer.title, (error as Error)?.message || error);
      }
    }
  }

  if (changed) await saveWooCustomerPrinters(customer.id, printers);
  return sent;
}

export async function runTonerCareScan(): Promise<{ customers: number; notifications: number }> {
  if (running) return { customers: 0, notifications: 0 };
  running = true;
  let customers = 0;
  let notifications = 0;
  try {
    for (let page = 1; page <= MAX_CUSTOMER_PAGES; page += 1) {
      const batch = await getWooCustomersPage(page, 100);
      if (!batch.length) break;
      for (const customer of batch) {
        customers += 1;
        notifications += await processCustomer(customer);
      }
      if (batch.length < 100) break;
    }
    return { customers, notifications };
  } finally {
    running = false;
  }
}

export function ensureTonerCareWorkerStarted(): void {
  const globalState = globalThis as typeof globalThis & { [WORKER_GLOBAL_KEY]?: boolean };
  if (globalState[WORKER_GLOBAL_KEY] || String(env("TM_TONER_CARE_ENABLED") || "1") === "0") return;
  globalState[WORKER_GLOBAL_KEY] = true;
  const intervalMs = Math.max(60 * 60 * 1000, Number(env("TM_TONER_CARE_INTERVAL_MS") || DEFAULT_INTERVAL_MS));
  const startDelayMs = Math.max(30_000, Number(env("TM_TONER_CARE_START_DELAY_MS") || DEFAULT_START_DELAY_MS));

  setTimeout(() => {
    void runTonerCareScan().catch((error) => console.error("[TM toner-care scan]", (error as Error)?.message || error));
    timer = setInterval(() => {
      void runTonerCareScan().catch((error) => console.error("[TM toner-care scan]", (error as Error)?.message || error));
    }, intervalMs);
    timer.unref?.();
  }, startDelayMs).unref?.();
}
