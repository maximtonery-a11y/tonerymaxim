import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { persistenceSecret, readSignedJson, TM_DATA_ROOT, writeSignedJson } from './secure-persistence';
import { isStrongSecret } from './secret-validation';

export type SecurityEvent = {
  ts: string;
  type: 'rate-limit' | 'origin-block' | 'body-too-large' | 'test-route-block' | 'suspicious-request';
  path: string;
  method: string;
  ipHash: string;
  detail?: string;
};

type RateRule = { limit: number; windowMs: number };
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const RATE_STATE_PATH = join(TM_DATA_ROOT, 'security', 'rate-limit.json');
let rateStateLoaded = false;
let rateStateLock: Promise<void> = Promise.resolve();
let rateStateTimer: ReturnType<typeof setTimeout> | undefined;
const events: SecurityEvent[] = [];
const MAX_EVENTS = 300;
const RATE_STATE_FLUSH_MS = 5_000;

const RATE_RULES: Array<{ match: RegExp; methods?: string[]; rule: RateRule }> = [
  // Prihlásenie: dostatočná rezerva pre reálnych zákazníkov aj firemné siete,
  // stále však blokuje automatizované brute-force pokusy.
  { match: /^\/api\/auth\/login$/, methods: ['POST'], rule: { limit: 30, windowMs: 60_000 } },

  // Registrácia a obnova hesla: vyšší bezpečný limit, aby neblokoval legitímne opakovanie formulára.
  { match: /^\/api\/auth\/(register|forgot-password|reset-password)$/, methods: ['POST'], rule: { limit: 15, windowMs: 10 * 60_000 } },

  // Checkout a GoPay: rezerva pre dvojklik, opakovanie po chybe a viac používateľov za jednou IP.
  { match: /^\/api\/(order-create|gopay-create)$/, methods: ['POST'], rule: { limit: 30, windowMs: 60_000 } },

  // GoPay stav môže frontend krátko pollingovať po návrate z platobnej brány.
  { match: /^\/api\/gopay-status$/, methods: ['GET'], rule: { limit: 180, windowMs: 60_000 } },

  { match: /^\/api\/contact$/, methods: ['POST'], rule: { limit: 12, windowMs: 10 * 60_000 } },
  { match: /^\/api\/customer-care\//, methods: ['POST'], rule: { limit: 12, windowMs: 10 * 60_000 } },

  // Citlivé účtové a platobné operácie.
  { match: /^\/api\/account\/change-password$/, methods: ['POST'], rule: { limit: 10, windowMs: 10 * 60_000 } },
  { match: /^\/api\/auth\/logout$/, methods: ['POST'], rule: { limit: 60, windowMs: 60_000 } },
  { match: /^\/api\/gopay-retry$/, methods: ['POST'], rule: { limit: 10, windowMs: 10 * 60_000 } },
  { match: /^\/api\/sync-products$/, methods: ['GET', 'POST'], rule: { limit: 6, windowMs: 10 * 60_000 } },

  // Analytika a vyhľadávanie generujú viac požiadaviek pri bežnom používaní.
  { match: /^\/api\/analytics$/, methods: ['POST'], rule: { limit: 600, windowMs: 60_000 } },
  { match: /^\/api\/(smart-search|products|product|printers)$/, methods: ['GET'], rule: { limit: 600, windowMs: 60_000 } },

  // AI odpovede môžu využívať platené API. Limit chráni náklady, no ponecháva
  // dostatočnú rezervu pre normálny rozhovor zákazníka s Tomášom.
  { match: /^\/api\/ai-sales-assistant$/, methods: ['POST'], rule: { limit: 30, windowMs: 10 * 60_000 } },
];

const TEST_ROUTES = new Set([
  '/api/test-woo',
  '/api/auth/test-email',
  '/api/cache-status',
  '/test-produkt',
  '/design/icons-test',
  '/design/product-detail',
  '/design/product-list',
]);

const ORIGIN_EXEMPT = new Set([
  '/api/gopay-notify',
]);


async function loadPersistentBuckets(): Promise<void> {
  if (rateStateLoaded) return;
  const saved = await readSignedJson<Record<string, Bucket>>(RATE_STATE_PATH);
  const now = Date.now();
  if (saved) for (const [key, value] of Object.entries(saved)) {
    if (Number(value?.resetAt || 0) > now && Number(value?.count || 0) > 0) buckets.set(key, value);
  }
  rateStateLoaded = true;
}

function flushBuckets(): void {
  if (rateStateTimer) clearTimeout(rateStateTimer);
  rateStateTimer = undefined;
  rateStateLock = rateStateLock.then(async () => {
    const now = Date.now();
    for (const [key, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(key);
    }
    const snapshot = Object.fromEntries(buckets.entries());
    await writeSignedJson(RATE_STATE_PATH, snapshot);
  }).catch((error) => {
    console.error('[TM security] rate-limit persistence failed:', error?.message || error);
  });
}

function persistBuckets(immediate = false): void {
  // Verejné GET endpointy vyhľadávania môžu dostať veľa požiadaviek počas
  // písania. Ich stav zapisujeme najviac raz za päť sekúnd, nie pri každom
  // znaku. Citlivé mutácie (login, checkout...) zostávajú zapísané okamžite.
  if (immediate) {
    flushBuckets();
    return;
  }
  if (rateStateTimer) return;
  rateStateTimer = setTimeout(flushBuckets, RATE_STATE_FLUSH_MS);
  rateStateTimer.unref?.();
}

function env(name: string): string {
  return String(process.env[name] || import.meta.env[name] || '').trim();
}

export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || 'unknown';
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`${ip}|${persistenceSecret()}|tm-security`).digest('hex').slice(0, 12);
}

