import os from 'node:os';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getMailFrom, getTransporter } from './mail';
import { verifyWordPressEmailPolicy, wooRequest } from './woo-client';
import { getGoPayAccessToken, getGoPayHost } from './gopay-client';
import { readSignedJson } from './secure-persistence';

const execFileAsync = promisify(execFile);

type Check = {
  id: string;
  label: string;
  ok: boolean;
  warning?: boolean;
  ms?: number;
  message: string;
  details?: Record<string, unknown>;
};

function runtimeEnv(name: string): string {
  const processValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const buildValue = import.meta.env[name];
  const value = typeof processValue === 'string' && processValue.trim() ? processValue : buildValue;
  return typeof value === 'string' ? value.trim() : '';
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: Error; ms: number }> {
  const started = performance.now();
  try {
    return { value: await fn(), ms: Math.round(performance.now() - started) };
  } catch (error: any) {
    return { error: error instanceof Error ? error : new Error(String(error)), ms: Math.round(performance.now() - started) };
  }
}

async function resolveGitCommit(): Promise<string> {
  const envCommit = runtimeEnv('SOURCE_COMMIT') || runtimeEnv('COOLIFY_GIT_COMMIT_SHA') || runtimeEnv('GIT_COMMIT_SHA') || runtimeEnv('VERCEL_GIT_COMMIT_SHA');
  if (envCommit) return envCommit;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), timeout: 1500 });
    return stdout.trim();
  } catch {
    return 'nezistený';
  }
}

function persistentRoot(): string {
  return runtimeEnv('TM_PERSISTENT_DATA_DIR') || join(process.cwd(), '.tm-data');
}

async function storageCheck(): Promise<Check> {
  const root = persistentRoot();
  const file = join(root, 'health-check', `probe-${process.pid}.tmp`);
  const result = await timed(async () => {
    await fs.mkdir(dirname(file), { recursive: true });
    const payload = `tm-health:${Date.now()}`;
    await fs.writeFile(file, payload, 'utf8');
    const read = await fs.readFile(file, 'utf8');
    await fs.unlink(file).catch(() => undefined);
    if (read !== payload) throw new Error('Kontrolný zápis sa nezhoduje s čítaním.');
  });
  return {
    id: 'storage', label: 'Persistentné úložisko', ok: !result.error, ms: result.ms,
    message: result.error?.message || `Zápis a čítanie fungujú: ${root}`,
    details: { root },
  };
}

async function smtpCheck(verify: boolean): Promise<Check> {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const missing = required.filter((name) => !runtimeEnv(name));
  if (missing.length) return { id: 'smtp', label: 'SMTP', ok: false, message: `Chýba: ${missing.join(', ')}` };
  let from = '';
  try { from = getMailFrom(); } catch (error: any) {
    return { id: 'smtp', label: 'SMTP a odosielateľ', ok: false, message: error?.message || String(error) };
  }
  if (!verify) return { id: 'smtp', label: 'SMTP a odosielateľ', ok: true, warning: true, message: `Odosielateľ: ${from}. Hlboký test nebol spustený.` };
  const result = await timed(async () => getTransporter().verify());
  return { id: 'smtp', label: 'SMTP a odosielateľ', ok: !result.error, ms: result.ms, message: result.error?.message || `SMTP funguje, odosielateľ: ${from}.` };
}

async function wooCheck(): Promise<Check> {
  const result = await timed(async () => wooRequest('/system_status'));
  return { id: 'woo', label: 'WooCommerce API', ok: !result.error, ms: result.ms, message: result.error?.message || 'WooCommerce API odpovedá.' };
}

async function wordpressEmailPolicyCheck(): Promise<Check> {
  const result = await timed(async () => verifyWordPressEmailPolicy());
  return {
    id: 'wordpress-email-policy',
    label: 'Ochrana pred WordPress e-mailmi',
    ok: !result.error && result.value?.ok === true,
    ms: result.ms,
    message: result.error?.message || `Aktívna politika ${result.value?.version || ''}: e-maily ToneryMAXIM neposiela WordPress.`,
  };
}

