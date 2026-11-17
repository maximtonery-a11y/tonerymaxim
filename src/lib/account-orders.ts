import { getWooAuthHeader, getWooBaseUrl, type WooOrder } from './woo-client';
import { isLoyaltyCreditStatus, normalizeOrderStatus } from './order-statuses';

export type AccountOrder = Omit<WooOrder, 'line_items'> & {
  customer_id: number;
  total_tax?: string;
  date_paid?: string | null;
  refunds?: Array<{ id?: number; total?: string }>;
  tax_lines?: Array<{ rate_percent?: number }>;
  line_items?: Array<NonNullable<WooOrder['line_items']>[number] & {
    total_tax?: string;
    meta_data?: Array<{ key?: string; value?: unknown }>;
  }>;
};
export const ACCOUNT_ORDERS_PER_PAGE = 20;
export class AccountOrderError extends Error {
  constructor(message = 'Objednávky momentálne nie sú dostupné. Skúste to o chvíľu.', public status = 503) { super(message); }
}
const integer = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
export function accountOrderPage(value: unknown): number {
  if (value == null || value === '') return 1;
  if (!/^\d+$/.test(String(value)) || !integer(value) || Number(value) > 100_000) {
    throw new AccountOrderError('Neplatná stránka objednávok.', 400);
  }
  return Number(value);
}
function cents(value: unknown): number | null {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER / 100 ? Math.round(number * 100) : null;
}
export function accountOrderTotals(order: AccountOrder) {
  const gross = cents(order.total);
  const tax = cents(order.total_tax);
  const refunded = (order.refunds || []).reduce((sum, refund) => sum + (cents(String(refund.total ?? '').replace(/^-/, '')) || 0), 0);
  return {
    gross: gross == null ? null : gross / 100,
    tax: gross == null || tax == null || tax > gross ? null : tax / 100,
    net: gross == null || tax == null || tax > gross ? null : (gross - tax) / 100,
    refunded: gross == null ? 0 : Math.min(gross, refunded) / 100,
    afterRefund: gross == null ? null : Math.max(0, gross - refunded) / 100,
  };
}
export function countsAsCustomerPurchase(order: AccountOrder): boolean {
  const status = normalizeOrderStatus(order.status);
  if (['pending', 'on-hold', 'tm-await-pay', 'cancelled', 'failed', 'refunded', 'trash', 'checkout-draft', 'tm-returned'].includes(status)) return false;
  return isLoyaltyCreditStatus(status) || ['processing', 'tm-processing', 'tm-paid'].includes(status) || Boolean(order.date_paid);
}

