import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_MAX_AGE_SECONDS = 60 * 60;

type ResetPayload = {
  customerId: number;
  email: string;
  exp: number;
};

function secret(): string {
  return import.meta.env.AUTH_SECRET || import.meta.env.SESSION_SECRET || import.meta.env.WOO_CONSUMER_SECRET || "tonerymaxim-dev-reset-secret";
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

export function makePasswordResetToken(customerId: number, email: string): string {
  const payload: ResetPayload = {
    customerId,
    email: String(email || "").trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + TOKEN_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyPasswordResetToken(token: string): ResetPayload | null {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) return null;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ResetPayload;
    if (!parsed.customerId || !parsed.email || !parsed.exp) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
