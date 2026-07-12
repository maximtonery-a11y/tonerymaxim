import { createHmac, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const TM_DATA_ROOT = resolve(process.env.TM_PERSISTENT_DATA_DIR || join(process.cwd(), '.tm-data'));

function secret(): string {
  const value = String(process.env.TM_PERSISTENCE_SECRET || process.env.AUTH_SECRET || import.meta.env.AUTH_SECRET || '').trim();
  return value || 'localhost-development-only-secret';
}

function signature(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700).catch(() => undefined);
}

export async function atomicWriteText(path: string, text: string): Promise<void> {
  await ensurePrivateDir(dirname(path));
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 });
  await chmod(temp, 0o600).catch(() => undefined);
  await rename(temp, path);
}

export async function writeSignedJson<T>(path: string, value: T): Promise<void> {
  const payload = JSON.stringify(value);
  await atomicWriteText(path, JSON.stringify({ version: 1, payload, signature: signature(payload) }));
}

export async function readSignedJson<T>(path: string): Promise<T | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { payload?: string; signature?: string };
    const payload = String(raw.payload || '');
    const supplied = Buffer.from(String(raw.signature || ''), 'hex');
    const expected = Buffer.from(signature(payload), 'hex');
    if (!payload || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

export async function quarantineFile(path: string, reason = 'invalid'): Promise<void> {
  const quarantineDir = join(TM_DATA_ROOT, 'quarantine');
  await ensurePrivateDir(quarantineDir);
  const filename = path.split(/[\\/]/).pop() || 'unknown.json';
  await rename(path, join(quarantineDir, `${Date.now()}-${reason}-${filename}`)).catch(async () => {
    await rm(path, { force: true }).catch(() => undefined);
  });
}
