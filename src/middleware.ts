import { defineMiddleware } from 'astro:middleware';
import { ensureEmailQueueStarted } from './lib/email-queue';
import {
  bodyTooLarge,
  rateLimitFor,
  registerBlock,
  requestId,
  securityHeaders,
  shouldBlockTestRoute,
  validateOrigin,
} from './lib/security';

const NOINDEX_HOSTS = new Set(['tonerymaxim.info', 'www.tonerymaxim.info']);
const ANALYTICS_TAG = '<script src="/tm-analytics.js" defer></script>';

function isNoIndexHost(hostname: string): boolean {
  return NOINDEX_HOSTS.has(hostname.toLowerCase());
}

function shouldInjectAnalytics(pathname: string): boolean {
  return !pathname.startsWith('/api/') && !pathname.startsWith('/admin/');
}

function jsonError(message: string, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  ensureEmailQueueStarted();
  const { url, request } = context;
  const rid = requestId(request);
  const noIndex = isNoIndexHost(url.hostname);

  if (url.pathname === '/robots.txt') {
    const body = noIndex ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n';
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
    if (noIndex) response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    Object.entries(securityHeaders(url, rid)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }

  if (url.pathname.startsWith('/api/')) {
    if (shouldBlockTestRoute(url.pathname, url.hostname)) {
      registerBlock('test-route-block', request, url);
      return jsonError('Endpoint nie je v produkcii dostupný.', 404);
    }

    if (!validateOrigin(request, url)) {
      registerBlock('origin-block', request, url, request.headers.get('origin') || request.headers.get('referer') || 'unknown');
      return jsonError('Neplatný pôvod požiadavky.', 403);
    }

    if (bodyTooLarge(request, url.pathname.startsWith('/api/customer-care/') ? 8_000_000 : 1_000_000)) {
      registerBlock('body-too-large', request, url, request.headers.get('content-length') || 'unknown');
      return jsonError('Požiadavka je príliš veľká.', 413);
    }

    const rate = rateLimitFor(url.pathname, request.method.toUpperCase(), request);
    if (!rate.ok) {
      return jsonError('Príliš veľa požiadaviek. Skúste to neskôr.', 429, { 'Retry-After': String(rate.retryAfter) });
    }
  }

  const response = await next();
  const headers = new Headers(response.headers);

  Object.entries(securityHeaders(url, rid)).forEach(([key, value]) => headers.set(key, value));
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')) headers.set('Cache-Control', 'no-store');
  if (noIndex) headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');

  const contentType = headers.get('content-type') || '';
  if (!contentType.includes('text/html') || !shouldInjectAnalytics(url.pathname)) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const html = await response.text();
  const withAnalytics = html.includes('/tm-analytics.js') ? html : html.replace('</body>', `${ANALYTICS_TAG}\n</body>`);
  headers.delete('content-length');
  return new Response(withAnalytics, { status: response.status, statusText: response.statusText, headers });
});