function logEvent(event: Omit<SecurityEvent, 'ts'>): void {
  events.unshift({ ...event, ts: new Date().toISOString() });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

export function readSecurityEvents(limit = 100): SecurityEvent[] {
  return events.slice(0, Math.max(1, Math.min(limit, MAX_EVENTS)));
}

export function requestId(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  return incoming && /^[a-zA-Z0-9._-]{6,100}$/.test(incoming) ? incoming : randomUUID();
}

export async function rateLimitFor(path: string, method: string, request: Request): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  await loadPersistentBuckets();
  const matched = RATE_RULES.find((item) => item.match.test(path) && (!item.methods || item.methods.includes(method)));
  if (!matched) return { ok: true };

  const now = Date.now();
  const ip = clientIp(request);
  const key = `${path}|${method}|${hashIp(ip)}`;
  const current = buckets.get(key);

  const needsImmediatePersistence = method !== 'GET' && path !== '/api/analytics';

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + matched.rule.windowMs });
    persistBuckets(needsImmediatePersistence);
    return { ok: true };
  }

  current.count += 1;
  persistBuckets(needsImmediatePersistence);
  if (current.count <= matched.rule.limit) return { ok: true };

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  logEvent({ type: 'rate-limit', path, method, ipHash: hashIp(ip), detail: `retry-after=${retryAfter}s` });
  return { ok: false, retryAfter };
}

export function shouldBlockTestRoute(path: string, hostname: string): boolean {
  return TEST_ROUTES.has(path) && !isLocalHost(hostname) && env('TM_ALLOW_TEST_ENDPOINTS') !== '1';
}

export function validateOrigin(request: Request, url: URL): boolean {
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;
  if (ORIGIN_EXEMPT.has(url.pathname)) return true;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!origin && !referer) {
    const fetchSite = String(request.headers.get('sec-fetch-site') || '').toLowerCase();
    if (fetchSite === 'same-origin' || fetchSite === 'same-site') return true;

    // Synchronizácia katalógu je server-to-server volanie chránené vlastným
    // tajomstvom. Ostatné mutácie bez preukázateľného pôvodu odmietneme.
    if (url.pathname === '/api/sync-products') {
      return Boolean(request.headers.get('authorization') || request.headers.get('x-sync-secret'));
    }
    return false;
  }

  try {
    const source = new URL(origin || referer || '');
    return source.host === url.host;
  } catch {
    return false;
  }
}

export function bodyTooLarge(request: Request, maxBytes = 1_000_000): boolean {
  const raw = request.headers.get('content-length');
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > maxBytes;
}

export function registerBlock(type: SecurityEvent['type'], request: Request, url: URL, detail?: string): void {
  logEvent({
    type,
    path: url.pathname,
    method: request.method,
    ipHash: hashIp(clientIp(request)),
    detail,
  });
}

export function securityHeaders(url: URL, requestIdValue: string): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self' https://gate.gopay.cz https://gw.sandbox.gopay.com",
    "script-src 'self' 'unsafe-inline' https://plugin.gls-slovakia.sk https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.cdnfonts.com",
    "font-src 'self' data: https://fonts.cdnfonts.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https:",
    "frame-src 'self' https://api.dpd.cz https://plugin.gls-slovakia.sk https://gate.gopay.cz https://gw.sandbox.gopay.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self)',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Content-Security-Policy': csp,
    'X-Request-Id': requestIdValue,
  };
  if (url.protocol === 'https:') headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function securityStatus(hostname: string) {
  const authSecret = env('AUTH_SECRET');
  const syncSecret = env('SYNC_SECRET');
  const adminSecret = env('ADMIN_API_SECRET') || env('TM_ANALYTICS_ADMIN_KEY');
  const warnings = [
    !isStrongSecret(authSecret, 32) ? 'AUTH_SECRET chýba alebo je slabý.' : '',
    !isStrongSecret(syncSecret, 24) ? 'SYNC_SECRET chýba alebo je slabý.' : '',
    !isStrongSecret(adminSecret, 24) ? 'Administrátorský kľúč chýba alebo je slabý.' : '',
  ].filter(Boolean);
  return {
    ok: warnings.length === 0,
    warnings,
    hostname,
    local: isLocalHost(hostname),
    dedicatedAuthSecret: isStrongSecret(authSecret, 32),
    syncProtected: isStrongSecret(syncSecret, 24),
    adminProtected: isStrongSecret(adminSecret, 24),
    testEndpointsBlocked: !isLocalHost(hostname) && env('TM_ALLOW_TEST_ENDPOINTS') !== '1',
    rateLimitRules: RATE_RULES.length,
    persistentDataDir: TM_DATA_ROOT,
    rateLimitPersistent: true,
    recentEvents: readSecurityEvents(50),
  };
}