async function gopayCheck(): Promise<Check> {
  const required = ['GOPAY_CLIENT_ID', 'GOPAY_CLIENT_SECRET'];
  const missing = required.filter((name) => !runtimeEnv(name));
  if (missing.length) return { id: 'gopay', label: 'GoPay', ok: false, message: `Chýba: ${missing.join(', ')}` };
  const result = await timed(async () => getGoPayAccessToken('payment-create'));
  return { id: 'gopay', label: 'GoPay', ok: !result.error, ms: result.ms, message: result.error?.message || `OAuth funguje (${getGoPayHost()}).` };
}

async function queueCheck(): Promise<Check> {
  const root = persistentRoot();
  const candidates = [
    join(root, 'email-queue', 'state.json'),
    join(root, 'email-queue-state.json'),
    join(process.cwd(), '.tm-cache', 'email-queue-state.json'),
  ];
  let found = '';
  let size = 0;
  for (const file of candidates) {
    try {
      const stat = await fs.stat(file);
      found = file; size = stat.size; break;
    } catch {}
  }
  return {
    id: 'queue', label: 'E-mailová fronta', ok: true, warning: !found,
    message: found ? `Stavový súbor existuje (${size} B).` : 'Stavový súbor zatiaľ neexistuje alebo ešte nebola vytvorená fronta.',
    details: { file: found || null },
  };
}

async function sequenceCheck(): Promise<Check> {
  const file = join(persistentRoot(), 'order-sequence.json');
  try {
    await fs.stat(file);
    const data = await readSignedJson<{ value?: number; last?: number; sequence?: number }>(file);
    if (!data) {
      return {
        id: 'sequence',
        label: 'Číslovanie objednávok',
        ok: false,
        message: 'Súbor existuje, ale jeho podpis alebo obsah nie je platný.',
        details: { file },
      };
    }
    const value = Number(data?.last ?? data?.value ?? data?.sequence ?? 0);
    return {
      id: 'sequence',
      label: 'Číslovanie objednávok',
      ok: Number.isInteger(value) && value >= 300895,
      message: `Posledná hodnota: ${value || 'nezistená'}`,
      details: { file },
    };
  } catch (error: any) {
    return {
      id: 'sequence',
      label: 'Číslovanie objednávok',
      ok: false,
      warning: true,
      message: `Súbor zatiaľ nie je dostupný: ${error?.message || error}`,
      details: { file },
    };
  }
}

export async function runProductionHealth(options: { deep?: boolean } = {}) {
  const [commit, storage, smtp, woo, wordpressEmailPolicy, gopay, queue, sequence] = await Promise.all([
    resolveGitCommit(), storageCheck(), smtpCheck(Boolean(options.deep)), wooCheck(), wordpressEmailPolicyCheck(), gopayCheck(), queueCheck(), sequenceCheck(),
  ]);

  const envNames = [
    'PUBLIC_SITE_URL','AUTH_SECRET','ADMIN_API_SECRET','TM_PERSISTENT_DATA_DIR',
    'SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_FROM','MAIL_NAME','MAIL_REPLY_TO','ADMIN_EMAIL',
    'WOO_URL','WOO_CONSUMER_KEY','WOO_CONSUMER_SECRET',
    'GOPAY_ENV','GOPAY_GOID','GOPAY_CLIENT_ID','GOPAY_CLIENT_SECRET','GOPAY_RETURN_URL','GOPAY_NOTIFY_URL',
  ];
  const env = Object.fromEntries(envNames.map((name) => [name, Boolean(runtimeEnv(name))]));
  const checks = [storage, smtp, woo, wordpressEmailPolicy, gopay, queue, sequence];
  const failures = checks.filter((check) => !check.ok && !check.warning).length;
  const warnings = checks.filter((check) => check.warning).length;
  const memory = process.memoryUsage();

  return {
    ok: failures === 0,
    generatedAt: new Date().toISOString(),
    summary: { failures, warnings, checks: checks.length },
    app: {
      name: 'ToneryMAXIM',
      version: runtimeEnv('npm_package_version') || '0.0.1',
      gitCommit: commit,
      node: process.version,
      environment: runtimeEnv('NODE_ENV') || 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      cwd: process.cwd(),
      hostname: os.hostname(),
    },
    resources: {
      rssMB: Math.round(memory.rss / 1024 / 1024),
      heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
      systemFreeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      systemTotalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
    },
    env,
    checks,
  };
}
