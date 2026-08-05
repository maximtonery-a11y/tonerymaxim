import { defineMiddleware } from 'astro:middleware';
import { ensureEmailQueueStarted } from './lib/email-queue';
import { ensureAsyncOrderQueueStarted } from './lib/async-order-queue';
import { authSecret } from './lib/runtime-secret';
import { persistenceSecret } from './lib/secure-persistence';
import { ensureProductsCacheWarmStarted } from './lib/tm-products-cache';
import {
  bodyTooLarge,
  rateLimitFor,
  registerBlock,
  requestId,
  securityHeaders,
  shouldBlockTestRoute,
  validateOrigin,
  securityStatus,
} from './lib/security';

const PRODUCTION_ORIGIN = 'https://www.tonerymaxim.sk';
const PRODUCTION_HOSTS = new Set(['tonerymaxim.sk', 'www.tonerymaxim.sk']);
const NOINDEX_HOSTS = new Set(['tonerymaxim.info', 'www.tonerymaxim.info']);
const ANALYTICS_TAG = '<script src="/tm-analytics.js" defer></script>';
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

function shouldInjectAnalytics(pathname: string): boolean {
  return !pathname.startsWith('/api/')
    && !pathname.startsWith('/admin/')
    && !isPrivateNoIndexPath(pathname);
}

function optionalGoogleTag(): string {
  const id = String(process.env.PUBLIC_GTM_ID || import.meta.env.PUBLIC_GTM_ID || '').trim().toUpperCase();
  return /^GTM-[A-Z0-9]+$/.test(id)
    ? `<script src="/tm-google-tags.js" data-gtm-id="${id}" defer></script>`
    : '';
}

function isPrivateNoIndexPath(pathname: string): boolean {
  return PRIVATE_NOINDEX_PATHS.has(pathname)
    || pathname.startsWith('/ucet/')
    || pathname === '/ucet'
    || pathname.startsWith('/admin/');
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

let runtimeSecretsValidated = false;

function validateRuntimeSecretsOnce(): void {
  if (runtimeSecretsValidated) return;
  authSecret();
  persistenceSecret();
  const security = securityStatus('production');
  if (import.meta.env.PROD && !security.ok) {
    throw new Error(`Produkčné bezpečnostné nastavenie nie je kompletné: ${security.warnings.join(' ')}`);
  }
  runtimeSecretsValidated = true;
}

function backgroundWorkersEnabled(): boolean {
  return String(process.env.TM_DISABLE_BACKGROUND_WORKERS || '').trim() !== '1';
}

function canonicalProductionRedirect(request: Request, url: URL): Response | null {
  if (!PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) return null;
  const forwardedProto = String(request.headers.get('x-forwarded-proto') || '').split(',')[0]?.trim().toLowerCase();
  const secure = forwardedProto ? forwardedProto === 'https' : url.protocol === 'https:';
  if (secure && url.hostname.toLowerCase() === 'www.tonerymaxim.sk') return null;

  const target = new URL(`${url.pathname}${url.search}`, PRODUCTION_ORIGIN);
  return new Response(null, {
    status: 301,
    headers: {
      Location: target.toString(),
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  validateRuntimeSecretsOnce();
  if (backgroundWorkersEnabled()) {
    ensureEmailQueueStarted();
    ensureAsyncOrderQueueStarted();
    ensureProductsCacheWarmStarted();
  }

  const { request, url } = context;
  const canonicalRedirect = canonicalProductionRedirect(request, url);
  if (canonicalRedirect) return canonicalRedirect;
  const noIndex = isNoIndexHost(url.hostname);
  const id = requestId(request);
  const commonSecurityHeaders = securityHeaders(url, id);

  if (shouldBlockTestRoute(url.pathname, url.hostname)) {
    registerBlock('test-route-block', request, url);
    return applyHeaders(jsonError('Endpoint nie je v produkcii dostupný.', 404), commonSecurityHeaders);
  }

  if (url.pathname.startsWith('/api/')) {
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
    const commonDisallow = [
      'Disallow: /admin/',
      'Disallow: /api/',
      'Disallow: /ucet/',
      'Disallow: /kosik',
      'Disallow: /pokladna',
      'Disallow: /*?*',
    ];
    const body = [
      'User-agent: *',
      'Allow: /',
      ...commonDisallow,
      '',
      'User-agent: OAI-SearchBot',
      'Allow: /',
      ...commonDisallow,
      '',
      'User-agent: GPTBot',
      'Allow: /',
      ...commonDisallow,
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
  if (!contentType.includes('text/html') || !shouldInjectAnalytics(url.pathname)) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  const tags = [ANALYTICS_TAG, optionalGoogleTag()].filter(Boolean).join('\n');
  const withAnalytics = html.includes('/tm-analytics.js')
    ? html
    : html.replace('</body>', `${tags}\n</body>`);

  headers.delete('content-length');
  return new Response(withAnalytics, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
