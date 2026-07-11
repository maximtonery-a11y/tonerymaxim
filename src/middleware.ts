import { defineMiddleware } from 'astro:middleware';
import { ensureEmailQueueStarted } from './lib/email-queue';

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
  const { url } = context;
  const noIndex = isNoIndexHost(url.hostname);

  if (url.pathname === '/robots.txt') {
    const body = noIndex ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /ucet/\nDisallow: /kosik\nDisallow: /pokladna\nDisallow: /*?*\nSitemap: ${url.origin}/sitemap.xml\n`;
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

  const contentType = headers.get('content-type') || '';
  if (!contentType.includes('text/html') || !shouldInjectAnalytics(url.pathname)) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const html = await response.text();
  const withAnalytics = html.includes('/tm-analytics.js')
    ? html
    : html.replace('</body>', `${ANALYTICS_TAG}\n</body>`);

  headers.delete('content-length');
  return new Response(withAnalytics, { status: response.status, statusText: response.statusText, headers });
});
