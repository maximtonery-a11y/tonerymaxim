import { defineMiddleware } from 'astro:middleware';
import { ensureTonerCareWorkerStarted } from './lib/toner-care';
import { ensureEmailQueueStarted } from './lib/email-queue';

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
const TRUSTED_REQUEST_ORIGINS = new Set([
  'https://tonerymaxim.sk',
  'https://www.tonerymaxim.sk',
  'https://tonerymaxim.info',
  'https://www.tonerymaxim.info',
]);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_RATE_BUCKETS = 5_000;
const RATE_RULES: Array<{ match: RegExp; methods: string[]; limit: number; windowMs: number }> = [
  { match: /^\/api\/auth\/login$/, methods: ['POST'], limit: 30, windowMs: 60_000 },
  { match: /^\/api\/auth\/(register|forgot-password|reset-password)$/, methods: ['POST'], limit: 15, windowMs: 600_000 },
  { match: /^\/api\/(order-create|gopay-create)$/, methods: ['POST'], limit: 30, windowMs: 60_000 },
  { match: /^\/api\/gopay-status$/, methods: ['GET'], limit: 180, windowMs: 60_000 },
  { match: /^\/api\/(smart-search|products|product|printers)$/, methods: ['GET'], limit: 600, windowMs: 60_000 },
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
  try {
    const source = new URL(origin || referer || '');
    if (TRUSTED_REQUEST_ORIGINS.has(source.origin)) return true;
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    return localHosts.has(source.hostname) && localHosts.has(url.hostname) && source.port === url.port;
  } catch {
    return false;
  }
}

function rateAllowed(request: Request, url: URL): { ok: true } | { ok: false; retryAfter: number } {
  const method = request.method.toUpperCase();
  const rule = RATE_RULES.find((item) => item.match.test(url.pathname) && item.methods.includes(method));
  if (!rule) return { ok: true };
  const now = Date.now();
  const key = `${url.pathname}|${method}|${clientIp(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    // IP adresy a query parametre od botov nesmu vytvorit neobmedzenu Map.
    // Najprv odstranime expirovane zaznamy a pri plnom limite najstarsi.
    if (buckets.size >= MAX_RATE_BUCKETS) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
      while (buckets.size >= MAX_RATE_BUCKETS) {
        const oldestKey = buckets.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        buckets.delete(oldestKey);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true };
  }
  current.count += 1;
  return current.count <= rule.limit
    ? { ok: true }
    : { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

function temporaryUnavailable(): Response {
  const body = `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="8"><title>Stránku načítavame | ToneryMaxim.sk</title><style>body{margin:0;background:#f5f8fc;color:#071d41;font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.box{width:min(520px,calc(100% - 40px));padding:32px;border:1px solid #dce7f4;border-radius:24px;background:#fff;box-shadow:0 18px 50px #0b2b5520;text-align:center}.spin{width:38px;height:38px;margin:0 auto 18px;border:4px solid #dce7f4;border-top-color:#0a8be8;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}h1{font-size:26px;margin:0 0 10px}p{color:#53657c;margin:0 0 20px}a{display:inline-block;padding:12px 20px;border-radius:999px;background:#071d41;color:#fff;text-decoration:none;font-weight:750}</style></head><body><main class="box"><div class="spin" aria-hidden="true"></div><h1>Stránku práve načítavame</h1><p>Nastala krátka technická prestávka. Stránka sa automaticky obnoví o niekoľko sekúnd.</p><a href="javascript:location.reload()">Obnoviť stránku (F5)</a></main></body></html>`;
  return new Response(body, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '8',
    },
  });
}

function apiError(message: string, status: number, extra: Record<string, string> = {}): Response {
  return Response.json({ ok: false, error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extra },
  });
}

function publicCacheable(request: Request, url: URL, response: Response): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  if (privatePath(url.pathname) || url.pathname.startsWith('/api/')) return false;
  if (response.status !== 200 || response.headers.has('set-cookie')) return false;
  return true;
}

function finish(response: Response, url: URL, request?: Request): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (privatePath(url.pathname)) headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  else if (NOINDEX_HOSTS.has(url.hostname.toLowerCase())) headers.set('X-Robots-Tag', 'noindex, follow');
  if (url.pathname.startsWith('/api/') || privatePath(url.pathname)) headers.set('Cache-Control', 'no-store');
  else if (request && publicCacheable(request, url, response)) {
    // Verejny SSR storefront moze kratko cachovat reverzna proxy/CDN.
    // Znizuje to pocet Node renderov pri spickach a crawleroch, bez cachovania
    // kosika, pokladne, uctu, adminu alebo odpovedi so Set-Cookie.
    headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async ({ request, url }, next) => {
  // Healthcheck zostáva úplne ľahký. Prvá bežná požiadavka spustí neblokujúci
  // denný worker; globálny zámok zabráni ďalším časovačom v tom istom procese.
  if (!['/api/health', '/api/readiness', '/api/storefront-check'].includes(url.pathname)) {
    ensureTonerCareWorkerStarted();
    if (process.env.TM_DISABLE_BACKGROUND_WORKERS !== '1') ensureEmailQueueStarted();
  }
  // Storefront, kosik, pokladna a healthcheck nemaju ziadnu zavislost od
  // Ads, Merchant, Analytics, ich klucov ani ich diskoveho uloziska.
  if (!url.pathname.startsWith('/api/')
    || url.pathname === '/api/health'
    || url.pathname === '/api/readiness'
    || url.pathname === '/api/storefront-check') {
    try {
      return finish(await next(), url, request);
    } catch (error) {
      console.error('[TM storefront] SSR request failed', url.pathname, error instanceof Error ? error.message : error);
      return finish(temporaryUnavailable(), url, request);
    }
  }

  // Stary interny analytics endpoint je po oddeleni systemu tvrdo vypnuty.
  // Aj stare otvorene taby/browser cache tak uz nemozu zapisovat analytics na disk.
  if (url.pathname === '/api/analytics') {
    return apiError('Analytics je v produkcnom e-shope vypnuta.', 410);
  }

  if (TEST_ROUTES.has(url.pathname) && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    return apiError('Endpoint nie je v produkcii dostupny.', 404);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > 1_000_000) return apiError('Poziadavka je prilis velka.', 413);
  if (!originAllowed(request, url)) return apiError('Neplatny povod poziadavky.', 403);
  const rate = rateAllowed(request, url);
  if (!rate.ok) return apiError('Prilis vela poziadaviek.', 429, { 'Retry-After': String(rate.retryAfter) });
  try {
    return finish(await next(), url, request);
  } catch (error) {
    console.error('[TM API] request failed', url.pathname, error instanceof Error ? error.message : error);
    return apiError('Sluzba je docasne nedostupna. Skuste poziadavku zopakovat.', 503, { 'Retry-After': '8' });
  }
});
