import { defineMiddleware } from 'astro:middleware';
import { clientIp, localDevelopmentHost, productionRuntime, rememberRequestPeer, requestOriginAllowed, securityPath } from './lib/request-security.ts';
import { requestRateRule } from './lib/rate-policy.ts';

const BACKGROUND_WORKERS_GLOBAL_KEY = '__tmBackgroundWorkersScheduled';

function scheduleBackgroundWorkers(): void {
  if (process.env.TM_DISABLE_BACKGROUND_WORKERS === '1') return;
  const globalState = globalThis as typeof globalThis & { [BACKGROUND_WORKERS_GLOBAL_KEY]?: boolean };
  if (globalState[BACKGROUND_WORKERS_GLOBAL_KEY]) return;
  globalState[BACKGROUND_WORKERS_GLOBAL_KEY] = true;

  // Storefront nesmie pri studenom štarte načítavať moduly denných workerov.
  // Worker moduly sa načítajú až po odpovedi a každý z nich si ďalej stráži,
  // aby v jednom Node procese nevytvoril viac časovačov.
  setTimeout(async () => {
    try {
      const [{ ensureTonerCareWorkerStarted }, { ensureCustomerCareDeliveryWorkerStarted }, { ensureEmailQueueStarted }, { ensureFirmwareInfoWorkerStarted }, { ensureNightlyPriceWorkerStarted }, { ensureDpdPickupRepairStarted }] = await Promise.all([
        import('./lib/toner-care'),
        import('./lib/customer-care'),
        import('./lib/email-queue'),
        import('./lib/firmware-info'),
        import('./lib/nightly-price-worker'),
        import('./lib/dpd-pickup-repair-worker'),
      ]);
      ensureTonerCareWorkerStarted();
      ensureCustomerCareDeliveryWorkerStarted();
      if (process.env.TM_DISABLE_BACKGROUND_WORKERS !== '1') {
        ensureEmailQueueStarted();
        ensureFirmwareInfoWorkerStarted();
        ensureNightlyPriceWorkerStarted();
        ensureDpdPickupRepairStarted();
      }
    } catch (error) {
      globalState[BACKGROUND_WORKERS_GLOBAL_KEY] = false;
      console.error('[TM workers] delayed startup failed', error instanceof Error ? error.message : error);
    }
  }, 2_000).unref?.();
}

const NOINDEX_HOSTS = new Set(['tonerymaxim.info', 'www.tonerymaxim.info']);
const PRIVATE_PATHS = new Set([
  '/kosik', '/pokladna', '/platba-dokoncena', '/prihlasenie', '/registracia',
  '/zabudnute-heslo', '/reset-hesla',
]);
const TEST_ROUTES = new Set([
  '/api/test-woo', '/api/auth/test-email', '/api/cache-status', '/test-produkt',
  '/design/icons-test', '/design/product-detail', '/design/product-list',
]);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_RATE_BUCKETS = 5_000;

function privatePath(pathname: string): boolean {
  pathname = securityPath(pathname);
  return PRIVATE_PATHS.has(pathname) || pathname === '/ucet'
    || pathname.startsWith('/ucet/') || pathname === '/admin' || pathname.startsWith('/admin/');
}


