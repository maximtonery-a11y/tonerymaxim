import { securityPath } from './request-security.ts';

export type RequestRateRule = { match: RegExp; methods: string[]; limit: number; windowMs: number };
export const REQUEST_RATE_RULES: RequestRateRule[] = [
  { match: /^\/api\/auth\/login$/, methods: ['POST'], limit: 30, windowMs: 60_000 },
  { match: /^\/api\/auth\/(register|forgot-password|reset-password)$/, methods: ['POST'], limit: 15, windowMs: 600_000 },
  { match: /^\/api\/auth\/logout$/, methods: ['POST'], limit: 60, windowMs: 60_000 },
  { match: /^\/api\/account\/change-password$/, methods: ['POST'], limit: 10, windowMs: 600_000 },
  { match: /^\/api\/newsletter\/(subscribe|unsubscribe|account-unsubscribe)$/, methods: ['POST'], limit: 12, windowMs: 600_000 },
  { match: /^\/api\/admin\/newsletter$/, methods: ['GET', 'POST'], limit: 30, windowMs: 600_000 },
  { match: /^\/api\/(order-create|gopay-create)$/, methods: ['POST'], limit: 30, windowMs: 60_000 },
  { match: /^\/api\/(gopay-retry|gopay-change-payment)$/, methods: ['POST'], limit: 10, windowMs: 600_000 },
  { match: /^\/api\/gopay-status$/, methods: ['GET'], limit: 180, windowMs: 60_000 },
  { match: /^\/api\/contact$/, methods: ['POST'], limit: 12, windowMs: 600_000 },
  { match: /^\/api\/customer-care\//, methods: ['POST'], limit: 12, windowMs: 600_000 },
  { match: /^\/api\/sync-products$/, methods: ['GET', 'POST'], limit: 6, windowMs: 600_000 },
  { match: /^\/api\/analytics$/, methods: ['POST'], limit: 600, windowMs: 60_000 },
  { match: /^\/api\/(smart-search|products|product|printers)$/, methods: ['GET'], limit: 600, windowMs: 60_000 },
  { match: /^\/api\/ai-/, methods: ['POST'], limit: 30, windowMs: 600_000 },
];

export function requestRateRule(path: string, method: string): RequestRateRule | undefined {
  const canonical = securityPath(path);
  return REQUEST_RATE_RULES.find(item => item.match.test(canonical) && item.methods.includes(method.toUpperCase()));
}
