import type { APIRoute } from 'astro';

const PRODUCTION_HOSTS = new Set(['tonerymaxim.sk', 'www.tonerymaxim.sk']);

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const production = PRODUCTION_HOSTS.has(url.hostname.toLowerCase());
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /ucet/',
    'Disallow: /kosik',
    'Disallow: /pokladna',
    'Disallow: /platba-dokoncena',
    ...(production ? ['', 'Sitemap: https://www.tonerymaxim.sk/sitemap.xml'] : []),
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
