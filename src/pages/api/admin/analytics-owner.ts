import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';

export const prerender = false;

function env(name: string): string {
  return String(
    process.env[name] ??
      (import.meta.env as Record<string, string | undefined>)[name] ??
      '',
  ).trim();
}

function authorized(request: Request): boolean {
  const configured = env('TM_ANALYTICS_ADMIN_KEY') || env('ADMIN_API_SECRET');
  if (!configured) return false;
  const url = new URL(request.url);
  const supplied = url.searchParams.get('key') || request.headers.get('x-tm-admin-key') || '';
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function response(data: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
  });
  if (cookie) headers.set('set-cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

export const POST: APIRoute = async ({ request }) => {
  if (!authorized(request)) return response({ ok: false, error: 'Unauthorized' }, 401);

  let enabled = true;
  try {
    const body = await request.json();
    enabled = body?.enabled !== false;
  } catch {
    enabled = true;
  }

  const maxAge = enabled ? 60 * 60 * 24 * 365 * 10 : 0;
  const cookie = [
    `tm_analytics_owner=${enabled ? '1' : ''}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');

  return response({ ok: true, owner: enabled }, 200, cookie);
};
