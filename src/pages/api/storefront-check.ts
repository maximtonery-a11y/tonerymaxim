import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';

export const prerender = false;

async function numberFromFile(path: string): Promise<number | null> {
  try {
    const raw = (await readFile(path, 'utf8')).trim();
    if (!raw || raw === 'max') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async () => {
  const memory = process.memoryUsage();
  const rssBytes = memory.rss;
  const heapBytes = memory.heapUsed;
  // cgroup v2 (bezny Docker/Coolify). Ak nie je dostupny, endpoint stale funguje.
  const [cgroupCurrent, cgroupMax] = await Promise.all([
    numberFromFile('/sys/fs/cgroup/memory.current'),
    numberFromFile('/sys/fs/cgroup/memory.max'),
  ]);
  const configuredLimit = Math.max(256, Number(process.env.TM_PROCESS_MEMORY_LIMIT_MB || 512)) * 1024 * 1024;
  const effectiveLimit = cgroupMax && cgroupMax > 0 ? cgroupMax : configuredLimit;
  const effectiveCurrent = cgroupCurrent && cgroupCurrent > 0 ? cgroupCurrent : rssBytes;
  const usageRatio = effectiveLimit > 0 ? effectiveCurrent / effectiveLimit : 0;
  const ok = usageRatio < 0.9;
  const mb = (value: number | null) => value == null ? null : Math.round(value / 1024 / 1024);

  return Response.json({
    ok,
    service: 'tonerymaxim-storefront',
    checks: {
      server: true,
      middlewareIsolated: true,
      adsInStorefront: false,
      analyticsInStorefront: false,
      analyticsEndpointDisabled: true,
      rssMb: mb(rssBytes),
      heapMb: mb(heapBytes),
      cgroupCurrentMb: mb(cgroupCurrent),
      cgroupLimitMb: mb(cgroupMax),
      effectiveMemoryLimitMb: mb(effectiveLimit),
      memoryUsagePercent: Math.round(usageRatio * 1000) / 10,
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
    },
    timestamp: new Date().toISOString(),
  }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
};
