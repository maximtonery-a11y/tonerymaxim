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
}) {
  const transporter = getTransporter();
  return transporter.sendMail({
    from: getMailFrom(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo || env("MAIL_REPLY_TO") || env("MAIL_FROM") || env("SMTP_USER"),
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
