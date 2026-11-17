import type { APIRoute } from 'astro';
import { readCustomerSession } from '../../../lib/auth-session';
import { AccountOrderError } from '../../../lib/account-orders';
import { prepareAccountReorder } from '../../../lib/account-reorder';

export const prerender = false;
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export const POST: APIRoute = async ({ cookies, request }) => {
  const session = readCustomerSession(cookies);
  if (!session) return json({ ok: false, error: 'Najprv sa prihláste do svojho účtu.' }, 401);
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, error: 'Neplatná požiadavka.' }, 400);
    const raw = await request.text();
    if (raw.length > 1_000) return json({ ok: false, error: 'Neplatná požiadavka.' }, 400);
    let body: any;
    try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'Neplatná požiadavka.' }, 400); }
    if (!body || !Number.isSafeInteger(body.orderId) || body.orderId <= 0) return json({ ok: false, error: 'Neplatná objednávka.' }, 400);
    const plan = await prepareAccountReorder(session.id, body.orderId);
    return json({ ok: true, plan });
  } catch (error) {
    return json({ ok: false, error: error instanceof AccountOrderError ? error.message : 'Objednávku momentálne nemožno zopakovať. Skúste to o chvíľu.' }, error instanceof AccountOrderError ? error.status : 503);
  }
};
