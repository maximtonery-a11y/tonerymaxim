import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () => {
  const memory = process.memoryUsage();
  const rssMb = Math.round(memory.rss / 1024 / 1024);
  const heapMb = Math.round(memory.heapUsed / 1024 / 1024);
  const limitMb = Math.max(256, Number(process.env.TM_PROCESS_MEMORY_LIMIT_MB || 512));
  const ok = rssMb < Math.floor(limitMb * 0.9);
  return Response.json({
    ok,
    service: 'tonerymaxim-storefront',
    checks: {
      server: true,
      middlewareIsolated: true,
      adsInStorefront: false,
      analyticsInStorefront: false,
      rssMb,
      heapMb,
      memoryLimitMb: limitMb,
    },
    timestamp: new Date().toISOString(),
  }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
};
