import { defineMiddleware } from 'astro:middleware';
import { ensureEmailQueueStarted } from './lib/email-queue';
import { ensureAsyncOrderQueueStarted } from './lib/async-order-queue';

const APP_BASE = '/novy';
const NOINDEX_HOSTS = new Set(['tonerymaxim.info', 'www.tonerymaxim.info']);
const ANALYTICS_TAG = `<script src="${APP_BASE}/tm-analytics.js" defer></script>`;

function isNoIndexHost(hostname: string): boolean {
  return NOINDEX_HOSTS.has(hostname.toLowerCase());
}

function appPath(pathname: string): string {
  if (pathname === APP_BASE) return '/';
  return pathname.startsWith(`${APP_BASE}/`) ? pathname.slice(APP_BASE.length) : pathname;
}

function shouldInjectAnalytics(pathname: string): boolean {
  const path = appPath(pathname);
  return !path.startsWith('/api/') && !path.startsWith('/admin/');
}

export const onRequest = defineMiddleware(async (context, next) => {
  ensureEmailQueueStarted();
  ensureAsyncOrderQueueStarted();

  const { url } = context;
  const noIndex = isNoIndexHost(url.hostname);
  const path = appPath(url.pathname);

  if (path === '/robots.txt') {
    const disallow = [
      `${APP_BASE}/admin/`,
      `${APP_BASE}/api/`,
      `${APP_BASE}/ucet/`,
      `${APP_BASE}/kosik`,
      `${APP_BASE}/pokladna`,
    ];
    const body = [
      'User-agent: *',
      `Allow: ${APP_BASE}/`,
      ...disallow.map((value) => `Disallow: ${value}`),
      ...(noIndex ? [] : ['Disallow: /*?*', `Sitemap: ${url.origin}${APP_BASE}/sitemap.xml`]),
      '',
    ].join('\n');

    const response = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
    if (noIndex) response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    return response;
  }

  const response = await next();
  const headers = new Headers(response.headers);

  if (noIndex) headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');

  const location = headers.get('location');
  if (location?.startsWith('/') && !location.startsWith(`${APP_BASE}/`) && location !== APP_BASE) {
    headers.set('location', `${APP_BASE}${location}`);
  }

  const contentType = headers.get('content-type') || '';
  if (!contentType.includes('text/html') || !shouldInjectAnalytics(url.pathname)) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const html = await response.text();
  const withAnalytics = html.includes(`${APP_BASE}/tm-analytics.js`)
    ? html
    : html.replace('</body>', `${ANALYTICS_TAG}\n</body>`);

  headers.delete('content-length');
  return new Response(withAnalytics, { status: response.status, statusText: response.statusText, headers });
});