// Account-only, GET-only transport: order creation and payment code is untouched.
async function readPage(customerId: number, page: number, perPage: number, summaryOnly = false, signal?: AbortSignal) {
  if (!integer(customerId)) throw new AccountOrderError('Neprihlásený zákazník.', 401);
  const url = new URL(getWooBaseUrl() + '/wp-json/wc/v3/orders');
  const fields = summaryOnly
    ? 'id,customer_id,status,date_paid,total,currency,refunds'
    : 'id,number,customer_id,status,date_created,date_paid,total,total_tax,currency,refunds,tax_lines,line_items';
  for (const [key, value] of Object.entries({ customer: customerId, page, per_page: perPage, orderby: 'date', order: 'desc', _fields: fields })) url.searchParams.set(key, String(value));
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers: { Authorization: getWooAuthHeader(), Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: signal || AbortSignal.timeout(20_000) });
  } catch { throw new AccountOrderError(); }
  if (response.status === 400 && page > 1) throw new AccountOrderError('Táto stránka objednávok neexistuje.', 404);
  if (!response.ok) throw new AccountOrderError();
  const count = Number(response.headers.get('x-wp-total'));
  const pages = Number(response.headers.get('x-wp-totalpages'));
  if (!response.headers.has('x-wp-total') || !response.headers.has('x-wp-totalpages') || !Number.isSafeInteger(count) || count < 0
    || !Number.isSafeInteger(pages) || pages < 0 || pages !== Math.ceil(count / perPage)) throw new AccountOrderError();
  const body = await response.text();
  if (body.length > 5_000_000) throw new AccountOrderError();
  let orders: AccountOrder[];
  try { orders = JSON.parse(body); } catch { throw new AccountOrderError(); }
  if (!Array.isArray(orders) || orders.length > perPage
    || orders.some(order => !order || !integer(order.id) || Number(order.customer_id) !== customerId)) throw new AccountOrderError();
  if (page > Math.max(1, pages)) throw new AccountOrderError('Táto stránka objednávok neexistuje.', 404);
  if (orders.length !== Math.min(perPage, Math.max(0, count - (page - 1) * perPage))) throw new AccountOrderError();
  return { orders, page, total: count, totalPages: pages, hasMore: page < pages };
}
export async function getAccountOrdersPage(customerId: number, page = 1) {
  return readPage(customerId, accountOrderPage(page), ACCOUNT_ORDERS_PER_PAGE);
}
type Overview = { count: number; spending: Array<{ currency: string; total: number }>; latestOrder: AccountOrder | null };
const overviews = new Map<number, { until: number; value: Overview }>();
const pending = new Map<number, Promise<Overview>>();
export async function getAccountOverview(customerId: number): Promise<Overview> {
  if (!integer(customerId)) throw new AccountOrderError('Neprihlásený zákazník.', 401);
  for (const [key, entry] of overviews) if (entry.until <= Date.now()) overviews.delete(key);
  const cached = overviews.get(customerId);
  if (cached) return cached.value;
  const running = pending.get(customerId);
  if (running) return running;
  if (pending.size >= 100) throw new AccountOrderError();
  const task = (async () => {
    const signal = AbortSignal.timeout(30_000);
    const [first, recent] = await Promise.all([readPage(customerId, 1, 100, true, signal), readPage(customerId, 1, 1, false, signal)]);
    if (recent.total !== first.total || recent.orders[0]?.id !== first.orders[0]?.id) throw new AccountOrderError();
    const seen = new Set<number>();
    const spending = new Map<string, number>();
    function collect(orders: AccountOrder[]) {
      for (const order of orders) {
        if (seen.has(order.id)) throw new AccountOrderError();
        seen.add(order.id);
        if (!countsAsCustomerPurchase(order)) continue;
        const amount = accountOrderTotals(order).afterRefund;
        if (amount == null || !/^[A-Z]{3}$/.test(String(order.currency || ''))) throw new AccountOrderError();
        spending.set(order.currency!, (spending.get(order.currency!) || 0) + Math.round(amount * 100));
      }
    }
    collect(first.orders);
    for (let page = 2; page <= first.totalPages; page++) {
      const next = await readPage(customerId, page, 100, true, signal);
      // A changing history must not be presented as a complete lifetime sum.
      if (next.total !== first.total || next.totalPages !== first.totalPages) throw new AccountOrderError();
      collect(next.orders);
    }
    if (seen.size !== first.total) throw new AccountOrderError();
    const latest = recent.orders[0];
    const value: Overview = { count: first.total, spending: [...spending].map(([currency, total]) => ({ currency, total: total / 100 })), latestOrder: latest ? {
      id: latest.id, customer_id: latest.customer_id, number: latest.number, status: latest.status, date_created: latest.date_created, total: latest.total, currency: latest.currency,
      line_items: latest.line_items?.slice(0, 5).map(item => ({ name: String(item.name || '').slice(0, 500), quantity: item.quantity, total: item.total, total_tax: item.total_tax })),
    } : null };
    while (overviews.size >= 200) overviews.delete(overviews.keys().next().value!);
    overviews.set(customerId, { until: Date.now() + 60_000, value });
    return value;
  })();
  pending.set(customerId, task);
  try { return await task; } finally { pending.delete(customerId); }
}
