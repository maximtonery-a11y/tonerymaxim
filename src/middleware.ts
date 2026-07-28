import { defineMiddleware } from 'astro:middleware';
import { ensureEmailQueueStarted } from './lib/email-queue';
import { ensureAsyncOrderQueueStarted } from './lib/async-order-queue';
import { authSecret } from './lib/runtime-secret';
import { persistenceSecret } from './lib/secure-persistence';
import {
  bodyTooLarge,
  rateLimitFor,
  registerBlock,
  requestId,
  securityHeaders,
  shouldBlockTestRoute,
  validateOrigin,
} from './lib/security';

const PRODUCTION_ORIGIN = 'https://www.tonerymaxim.sk';
const NOINDEX_HOSTS = new Set(['tonerymaxim.info', 'www.tonerymaxim.info']);
const ANALYTICS_TAG = '<script src="/tm-analytics.js" defer></script>';

function isNoIndexHost(hostname: string): boolean {
  return NOINDEX_HOSTS.has(hostname.toLowerCase());
}

function shouldInjectAnalytics(pathname: string): boolean {
  return !pathname.startsWith('/api/') && !pathname.startsWith('/admin/');
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
  runtimeSecretsValidated = true;
}

export const onRequest = defineMiddleware(async (context, next) => {
  validateRuntimeSecretsOnce();
  ensureEmailQueueStarted();
  ensureAsyncOrderQueueStarted();

  const { request, url } = context;
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
    const body = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin/',
      'Disallow: /api/',
      'Disallow: /ucet/',
      'Disallow: /kosik',
      'Disallow: /pokladna',
      'Disallow: /*?*',
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

  if (noIndex) headers.set('X-Robots-Tag', 'noindex, follow');

  const contentType = headers.get('content-type') || '';
  if (!contentType.includes('text/html') || !shouldInjectAnalytics(url.pathname)) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  const withAnalytics = html.includes('/tm-analytics.js')
    ? html
    : html.replace('</body>', `${ANALYTICS_TAG}\n</body>`);

  headers.delete('content-length');
  return new Response(withAnalytics, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
