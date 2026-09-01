import type { APIRoute } from 'astro';
import { readCustomerSession } from '../../lib/auth-session';
import { getWooCustomerOrders } from '../../lib/woo-client';
import { wooRequest } from '../../lib/woo-client';
import { publicOrderNumber, publicOrderStatus } from '../../lib/ai-order-status';

export const prerender = false;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store, private', 'X-Content-Type-Options':'nosniff' } });

export const GET: APIRoute = async ({ cookies }) => {
  const session = readCustomerSession(cookies);
  if (!session) return json({ ok:false, loggedIn:false, verificationRequired:true }, 401);
  const orders = await getWooCustomerOrders(session.id, 10);
  return json({ ok:true, loggedIn:true, orders:(orders || []).slice(0, 10).map(publicOrderStatus) });
};

const attempts = new Map<string, { count:number; reset:number }>();
const MAX_BUCKETS = 2000;
const genericFailure = 'Údaje sa nezhodujú. Skontrolujte číslo objednávky, e-mail a PSČ.';
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4096) return json({ ok:false, error:genericFailure }, 413);
  const key = clean(clientAddress || request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown', 100);
  const now = Date.now(); const current = attempts.get(key);
  if (!current || current.reset <= now) {
    for (const [bucket, value] of attempts) if (value.reset <= now) attempts.delete(bucket);
    while (attempts.size >= MAX_BUCKETS) { const oldest = attempts.keys().next().value; if (!oldest) break; attempts.delete(oldest); }
    attempts.set(key, { count:1, reset:now + 15 * 60_000 });
  } else if (++current.count > 5) return json({ ok:false, error:'Príliš veľa pokusov. Skúste to neskôr.' }, 429);

  const body = await request.json().catch(() => ({}));
  const orderNumber = clean(body?.orderNumber, 40).replace(/[^0-9]/g, '');
  const email = clean(body?.email, 160).toLowerCase();
  const postcode = clean(body?.postcode, 20).replace(/\s+/g, '').toLowerCase();
  if (!/^\d{4,12}$/.test(orderNumber) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || postcode.length < 3) return json({ ok:false, error:genericFailure }, 400);

  try {
    const seen = new Map<string, any>();
    const addCandidates = (rows: any) => {
      for (const item of Array.isArray(rows) ? rows : []) seen.set(String(item?.id || item?.number || seen.size), item);
    };
    const findOrder = () => [...seen.values()].find(item => publicOrderNumber(item) === orderNumber || String(item?.number || item?.id) === orderNumber);

    addCandidates(await wooRequest<any[]>('/orders', { query:{ search:orderNumber, per_page:100, orderby:'date', order:'desc' } }).catch(() => []));
    let order = findOrder();
    // Verejné TM číslo je uložené v meta údajoch objednávky a WooCommerce ho
    // pri všeobecnom `search` nemusí nájsť. E-mail výrazne zúži bezpečný druhý scan.
    if (!order) {
      addCandidates(await wooRequest<any[]>('/orders', { query:{ search:email, per_page:100, orderby:'date', order:'desc' } }).catch(() => []));
      order = findOrder();
    }
    // Posledná poistka pre staršie objednávky, pri ktorých Woo e-mail neindexuje.
    if (!order) {
      addCandidates(await wooRequest<any[]>('/orders', { query:{ per_page:100, orderby:'date', order:'desc' } }).catch(() => []));
      order = findOrder();
    }
    const orderEmail = String(order?.billing?.email || '').trim().toLowerCase();
    const orderPostcode = String(order?.billing?.postcode || order?.shipping?.postcode || '').replace(/\s+/g, '').toLowerCase();
    if (!order || orderEmail !== email || orderPostcode !== postcode) return json({ ok:false, error:genericFailure }, 404);
    return json({ ok:true, loggedIn:false, verified:true, order:publicOrderStatus(order) });
  } catch {
    return json({ ok:false, error:'Overenie objednávky je dočasne nedostupné. Skúste to neskôr.' }, 503);
  }
};
