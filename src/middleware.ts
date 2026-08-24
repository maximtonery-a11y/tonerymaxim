import { defineMiddleware } from 'astro:middleware';

const NOINDEX_HOSTS = new Set(['tonerymaxim.info', 'www.tonerymaxim.info']);
const PRIVATE_PATHS = new Set([
  '/kosik', '/pokladna', '/platba-dokoncena', '/prihlasenie', '/registracia',
  '/zabudnute-heslo', '/reset-hesla',
]);
const TEST_ROUTES = new Set([
  '/api/test-woo', '/api/auth/test-email', '/api/cache-status', '/test-produkt',
  '/design/icons-test', '/design/product-detail', '/design/product-list',
]);
const ORIGIN_EXEMPT = new Set(['/api/gopay-notify']);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const RATE_RULES: Array<{ match: RegExp; methods: string[]; limit: number; windowMs: number }> = [
  { match: /^\/api\/auth\/login$/, methods: ['POST'], limit: 30, windowMs: 60_000 },
  { match: /^\/api\/auth\/(register|forgot-password|reset-password)$/, methods: ['POST'], limit: 15, windowMs: 600_000 },
  { match: /^\/api\/(order-create|gopay-create)$/, methods: ['POST'], limit: 30, windowMs: 60_000 },
  { match: /^\/api\/gopay-status$/, methods: ['GET'], limit: 180, windowMs: 60_000 },
  { match: /^\/api\/(smart-search|products|product|printers)$/, methods: ['GET'], limit: 600, windowMs: 60_000 },
  { match: /^\/api\/analytics$/, methods: ['POST'], limit: 300, windowMs: 60_000 },
  { match: /^\/api\/ai-/, methods: ['POST'], limit: 30, windowMs: 600_000 },
];

function privatePath(pathname: string): boolean {
  return PRIVATE_PATHS.has(pathname) || pathname === '/ucet'
    || pathname.startsWith('/ucet/') || pathname.startsWith('/admin/');
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown';
}

function originAllowed(request: Request, url: URL): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return true;
  if (ORIGIN_EXEMPT.has(url.pathname)) return true;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!origin && !referer) {
    if (url.pathname === '/api/sync-products') {
      return Boolean(request.headers.get('authorization') || request.headers.get('x-sync-secret'));
    }
    return ['same-origin', 'same-site'].includes(String(request.headers.get('sec-fetch-site') || '').toLowerCase());
  }
  try { return new URL(origin || referer || '').host === url.host; } catch { return false; }
}

function rateAllowed(request: Request, url: URL): { ok: true } | { ok: false; retryAfter: number } {
  const method = request.method.toUpperCase();
  const rule = RATE_RULES.find((item) => item.match.test(url.pathname) && item.methods.includes(method));
  if (!rule) return { ok: true };
  const now = Date.now();
  const key = `${url.pathname}|${method}|${clientIp(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    if (buckets.size > 10_000) for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    return { ok: true };
  }
  current.count += 1;
  return current.count <= rule.limit
    ? { ok: true }
    : { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

function apiError(message: string, status: number, extra: Record<string, string> = {}): Response {
  return Response.json({ ok: false, error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extra },
  });
}

function finish(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (privatePath(url.pathname)) headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  else if (NOINDEX_HOSTS.has(url.hostname.toLowerCase())) headers.set('X-Robots-Tag', 'noindex, follow');
  if (url.pathname.startsWith('/api/') || privatePath(url.pathname)) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async ({ request, url }, next) => {
  // Storefront, kosik, pokladna a healthcheck nemaju ziadnu zavislost od
  // Ads, Merchant, Analytics, ich klucov ani ich diskoveho uloziska.
  if (!url.pathname.startsWith('/api/')
    || url.pathname === '/api/health'
    || url.pathname === '/api/readiness'
    || url.pathname === '/api/storefront-check') {
    return finish(await next(), url);
  }

  if (TEST_ROUTES.has(url.pathname) && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    return apiError('Endpoint nie je v produkcii dostupny.', 404);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > 1_000_000) return apiError('Poziadavka je prilis velka.', 413);
  if (!originAllowed(request, url)) return apiError('Neplatny povod poziadavky.', 403);
  const rate = rateAllowed(request, url);
  if (!rate.ok) return apiError('Prilis vela poziadaviek.', 429, { 'Retry-After': String(rate.retryAfter) });
  return finish(await next(), url);
});
