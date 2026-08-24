import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isStrongSecret } from './secret-validation.ts';
import { portableStoragePath } from './runtime-paths.ts';

export const TM_DATA_ROOT = resolve(
  portableStoragePath(process.env.TM_PERSISTENT_DATA_DIR) || join(process.cwd(), '.tm-data')
);

function isProduction(): boolean {
  return Boolean((import.meta as any).env?.PROD || process.env.NODE_ENV === 'production');
}

function readSecret(): string {
  return String(
    process.env.TM_PERSISTENCE_SECRET ||
    (import.meta as any).env?.TM_PERSISTENCE_SECRET ||
    process.env.AUTH_SECRET ||
    (import.meta as any).env?.AUTH_SECRET ||
    ''
  ).trim();
}

export function persistenceSecret(): string {
  const value = readSecret();
  if (isStrongSecret(value, 32)) return value;

  if (isProduction()) {
    throw new Error('TM_PERSISTENCE_SECRET alebo AUTH_SECRET musí byť jedinečný, nesmie byť ukážkový a musí mať aspoň 32 znakov.');
  }

  return 'tonerymaxim-local-persistence-secret-change-me';
}

function signature(payload: string): string {
  return createHmac('sha256', persistenceSecret()).update(payload).digest('hex');
}

function encryptionKey(): Buffer {
  return createHash('sha256')
    .update(`tonerymaxim:persistence:v2:${persistenceSecret()}`)
    .digest();
}

function encryptPayload(payload: string): { iv: string; tag: string; ciphertext: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptPayload(iv: string, tag: string, ciphertext: string): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Zašifruje jeden samostatný záznam určený napríklad do JSONL logu.
 * Každý riadok má vlastné IV a autentizačný tag, takže poškodený alebo
 * pozmenený riadok sa pri čítaní odmietne.
 */
export function encryptPrivateLine(payload: string): string {
  const encrypted = encryptPayload(payload);
  const authenticated = `${encrypted.iv}.${encrypted.tag}.${encrypted.ciphertext}`;
  return JSON.stringify({
    version: 2,
    ...encrypted,
    signature: signature(authenticated),
  });
}

export function decryptPrivateLine(line: string): string | null {
  try {
    const raw = JSON.parse(line) as {
      version?: number;
      iv?: string;
      tag?: string;
      ciphertext?: string;
      signature?: string;
    };

    // Staršie analytické JSONL riadky boli uložené ako obyčajný JSON.
    // Dovolíme ich iba načítať; všetky nové zápisy už budú šifrované.
    if (raw.version !== 2) return line;

    const iv = String(raw.iv || '');
    const tag = String(raw.tag || '');
    const ciphertext = String(raw.ciphertext || '');
    const authenticated = `${iv}.${tag}.${ciphertext}`;
    const supplied = Buffer.from(String(raw.signature || ''), 'hex');
    const expected = Buffer.from(signature(authenticated), 'hex');
    if (!iv || !tag || !ciphertext || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    return decryptPayload(iv, tag, ciphertext);
  } catch {
    return null;
  }
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
  const encrypted = encryptPayload(payload);
  const authenticated = `${encrypted.iv}.${encrypted.tag}.${encrypted.ciphertext}`;
  await atomicWriteText(path, JSON.stringify({
    version: 2,
    ...encrypted,
    signature: signature(authenticated),
  }));
}

export async function readSignedJson<T>(path: string): Promise<T | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as {
      version?: number;
      payload?: string;
      iv?: string;
      tag?: string;
      ciphertext?: string;
      signature?: string;
    };

    if (raw.version === 2) {
      const iv = String(raw.iv || '');
      const tag = String(raw.tag || '');
      const ciphertext = String(raw.ciphertext || '');
      const authenticated = `${iv}.${tag}.${ciphertext}`;
      const supplied = Buffer.from(String(raw.signature || ''), 'hex');
      const expected = Buffer.from(signature(authenticated), 'hex');
      if (!iv || !tag || !ciphertext || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
      return JSON.parse(decryptPayload(iv, tag, ciphertext)) as T;
    }

    // Spätná kompatibilita: súbory vytvorené pred zavedením šifrovania sa
    // načítajú a pri nasledujúcom zápise automaticky prejdú na formát v2.
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
