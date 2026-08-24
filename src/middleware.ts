import { defineMiddleware } from 'astro:middleware';
import { randomUUID } from 'node:crypto';

const PRODUCTION_ORIGIN = 'https://www.tonerymaxim.sk';
const NOINDEX_HOSTS = new Set(['tonerymaxim.info', 'www.tonerymaxim.info']);
const TEST_ROUTES = new Set(['/api/test-woo','/api/auth/test-email','/api/cache-status','/test-produkt','/design/icons-test','/design/product-detail','/design/product-list']);
const PRIVATE_NOINDEX_PATHS = new Set([
  '/kosik',
  '/pokladna',
  '/platba-dokoncena',
  '/prihlasenie',
  '/registracia',
  '/zabudnute-heslo',
  '/reset-hesla',
]);

function isNoIndexHost(hostname: string): boolean {
  return NOINDEX_HOSTS.has(hostname.toLowerCase());
}

function isPrivateNoIndexPath(pathname: string): boolean {
  return PRIVATE_NOINDEX_PATHS.has(pathname)
    || pathname.startsWith('/ucet/')
    || pathname === '/ucet'
    || pathname.startsWith('/admin/');
}

function isPublicCacheablePage(request: Request, url: URL, response: Response): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  if (isPrivateNoIndexPath(url.pathname) || url.pathname.startsWith('/api/')) return false;
  if (response.headers.has('set-cookie')) return false;
  return response.status === 200;
}

function jsonError(message: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function applyHeaders(response: Response, headersToAdd: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(headersToAdd)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requestId(request:Request){
  const incoming=request.headers.get('x-request-id');
  return incoming&&/^[a-zA-Z0-9._-]{6,100}$/.test(incoming)?incoming:randomUUID();
}

function securityHeaders(url:URL,id:string):Record<string,string>{
  return {
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'strict-origin-when-cross-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(self)','Cross-Origin-Resource-Policy':'same-site',
    'Cross-Origin-Opener-Policy':'same-origin-allow-popups','X-Request-Id':id,
    'Content-Security-Policy':"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self' https://gate.gopay.cz https://gw.sandbox.gopay.com; script-src 'self' 'unsafe-inline' https://plugin.gls-slovakia.sk https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.cdnfonts.com; font-src 'self' data: https://fonts.cdnfonts.com; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src 'self' https://api.dpd.cz https://plugin.gls-slovakia.sk https://gate.gopay.cz https://gw.sandbox.gopay.com; worker-src 'self' blob:; manifest-src 'self'",
    ...(url.protocol==='https:'?{'Strict-Transport-Security':'max-age=31536000; includeSubDomains'}:{}),
  };
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  // Verejne stranky nesmu zavisiet od reklamnych modulov, analytickych suborov,
  // background workerov, persistentnych tajomstiev ani konfiguracie Google.
  // Kanonicku domenu riesia SEO tagy a Coolify; aplikacia nesmie presmerovat
  // funkcnu domenu na pripadne nenakonfigurovany www router.
  const noIndex = isNoIndexHost(url.hostname);
  const id = requestId(request);
  const commonSecurityHeaders = securityHeaders(url, id);

  const local=['localhost','127.0.0.1','::1'].includes(url.hostname.toLowerCase());
  if (TEST_ROUTES.has(url.pathname) && !local && process.env.TM_ALLOW_TEST_ENDPOINTS!=='1') {
    return applyHeaders(jsonError('Endpoint nie je v produkcii dostupný.', 404), commonSecurityHeaders);
  }

  // Liveness/readiness nesmú čítať diskový rate-limit ani tajomstvá. Skutočné
  // storefront trasy sa nezávisle overujú produkčným smoke testom.
  if(url.pathname==='/api/health'||url.pathname==='/api/readiness')return next();

  if (url.pathname.startsWith('/api/')) {
    // Security persistence is imported only for API traffic. Rendering the
    // storefront therefore cannot fail because of an admin/security secret.
    const {bodyTooLarge,rateLimitFor,registerBlock,validateOrigin}=await import('./lib/security');
    if (bodyTooLarge(request, 1_000_000)) {
      registerBlock('body-too-large', request, url, 'max=1000000');
      return applyHeaders(jsonError('Požiadavka je príliš veľká.', 413), commonSecurityHeaders);
    }

    if (!validateOrigin(request, url)) {
      registerBlock('origin-block', request, url);
      return applyHeaders(jsonError('Neplatný pôvod požiadavky.', 403), commonSecurityHeaders);
    }

    const rate = await rateLimitFor(url.pathname, request.method.toUpperCase(), request);
    if (!rate.ok) {
      return applyHeaders(
        jsonError('Príliš veľa požiadaviek. Skúste to znova neskôr.', 429, {
          'Retry-After': String(rate.retryAfter),
        }),
        commonSecurityHeaders,
      );
    }
  }

  if (url.pathname === '/robots.txt') {
    const paginationAllow = [
      'Allow: /produkty?page=',
      'Allow: /znacky/*?page=',
    ];
    const commonDisallow = [
      'Disallow: /admin/',
      'Disallow: /api/',
      'Disallow: /ucet/',
      'Disallow: /kosik',
      'Disallow: /pokladna',
    ];
    const publicCrawlers = [
      '*',
      'ClaudeBot',
      'Claude-User',
      'Claude-SearchBot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'GPTBot',
      'PerplexityBot',
      'Perplexity-User',
      'Google-Extended',
      'Applebot-Extended',
      'meta-externalagent',
    ];
    const crawlerRules = publicCrawlers.flatMap((crawler) => [
      `User-agent: ${crawler}`,
      'Allow: /',
      ...paginationAllow,
      ...commonDisallow,
      '',
    ]);
    const body = [
      ...crawlerRules,
      ...(noIndex ? [] : [`Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`]),
      '',
    ].join('\n');

    const response = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });

    if (noIndex) response.headers.set('X-Robots-Tag', 'noindex, follow');
    return applyHeaders(response, commonSecurityHeaders);
  }

  const response = await next();
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(commonSecurityHeaders)) headers.set(name, value);

  if (isPrivateNoIndexPath(url.pathname)) {
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  } else if (noIndex) {
    headers.set('X-Robots-Tag', 'noindex, follow');
  }

  const contentType = headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (isPublicCacheablePage(request, url, response)) {
    headers.set('Cache-Control', 'public, max-age=0, s-maxage=30, must-revalidate');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
