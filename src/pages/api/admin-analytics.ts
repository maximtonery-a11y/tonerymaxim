import type { APIRoute } from 'astro';
import { analyticsForDate, bratislavaDate, readAnalyticsEvents } from '../../lib/tm-analytics';
import { constantTimeEqual, getAdminAccessKey } from '../../lib/admin-access';

export const prerender = false;

function allowed(url: URL, request: Request, locals: any): boolean {
  const expected = getAdminAccessKey(locals);
  const supplied = url.searchParams.get('key') || request.headers.get('x-admin-key') || '';
  return Boolean(expected && constantTimeEqual(expected, supplied));
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export const GET: APIRoute = async ({ url, request, locals }) => {
  if (!allowed(url, request, locals)) return json({ ok: false, error: 'Unauthorized' }, 401);
  const date = url.searchParams.get('date') || bratislavaDate(new Date().toISOString());
  const includeOwner = url.searchParams.get('includeOwner') !== '0';
  const events = await readAnalyticsEvents(120000);
  return json({ ok: true, ...analyticsForDate(events, date, includeOwner) });
};

export const POST: APIRoute = async ({ url, request, locals, cookies }) => {
  if (!allowed(url, request, locals)) return json({ ok: false, error: 'Unauthorized' }, 401);
  const data = await request.json().catch(() => ({}));
  if (data?.action === 'mark-owner') {
    cookies.set('tm_analytics_owner', '1', { path: '/', httpOnly: true, sameSite: 'lax', secure: import.meta.env.PROD, maxAge: 60 * 60 * 24 * 365 * 5 });
    return json({ ok: true, owner: true });
  }
  if (data?.action === 'unmark-owner') {
    cookies.delete('tm_analytics_owner', { path: '/' });
    return json({ ok: true, owner: false });
  }
  return json({ ok: false, error: 'Unknown action' }, 400);
};