function rateAllowed(request: Request, url: URL): { ok: true } | { ok: false; retryAfter: number } {
  const method = request.method.toUpperCase();
  const rule = requestRateRule(url.pathname, method);
  if (!rule) return { ok: true };
  const now = Date.now();
  const key = `${securityPath(url.pathname)}|${method}|${clientIp(request)}`;
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

export function liveCatalogPath(pathname: string): boolean {
  return pathname === '/produkty'
    || pathname === '/tonery'
    || pathname === '/atramentove-naplne'
    || pathname === '/kompatibilne-tonery'
    || pathname === '/originalne-tonery'
    || pathname === '/renovovane-tonery'
    || pathname.startsWith('/produkt/')
    || pathname.startsWith('/oem/')
    || pathname.startsWith('/znacky/')
    || /^\/tlaciarne\/[^/]+\/[^/]+\/?$/.test(pathname);
}

function finish(response: Response, url: URL, request?: Request, startedAt?: number): Response {
  const headers = new Headers(response.headers);
  if (startedAt !== undefined) headers.append('Server-Timing', `app;dur=${Math.max(0, performance.now() - startedAt).toFixed(1)}`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', privatePath(url.pathname) ? 'no-referrer' : 'strict-origin-when-cross-origin');
  headers.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'self'");
  headers.set('Permissions-Policy', 'camera=(), microphone=()');
  if (url.protocol === 'https:' || productionRuntime()) headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (privatePath(url.pathname)) headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  else if (NOINDEX_HOSTS.has(url.hostname.toLowerCase())) headers.set('X-Robots-Tag', 'noindex, follow');
  if (url.pathname.startsWith('/api/') || privatePath(url.pathname) || liveCatalogPath(url.pathname)) headers.set('Cache-Control', 'no-store');
  else if (request && publicCacheable(request, url, response)) {
    // Verejny SSR storefront moze kratko cachovat reverzna proxy/CDN.
    // Znizuje to pocet Node renderov pri spickach a crawleroch, bez cachovania
    // kosika, pokladne, uctu, adminu alebo odpovedi so Set-Cookie.
    headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const startedAt = performance.now();
  try { rememberRequestPeer(request, context.clientAddress); } catch { rememberRequestPeer(request, ''); }
  const path = securityPath(url.pathname);
  if (TEST_ROUTES.has(path) && !localDevelopmentHost(url.hostname)) {
    return finish(apiError('Endpoint nie je v produkcii dostupny.', 404), url, request, startedAt);
  }
  // Healthcheck zostáva úplne ľahký. Prvá bežná požiadavka iba naplánuje
  // oneskorený štart workerov bez ich načítania v kritickej ceste odpovede.
  if (!['/api/health', '/api/readiness', '/api/storefront-check'].includes(url.pathname)) {
    scheduleBackgroundWorkers();
  }
  // Storefront, kosik, pokladna a healthcheck nemaju ziadnu zavislost od
  // Ads, Merchant, Analytics, ich klucov ani ich diskoveho uloziska.
  if (!path.startsWith('/api/')
    || url.pathname === '/api/health'
    || url.pathname === '/api/readiness'
    || url.pathname === '/api/storefront-check') {
    try {
      return finish(await next(), url, request, startedAt);
    } catch (error) {
      console.error('[TM storefront] SSR request failed', url.pathname, error instanceof Error ? error.message : error);
      return finish(temporaryUnavailable(), url, request, startedAt);
    }
  }

  // Stary interny analytics endpoint je po oddeleni systemu tvrdo vypnuty.
  // Aj stare otvorene taby/browser cache tak uz nemozu zapisovat analytics na disk.
  if (url.pathname === '/api/analytics') {
    return finish(apiError('Analytics je v produkcnom e-shope vypnuta.', 410), url, request, startedAt);
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > 1_000_000) return finish(apiError('Poziadavka je prilis velka.', 413), url, request, startedAt);
  if (!requestOriginAllowed(request, url)) return finish(apiError('Neplatny povod poziadavky.', 403), url, request, startedAt);
  const rate = rateAllowed(request, url);
  if (!rate.ok) return finish(apiError('Prilis vela poziadaviek.', 429, { 'Retry-After': String(rate.retryAfter) }), url, request, startedAt);
  try {
    return finish(await next(), url, request, startedAt);
  } catch (error) {
    console.error('[TM API] request failed', url.pathname, error instanceof Error ? error.message : error);
    return finish(apiError('Sluzba je docasne nedostupna. Skuste poziadavku zopakovat.', 503, { 'Retry-After': '8' }), url, request, startedAt);
  }
});
