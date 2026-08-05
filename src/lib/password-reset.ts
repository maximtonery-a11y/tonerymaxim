import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { authSecret } from "./runtime-secret";
import { readSignedJson, TM_DATA_ROOT, writeSignedJson } from "./secure-persistence";

const TOKEN_MAX_AGE_SECONDS = 60 * 60;

type ResetPayload = {
  customerId: number;
  email: string;
  jti: string;
  exp: number;
};

function tokenPath(jti: string): string {
  const key = createHash("sha256").update(jti).digest("hex");
  return join(TM_DATA_ROOT, "auth", "reset-tokens", `${key}.json`);
}

function secret(): string {
  return authSecret();
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function makePasswordResetToken(customerId: number, email: string): Promise<string> {
  const payload: ResetPayload = {
    customerId,
    email: String(email || "").trim().toLowerCase(),
    jti: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + TOKEN_MAX_AGE_SECONDS,
  };
  await writeSignedJson(tokenPath(payload.jti), payload);
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export async function verifyPasswordResetToken(token: string): Promise<ResetPayload | null> {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) return null;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ResetPayload;
    if (!parsed.customerId || !parsed.email || !parsed.jti || !parsed.exp) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    const stored = await readSignedJson<ResetPayload>(tokenPath(parsed.jti));
    if (!stored || stored.customerId !== parsed.customerId || stored.email !== parsed.email || stored.exp !== parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function consumePasswordResetToken<T>(token: string, action: (payload: ResetPayload) => Promise<T>): Promise<T | null> {
  const payload = await verifyPasswordResetToken(token);
  if (!payload) return null;
  const path = tokenPath(payload.jti);
  const lockPath = `${path}.lock`;
  let lock: FileHandle;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    return null;
  }
  try {
    const current = await verifyPasswordResetToken(token);
    if (!current) return null;
    const result = await action(current);
    await rm(path, { force: true });
    return result;
  } finally {
    await lock.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}
