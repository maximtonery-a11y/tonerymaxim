import { createHmac, timingSafeEqual } from 'node:crypto';
import { authSecret } from './runtime-secret';

type PaymentAccess = { orderNumber: string; exp: number };

function sign(value: string): string {
  return createHmac('sha256', authSecret()).update(`gopay-access:${value}`).digest('base64url');
}

export function makePaymentAccessToken(orderNumber: string): string {
  const payload: PaymentAccess = { orderNumber: String(orderNumber || '').trim(), exp: Math.floor(Date.now() / 1000) + 86400 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifyPaymentAccessToken(token: unknown, orderNumber: unknown): boolean {
  const [encoded, supplied] = String(token || '').trim().split('.');
  if (!encoded || !supplied) return false;
  const expected = sign(encoded);
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PaymentAccess;
    return payload.exp >= Math.floor(Date.now() / 1000) && payload.orderNumber === String(orderNumber || '').trim();
  } catch { return false; }
}

export function paymentReturnUrl(base: string, accessToken: string): string {
  const url = new URL(base);
  url.searchParams.set('access', accessToken);
  return url.toString();
}
