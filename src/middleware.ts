import { defineMiddleware } from 'astro:middleware';
import { ensureEmailQueueStarted } from './lib/email-queue';
import { ensureAsyncOrderQueueStarted } from './lib/async-order-queue';

const PRODUCTION_ORIGIN = 'https://www.tonerymaxim.sk';
const NOINDEX_HOSTS = new Set(['tonerymaxim.info', 'www.tonerymaxim.info']);
const ANALYTICS_TAG = '<script src="/tm-analytics.js" defer></script>';

function isNoIndexHost(hostname: string): boolean {
  return NOINDEX_HOSTS.has(hostname.toLowerCase());
}

function shouldInjectAnalytics(pathname: string): boolean {
  return !pathname.startsWith('/api/') && !pathname.startsWith('/admin/');
}

export const onRequest = defineMiddleware(async (context, next) => {
  ensureEmailQueueStarted();
  ensureAsyncOrderQueueStarted();

  const { url } = context;
  const noIndex = isNoIndexHost(url.hostname);

  if (url.pathname === '/robots.txt') {
    const body = noIndex
      ? [
          'User-agent: *',
          'Disallow: /',
          '',
        ].join('\n')
      : [
          'User-agent: *',
          'Allow: /',
          'Disallow: /admin/',
          'Disallow: /api/',
          'Disallow: /ucet/',
          'Disallow: /kosik',
          'Disallow: /pokladna',
          'Disallow: /*?*',
          `Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`,
          '',
        ].join('\n');

    const response = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });

    if (noIndex) {
      response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    }
    return response;
  }

  const response = await next();
  const headers = new Headers(response.headers);

  if (noIndex) {
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
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
