import type { APIRoute } from 'astro';
import { runEmailDiagnostics, sendDiagnosticEmail } from '../../lib/email-diagnostics';
import { constantTimeEqual, getAdminAccessKey } from '../../lib/admin-access';

export const prerender = false;

function authorized(request: Request, url: URL, locals: any): boolean {
  const expected = getAdminAccessKey(locals);
  if (!expected) return ['localhost', '127.0.0.1'].includes(url.hostname);
  const supplied = url.searchParams.get('key') || request.headers.get('x-admin-key') || '';
  return constantTimeEqual(expected, supplied);
}

export const GET: APIRoute = async ({ request, url, locals }) => {
  if (!authorized(request, url, locals)) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const verifySmtp = url.searchParams.get('verify') === '1';
  return Response.json(await runEmailDiagnostics({ verifySmtp }), { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!authorized(request, url, locals)) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const result = await sendDiagnosticEmail(String(body?.to || '').trim());
    return Response.json({ ok: true, result });
  } catch (error: any) {
    console.error('[TM SMTP diagnostics]', error?.message || error);
    return Response.json({ ok: false, error: error?.message || String(error), code: error?.code || '', response: error?.response || '' }, { status: 500 });
  }
};
