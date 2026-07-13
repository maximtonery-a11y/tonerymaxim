import type { APIRoute } from 'astro';
import { constantTimeEqual, getAdminAccessKey } from '../../lib/admin-access';
import { runProductionHealth } from '../../lib/production-health';

export const prerender = false;

function authorized(request: Request, url: URL, locals: any): boolean {
  const expected = getAdminAccessKey(locals);
  if (!expected) return ['localhost', '127.0.0.1'].includes(url.hostname);
  const supplied = url.searchParams.get('key') || request.headers.get('x-admin-key') || '';
  return constantTimeEqual(expected, supplied);
}

export const GET: APIRoute = async ({ request, url, locals }) => {
  if (!authorized(request, url, locals)) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const deep = url.searchParams.get('deep') === '1';
  try {
    return Response.json(await runProductionHealth({ deep }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[TM production health]', error?.message || error);
    return Response.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
  }
};
