import { lookup } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { access, mkdir, writeFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { TM_DATA_ROOT } from './secure-persistence';

function runtime(name: string): string {
  const value = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function built(name: string): string {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function first(names: string[]): { value: string; name: string; source: 'runtime' | 'build' | 'missing' } {
  for (const name of names) {
    const value = runtime(name);
    if (value) return { value, name, source: 'runtime' };
  }
  for (const name of names) {
    const value = built(name);
    if (value) return { value, name, source: 'build' };
  }
  return { value: '', name: names[0], source: 'missing' };
}

function bool(value: string, fallback = false): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function mask(value: string): string {
  if (!value) return '';
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (value.length <= 6) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function config() {
  const host = first(['SMTP_HOST', 'MAIL_HOST', 'EMAIL_HOST']);
  const portRaw = first(['SMTP_PORT', 'MAIL_PORT', 'EMAIL_PORT']);
  const user = first(['SMTP_USER', 'MAIL_USER', 'EMAIL_USER']);
  const pass = first(['SMTP_PASS', 'SMTP_PASSWORD', 'MAIL_PASS', 'MAIL_PASSWORD', 'EMAIL_PASS']);
  const secureRaw = first(['SMTP_SECURE', 'MAIL_SECURE']);
  const from = first(['MAIL_FROM', 'SMTP_FROM', 'EMAIL_FROM']);
  const name = first(['MAIL_NAME', 'SMTP_FROM_NAME', 'EMAIL_FROM_NAME']);
  const replyTo = first(['MAIL_REPLY_TO', 'SMTP_REPLY_TO']);
  const admin = first(['ADMIN_EMAIL', 'ORDER_ADMIN_EMAIL', 'CUSTOMER_CARE_EMAIL']);
  const port = Number(portRaw.value || 465);
  const secure = bool(secureRaw.value, port === 465);
  return { host, portRaw, user, pass, secureRaw, from, name, replyTo, admin, port, secure };
}

async function tcpProbe(host: string, port: number, secure: boolean): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  return await new Promise((resolve) => {
    const finish = (ok: boolean, error?: string) => resolve({ ok, ms: Date.now() - started, error });
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
      : net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); finish(false, 'Timeout po 10 sekundách'); }, 10_000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); finish(true); });
    socket.once('secureConnect', () => { clearTimeout(timer); socket.destroy(); finish(true); });
    socket.once('error', (error) => { clearTimeout(timer); finish(false, error.message); });
  });
}

async function persistenceProbe() {
  const testDir = join(TM_DATA_ROOT, 'diagnostics');
  const testFile = join(testDir, `write-${process.pid}-${Date.now()}.tmp`);
  try {
    await mkdir(testDir, { recursive: true });
    await access(TM_DATA_ROOT, constants.R_OK | constants.W_OK);
    await writeFile(testFile, 'ok', 'utf8');
    await unlink(testFile);
    return { ok: true, root: TM_DATA_ROOT };
  } catch (error: any) {
    return { ok: false, root: TM_DATA_ROOT, error: error?.message || String(error) };
  }
}

export async function runEmailDiagnostics(options: { verifySmtp?: boolean } = {}) {
  const c = config();
  const missing = [
    !c.host.value && 'SMTP_HOST',
    !c.user.value && 'SMTP_USER',
    !c.pass.value && 'SMTP_PASS',
    !(c.from.value || c.user.value) && 'MAIL_FROM alebo SMTP_USER',
  ].filter(Boolean) as string[];

  let dns: any = { ok: false, skipped: true };
  let tcp: any = { ok: false, skipped: true };
  let verify: any = { ok: false, skipped: true };

  if (c.host.value) {
    try {
      const result = await lookup(c.host.value);
      dns = { ok: true, address: result.address, family: result.family };
    } catch (error: any) {
      dns = { ok: false, error: error?.message || String(error) };
    }
    tcp = await tcpProbe(c.host.value, c.port, c.secure);
  }

  if (options.verifySmtp && !missing.length) {
    try {
      const transporter = nodemailer.createTransport({
        host: c.host.value,
        port: c.port,
        secure: c.secure,
        auth: { user: c.user.value, pass: c.pass.value },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });
      await transporter.verify();
      verify = { ok: true };
      transporter.close();
    } catch (error: any) {
      verify = {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || '',
        command: error?.command || '',
        responseCode: error?.responseCode || null,
        response: error?.response || '',
      };
    }
  }

  return {
    ok: missing.length === 0 && dns.ok && tcp.ok && (!options.verifySmtp || verify.ok),
    generatedAt: new Date().toISOString(),
    nodeEnv: runtime('NODE_ENV') || 'neuvedené',
    hostname: runtime('HOSTNAME') || 'neuvedené',
    missing,
    variables: {
      SMTP_HOST: { present: !!c.host.value, source: c.host.source, actualName: c.host.name, value: c.host.value || '' },
      SMTP_PORT: { present: true, source: c.portRaw.source, actualName: c.portRaw.name, value: String(c.port) },
      SMTP_SECURE: { present: !!c.secureRaw.value, source: c.secureRaw.source, actualName: c.secureRaw.name, value: String(c.secure) },
      SMTP_USER: { present: !!c.user.value, source: c.user.source, actualName: c.user.name, value: mask(c.user.value) },
      SMTP_PASS: { present: !!c.pass.value, source: c.pass.source, actualName: c.pass.name, value: c.pass.value ? `nastavené (${c.pass.value.length} znakov)` : '' },
      MAIL_FROM: { present: !!(c.from.value || c.user.value), source: c.from.value ? c.from.source : c.user.source, actualName: c.from.value ? c.from.name : c.user.name, value: mask(c.from.value || c.user.value) },
      MAIL_NAME: { present: !!c.name.value, source: c.name.source, actualName: c.name.name, value: c.name.value || 'ToneryMAXIM.sk (predvolené)' },
      MAIL_REPLY_TO: { present: !!c.replyTo.value, source: c.replyTo.source, actualName: c.replyTo.name, value: mask(c.replyTo.value) },
      ADMIN_EMAIL: { present: !!c.admin.value, source: c.admin.source, actualName: c.admin.name, value: mask(c.admin.value) },
    },
    dns,
    tcp,
    verify,
    persistence: await persistenceProbe(),
  };
}

export async function sendDiagnosticEmail(to: string) {
  const c = config();
  if (!to || !to.includes('@')) throw new Error('Neplatná cieľová e-mailová adresa.');
  const missing = [!c.host.value && 'SMTP_HOST', !c.user.value && 'SMTP_USER', !c.pass.value && 'SMTP_PASS'].filter(Boolean);
  if (missing.length) throw new Error(`Chýbajú premenné: ${missing.join(', ')}`);
  const transporter = nodemailer.createTransport({
    host: c.host.value,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user.value, pass: c.pass.value },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const result = await transporter.sendMail({
    from: `"${(c.name.value || 'ToneryMAXIM.sk').replace(/"/g, "'")}" <${c.from.value || c.user.value}>`,
    to,
    subject: `TM SMTP diagnostika ${new Date().toISOString()}`,
    text: 'Tento e-mail potvrdzuje, že produkčný Astro server sa úspešne pripojil k SMTP a odoslal správu.',
    html: '<h2>TM SMTP diagnostika je úspešná</h2><p>Produkčný Astro server sa úspešne pripojil k SMTP a odoslal túto správu.</p>',
  });
  transporter.close();
  return { messageId: result.messageId, accepted: result.accepted, rejected: result.rejected, response: result.response };
}
