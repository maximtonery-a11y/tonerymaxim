import { existsSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";

function env(name: string): string {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function boolEnv(name: string, fallback = false): boolean {
  const value = env(name).toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function smtpPort(): number {
  const raw = Number(env("SMTP_PORT") || 465);
  return Number.isFinite(raw) ? raw : 465;
}

export function getMailFrom(): string {
  const fromEmail = env("MAIL_FROM") || env("SMTP_USER");
  const fromName = env("MAIL_NAME") || "ToneryMAXIM.sk";
  if (!fromEmail) throw new Error("Chýba MAIL_FROM alebo SMTP_USER v .env");
  return `"${fromName.replace(/"/g, "'")}" <${fromEmail}>`;
}

export function getTransporter() {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const port = smtpPort();
  const secure = boolEnv("SMTP_SECURE", port === 465);

  if (!host) throw new Error("Chýba SMTP_HOST v .env");
  if (!user) throw new Error("Chýba SMTP_USER v .env");
  if (!pass) throw new Error("Chýba SMTP_PASS v .env");

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; path: string; contentType?: string }>;
}) {
  const transporter = getTransporter();
  return transporter.sendMail({
    from: getMailFrom(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo || env("MAIL_REPLY_TO") || env("MAIL_FROM") || env("SMTP_USER"),
    attachments: input.attachments,
  });
}

export async function sendWelcomeEmail(input: {
  email: string;
  firstName?: string;
  siteUrl: string;
}) {
  const name = input.firstName?.trim() || "zákazník";
  const loginUrl = `${input.siteUrl.replace(/\/$/, "")}/prihlasenie`;

  const text = `Dobrý deň, ${name},\n\nvaša registrácia v ToneryMAXIM.sk bola úspešná.\n\nPrihlásenie do účtu:\n${loginUrl}\n\nV účte nájdete históriu objednávok, uložené tlačiarne a rýchle opakované objednanie.\n\nToneryMAXIM.sk`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:640px;margin:0 auto;padding:24px">
      <h1 style="font-size:24px;margin:0 0 12px">Vitajte v ToneryMAXIM.sk</h1>
      <p>Dobrý deň, ${escapeHtml(name)},</p>
      <p>vaša registrácia bola úspešná.</p>
      <p><a href="${loginUrl}" style="display:inline-block;background:#061735;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Prihlásiť sa do účtu</a></p>
      <p style="color:#60708c">V účte nájdete históriu objednávok, uložené tlačiarne a rýchle opakované objednanie.</p>
      <p>ToneryMAXIM.sk</p>
    </div>`;

  return sendMail({
    to: input.email,
    subject: "Vitajte v ToneryMAXIM.sk",
    text,
    html,
  });
}

export async function sendPasswordResetEmail(input: {
  email: string;
  resetUrl: string;
}) {
  const text = `Dobrý deň,\n\npre nastavenie nového hesla kliknite na tento odkaz:\n${input.resetUrl}\n\nAk ste obnovu hesla nežiadali, tento e-mail ignorujte.\n\nToneryMAXIM.sk`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:640px;margin:0 auto;padding:24px">
      <h1 style="font-size:24px;margin:0 0 12px">Obnova hesla</h1>
      <p>Dobrý deň,</p>
      <p>pre nastavenie nového hesla kliknite na tlačidlo nižšie.</p>
      <p><a href="${input.resetUrl}" style="display:inline-block;background:#061735;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Nastaviť nové heslo</a></p>
      <p style="color:#60708c">Ak ste obnovu hesla nežiadali, tento e-mail ignorujte.</p>
      <p>ToneryMAXIM.sk</p>
    </div>`;

  return sendMail({
    to: input.email,
    subject: "Obnova hesla | ToneryMAXIM.sk",
    text,
    html,
  });
}

export async function sendPasswordChangedEmail(input: {
  email: string;
  loginUrl: string;
}) {
  const text = `Dobrý deň,\n\nvaše heslo v ToneryMAXIM.sk bolo úspešne zmenené.\n\nPrihlásenie do účtu:\n${input.loginUrl}\n\nAk ste túto zmenu neurobili vy, kontaktujte nás čo najskôr.\n\nToneryMAXIM.sk`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:640px;margin:0 auto;padding:24px">
      <h1 style="font-size:24px;margin:0 0 12px">Heslo bolo zmenené</h1>
      <p>Dobrý deň,</p>
      <p>vaše heslo v ToneryMAXIM.sk bolo úspešne zmenené.</p>
      <p><a href="${input.loginUrl}" style="display:inline-block;background:#061735;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Prihlásiť sa</a></p>
      <p style="color:#60708c">Ak ste túto zmenu neurobili vy, kontaktujte nás čo najskôr.</p>
      <p>ToneryMAXIM.sk</p>
    </div>`;

  return sendMail({
    to: input.email,
    subject: "Heslo bolo zmenené | ToneryMAXIM.sk",
    text,
    html,
  });
}


const VAT_RATE = 0.23;

function toNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(String(value ?? "0").replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function netFromGross(value: unknown): number {
  return Math.round((toNumber(value) / (1 + VAT_RATE)) * 100) / 100;
}

function vatFromGross(value: unknown): number {
  const gross = toNumber(value);
  return Math.round((gross - netFromGross(gross)) * 100) / 100;
}

function formatMoney(value: unknown): string {
  return new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(toNumber(value));
}

function siteUrl(): string {
  return (env("PUBLIC_SITE_URL") || env("SITE_URL") || "https://tonerymaxim.info").replace(/\/$/, "");
}

function legalAttachments() {
  const files = [
    ["obchodne-podmienky.pdf", "obchodne-podmienky.pdf"],
    ["reklamacny-formular.pdf", "reklamacny-formular.pdf"],
    ["odstupenie-od-zmluvy.pdf", "odstupenie-od-zmluvy.pdf"],
  ] as const;
  return files
    .map(([filename, publicFile]) => ({ filename, path: join(process.cwd(), "public", publicFile), contentType: "application/pdf" }))
    .filter((attachment) => existsSync(attachment.path));
}

function addressBlock(data: any, contact: any) {
  const lines = [
    [data?.firstName, data?.lastName].filter(Boolean).join(" ") || contact?.name || "",
    data?.company || "",
    data?.address || data?.street || "",
    [data?.zip || data?.postcode, data?.city].filter(Boolean).join(" "),
    data?.email || contact?.email || "",
    data?.phone || contact?.phone || "",
  ].filter(Boolean);
  return lines.join("\n");
}

function addressBlockHtml(data: any, contact: any) {
  return addressBlock(data, contact).split("\n").map((line) => escapeHtml(line)).join("<br>");
}

export async function sendOrderConfirmationEmail(input: {
  to: string;
  orderNumber: string;
  source: any;
  paymentTitle: string;
  shippingTitle: string;
}) {
  const source = input.source || {};
  const contact = source.contact || {};
  const billing = source.billing || {};
  const delivery = source.delivery || {};
  const firstName = String(billing.firstName || contact.name || "").trim().split(/\s+/)[0] || "zákazník";
  const items = Array.isArray(source.cart) ? source.cart : [];

  const subtotalGross = toNumber(source.subtotal);
  const shippingGross = toNumber(source.shippingPrice);
  const paymentGross = toNumber(source.paymentPrice);
  const loyaltyGross = toNumber(source.loyaltyDiscount);
  const totalGross = toNumber(source.total);
  const totalNet = netFromGross(totalGross);
  const totalVat = vatFromGross(totalGross);

  const rowsText = items.map((item: any) => {
    const gross = toNumber(Number(item.price || 0) * Number(item.qty || 1));
    return `- ${item.name} ×${item.qty}: ${formatMoney(gross)} s DPH / ${formatMoney(netFromGross(gross))} bez DPH`;
  }).join("\n");
  const rowsHtml = items.map((item: any) => {
    const gross = toNumber(Number(item.price || 0) * Number(item.qty || 1));
    return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e6edf5"><strong>${escapeHtml(String(item.name || "Produkt"))}</strong><br><span style="color:#64748b">SKU: ${escapeHtml(String(item.sku || ""))}</span></td>
      <td style="padding:10px 0;border-bottom:1px solid #e6edf5;text-align:center">×${escapeHtml(String(item.qty || 1))}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e6edf5;text-align:right"><strong>${formatMoney(gross)}</strong><br><span style="color:#64748b;font-size:12px">${formatMoney(netFromGross(gross))} bez DPH</span></td>
    </tr>`;
  }).join("");

  const text = `Dobrý deň, ${firstName},\n\nďakujeme za objednávku č. ${input.orderNumber}.\n\nObjednávku sme prijali a spracujeme ju čo najskôr.\n\nProdukty:\n${rowsText}\n\nDoprava: ${input.shippingTitle}\nSpôsob platby: ${input.paymentTitle}\nCena spolu s DPH: ${formatMoney(totalGross)}
Základ bez DPH: ${formatMoney(totalNet)}
DPH 23 %: ${formatMoney(totalVat)}\n\nFakturačná adresa:\n${addressBlock(billing, contact)}\n\nDodacia adresa:\n${addressBlock(delivery?.differentAddress ? delivery : billing, contact)}\n\nPrávne informácie:\n${siteUrl()}/obchodne-podmienky\n${siteUrl()}/reklamacie\n${siteUrl()}/reklamacia-online\n${siteUrl()}/odstupenie-od-zmluvy\n${siteUrl()}/ochrana-osobnych-udajov\n\nToneryMAXIM.sk\ninfo@tonerymaxim.sk\n+421917859206`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:680px;margin:0 auto;padding:24px">
      <div style="font-size:13px;color:#1d6cf2;font-weight:800;margin-bottom:8px">ToneryMAXIM.sk</div>
      <h1 style="font-size:28px;margin:0 0 14px">Ďakujeme za objednávku</h1>
      <p>Dobrý deň, ${escapeHtml(firstName)},</p>
      <p>ďakujeme za objednávku <strong>č. ${escapeHtml(input.orderNumber)}</strong>. Objednávku sme prijali a spracujeme ju čo najskôr.</p>
      <table style="width:100%;border-collapse:collapse;margin:22px 0">
        <thead>
          <tr>
            <th style="text-align:left;border-bottom:2px solid #dbe7f4;padding-bottom:8px">Produkt</th>
            <th style="text-align:center;border-bottom:2px solid #dbe7f4;padding-bottom:8px">Počet</th>
            <th style="text-align:right;border-bottom:2px solid #dbe7f4;padding-bottom:8px">Cena</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <table style="width:100%;border-collapse:collapse;margin:18px 0">
        <tr><td style="padding:6px 0;color:#64748b">Medzisúčet tovaru s DPH:</td><td style="padding:6px 0;text-align:right">${formatMoney(subtotalGross)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Doprava:</td><td style="padding:6px 0;text-align:right">${escapeHtml(input.shippingTitle)} · ${formatMoney(shippingGross)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Spôsob platby:</td><td style="padding:6px 0;text-align:right">${escapeHtml(input.paymentTitle)} · ${formatMoney(paymentGross)}</td></tr>
        ${loyaltyGross > 0 ? `<tr><td style="padding:6px 0;color:#0f9f4a">Vernostná zľava:</td><td style="padding:6px 0;text-align:right;color:#0f9f4a">-${formatMoney(loyaltyGross)}</td></tr>` : ""}
        <tr><td style="padding:6px 0;color:#64748b">Základ bez DPH:</td><td style="padding:6px 0;text-align:right">${formatMoney(totalNet)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">DPH 23 %:</td><td style="padding:6px 0;text-align:right">${formatMoney(totalVat)}</td></tr>
        <tr><td style="padding:10px 0;font-weight:800">Cena spolu s DPH:</td><td style="padding:10px 0;text-align:right;font-weight:800;font-size:18px">${formatMoney(totalGross)}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin:18px 0">
        <tr>
          <td style="width:50%;vertical-align:top;padding:14px;border:1px solid #e6edf5;border-radius:12px"><strong>Fakturačná adresa</strong><br>${addressBlockHtml(billing, contact) || "-"}</td>
          <td style="width:50%;vertical-align:top;padding:14px;border:1px solid #e6edf5;border-radius:12px"><strong>Dodacia adresa</strong><br>${addressBlockHtml(delivery?.differentAddress ? delivery : billing, contact) || "-"}</td>
        </tr>
      </table>
      <div style="background:#f5faff;border:1px solid #dbe8f6;border-radius:16px;padding:16px;margin:18px 0">
        <strong>Právne dokumenty a zákaznícka pomoc</strong>
        <p style="margin:8px 0 0;color:#64748b">V prílohe e-mailu nájdete obchodné podmienky, reklamačný formulár a formulár na odstúpenie od zmluvy.</p>
        <p style="margin:10px 0 0"><a href="${siteUrl()}/obchodne-podmienky">Obchodné podmienky</a> · <a href="${siteUrl()}/reklamacie">Reklamačné podmienky</a> · <a href="${siteUrl()}/reklamacia-online">Reklamácia online</a> · <a href="${siteUrl()}/odstupenie-od-zmluvy">Odstúpenie online</a> · <a href="${siteUrl()}/ochrana-osobnych-udajov">Ochrana osobných údajov</a></p>
      </div>
      <p style="color:#64748b">O odoslaní zásielky vás budeme informovať e-mailom.</p>
      <p>ToneryMAXIM.sk<br><a href="mailto:info@tonerymaxim.sk">info@tonerymaxim.sk</a><br><a href="tel:+421917859206">+421917859206</a></p>
    </div>`;

  return sendMail({
    to: input.to,
    subject: `Objednávka č. ${input.orderNumber} bola prijatá | ToneryMAXIM.sk`,
    text,
    html,
    attachments: legalAttachments(),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type WooOrderStatusEmailPayload = {
  event_id: string;
  order_id: number;
  order_number: string;
  from_status: string;
  to_status: string;
  changed_at?: string;
  customer?: {
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  payment_method_title?: string;
  shipping_method?: string;
  total?: string | number;
  currency?: string;
  tracking_number?: string;
  tracking_url?: string;
  line_items?: Array<{
    name?: string;
    sku?: string;
    quantity?: number;
    total?: string | number;
  }>;
};

type StatusPresentation = {
  title: string;
  subject: string;
  message: string;
  color: string;
  showTracking?: boolean;
};

function statusPresentation(statusRaw: string, orderNumber: string): StatusPresentation {
  const status = String(statusRaw || "").toLowerCase().replace(/^wc-/, "");
  const number = escapeHtml(orderNumber);

  const map: Record<string, StatusPresentation> = {
    pending: {
      title: "Objednávka čaká na platbu",
      subject: `Objednávka č. ${orderNumber} čaká na platbu | ToneryMAXIM.sk`,
      message: `Objednávku č. ${number} evidujeme. Jej spracovanie začne po prijatí platby.`,
      color: "#d97706",
    },
    "on-hold": {
      title: "Objednávku sme zaevidovali",
      subject: `Objednávka č. ${orderNumber} čaká na spracovanie | ToneryMAXIM.sk`,
      message: `Objednávka č. ${number} je zaevidovaná a čaká na ďalšie spracovanie alebo prijatie platby.`,
      color: "#d97706",
    },
    processing: {
      title: "Objednávku spracovávame",
      subject: `Objednávku č. ${orderNumber} spracovávame | ToneryMAXIM.sk`,
      message: `Objednávku č. ${number} práve pripravujeme na odoslanie.`,
      color: "#2563eb",
    },
    completed: {
      title: "Objednávka bola vybavená",
      subject: `Objednávka č. ${orderNumber} bola vybavená | ToneryMAXIM.sk`,
      message: `Objednávka č. ${number} bola vybavená. Ďakujeme za váš nákup.`,
      color: "#059669",
      showTracking: true,
    },
    shipped: {
      title: "Objednávku sme odoslali",
      subject: `Objednávka č. ${orderNumber} bola odoslaná | ToneryMAXIM.sk`,
      message: `Objednávka č. ${number} bola odovzdaná dopravcovi.`,
      color: "#059669",
      showTracking: true,
    },
    expedovana: {
      title: "Objednávku sme odoslali",
      subject: `Objednávka č. ${orderNumber} bola odoslaná | ToneryMAXIM.sk`,
      message: `Objednávka č. ${number} bola odovzdaná dopravcovi.`,
      color: "#059669",
      showTracking: true,
    },
    cancelled: {
      title: "Objednávka bola zrušená",
      subject: `Objednávka č. ${orderNumber} bola zrušená | ToneryMAXIM.sk`,
      message: `Objednávka č. ${number} bola zrušená. Ak ste zrušenie nežiadali, kontaktujte nás.`,
      color: "#dc2626",
    },
    refunded: {
      title: "Platba bola vrátená",
      subject: `Refundácia objednávky č. ${orderNumber} | ToneryMAXIM.sk`,
      message: `Pri objednávke č. ${number} sme zaevidovali vrátenie platby. Pripísanie na účet môže závisieť od banky.`,
      color: "#7c3aed",
    },
    failed: {
      title: "Platbu sa nepodarilo dokončiť",
      subject: `Platba objednávky č. ${orderNumber} neprešla | ToneryMAXIM.sk`,
      message: `Objednávku č. ${number} evidujeme, ale platbu sa nepodarilo dokončiť. Kontaktujte nás alebo zvoľte nový spôsob platby.`,
      color: "#dc2626",
    },
  };

  return map[status] || {
    title: "Stav objednávky sa zmenil",
    subject: `Nový stav objednávky č. ${orderNumber} | ToneryMAXIM.sk`,
    message: `Stav objednávky č. ${number} bol aktualizovaný.`,
    color: "#2563eb",
  };
}

export async function sendWooOrderStatusEmail(payload: WooOrderStatusEmailPayload) {
  const email = String(payload.customer?.email || "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Objednávka nemá platný zákaznícky e-mail.");
  }

  const orderNumber = String(payload.order_number || payload.order_id || "").trim();
  const firstName = String(payload.customer?.first_name || "").trim() || "zákazník";
  const presentation = statusPresentation(payload.to_status, orderNumber);
  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  const total = formatMoney(payload.total || 0);
  const trackingUrl = String(payload.tracking_url || "").trim();
  const trackingNumber = String(payload.tracking_number || "").trim();

  const rowsHtml = items.map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e6edf5">
        <strong>${escapeHtml(String(item.name || "Produkt"))}</strong>
        ${item.sku ? `<br><span style="font-size:12px;color:#64748b">SKU: ${escapeHtml(String(item.sku))}</span>` : ""}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e6edf5;text-align:center">×${escapeHtml(String(item.quantity || 1))}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e6edf5;text-align:right">${formatMoney(item.total || 0)}</td>
    </tr>`).join("");

  const trackingHtml = presentation.showTracking && (trackingUrl || trackingNumber)
    ? `<div style="margin:22px 0;padding:18px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:16px">
        <strong>Sledovanie zásielky</strong>
        ${trackingNumber ? `<div style="margin-top:6px;color:#475569">Číslo zásielky: ${escapeHtml(trackingNumber)}</div>` : ""}
        ${trackingUrl ? `<p style="margin:14px 0 0"><a href="${escapeHtml(trackingUrl)}" style="display:inline-block;background:#061735;color:#fff;text-decoration:none;padding:11px 17px;border-radius:999px;font-weight:700">Sledovať zásielku</a></p>` : ""}
      </div>`
    : "";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#061735;max-width:680px;margin:0 auto;padding:24px">
      <div style="font-size:13px;color:#1d6cf2;font-weight:800;margin-bottom:8px">ToneryMAXIM.sk</div>
      <div style="border-left:5px solid ${presentation.color};padding:4px 0 4px 16px;margin-bottom:20px">
        <h1 style="font-size:27px;margin:0 0 7px">${escapeHtml(presentation.title)}</h1>
        <div style="color:#64748b">Objednávka č. ${escapeHtml(orderNumber)}</div>
      </div>
      <p>Dobrý deň, ${escapeHtml(firstName)},</p>
      <p>${presentation.message}</p>
      ${trackingHtml}
      ${items.length ? `<table style="width:100%;border-collapse:collapse;margin:22px 0">
        <thead><tr>
          <th style="text-align:left;border-bottom:2px solid #dbe7f4;padding-bottom:8px">Produkt</th>
          <th style="text-align:center;border-bottom:2px solid #dbe7f4;padding-bottom:8px">Počet</th>
          <th style="text-align:right;border-bottom:2px solid #dbe7f4;padding-bottom:8px">Cena</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>` : ""}
      <table style="width:100%;border-collapse:collapse;margin:18px 0">
        ${payload.shipping_method ? `<tr><td style="padding:6px 0;color:#64748b">Doprava:</td><td style="padding:6px 0;text-align:right">${escapeHtml(payload.shipping_method)}</td></tr>` : ""}
        ${payload.payment_method_title ? `<tr><td style="padding:6px 0;color:#64748b">Platba:</td><td style="padding:6px 0;text-align:right">${escapeHtml(payload.payment_method_title)}</td></tr>` : ""}
        <tr><td style="padding:10px 0;font-weight:800">Cena spolu:</td><td style="padding:10px 0;text-align:right;font-weight:800;font-size:18px">${total}</td></tr>
      </table>
      <div style="margin-top:26px;padding-top:20px;border-top:1px solid #dbe7f4;color:#64748b;font-size:14px">
        Potrebujete pomoc? Napíšte na <a href="mailto:info@tonerymaxim.sk">info@tonerymaxim.sk</a> alebo zavolajte na <a href="tel:+421917859206">+421 917 859 206</a>.
      </div>
    </div>`;

  const textItems = items.map((item) => `- ${item.name || "Produkt"} ×${item.quantity || 1}: ${formatMoney(item.total || 0)}`).join("\n");
  const text = [
    `Dobrý deň, ${firstName},`,
    "",
    presentation.title,
    presentation.message.replace(/<[^>]+>/g, ""),
    "",
    textItems,
    payload.shipping_method ? `Doprava: ${payload.shipping_method}` : "",
    payload.payment_method_title ? `Platba: ${payload.payment_method_title}` : "",
    `Cena spolu: ${total}`,
    trackingNumber ? `Číslo zásielky: ${trackingNumber}` : "",
    trackingUrl ? `Sledovanie: ${trackingUrl}` : "",
    "",
    "ToneryMAXIM.sk",
    "info@tonerymaxim.sk",
    "+421 917 859 206",
  ].filter(Boolean).join("\n");

  return sendMail({
    to: email,
    subject: presentation.subject,
    text,
    html,
  });
}

