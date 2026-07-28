import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./runtime-secret";
import type { WooCustomer } from "./woo-client";

const COOKIE_NAME = "tm_customer_session";
const MAX_AGE = 60 * 60 * 24 * 14;

type SessionPayload = {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  exp: number;
};

function secret(): string {
  return authSecret();
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function verifySignature(payload: string, signature: string): boolean {
  const expected = sign(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function makeCustomerSession(customer: WooCustomer): string {
  const payload: SessionPayload = {
    id: customer.id,
    email: customer.email,
    first_name: customer.first_name || customer.billing?.first_name || "",
    last_name: customer.last_name || customer.billing?.last_name || "",
    exp: Math.floor(Date.now() / 1000) + MAX_AGE,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function setCustomerCookie(cookies: any, customer: WooCustomer): void {
  cookies.set(COOKIE_NAME, makeCustomerSession(customer), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: import.meta.env.PROD,
    maxAge: MAX_AGE,
  });
}

export function clearCustomerCookie(cookies: any): void {
  cookies.delete(COOKIE_NAME, { path: "/" });
}

export function readCustomerSession(cookies: any): SessionPayload | null {
  const raw = cookies.get(COOKIE_NAME)?.value;
  if (!raw || !raw.includes(".")) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !verifySignature(payload, signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed?.id || !parsed?.email || !parsed.exp) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function customerDisplayName(customer: SessionPayload | null): string {
  if (!customer) return "Zákazník";
  const full = `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
  return full || customer.email;
}

export function customerInitials(customer: SessionPayload | null): string {
  const name = customerDisplayName(customer);
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return `${parts[0]?.[0] || "Z"}${parts[1]?.[0] || ""}`.toUpperCase();
}

export type CustomerSession = SessionPayload;
