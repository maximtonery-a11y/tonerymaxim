import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sendWooOrderStatusEmail, type WooOrderStatusEmailPayload } from './mail';
import { wooRequest } from './woo-client';

const STATE_PATH = resolve(process.cwd(), '.tm-cache', 'email-queue-state.json');
const POLL_INTERVAL_MS = Math.max(10_000, Number(process.env.TM_EMAIL_QUEUE_INTERVAL_MS || 15_000));
const START_DELAY_MS = Math.max(1_000, Number(process.env.TM_EMAIL_QUEUE_START_DELAY_MS || 4_000));
const ORDERS_PER_SCAN = Math.min(100, Math.max(20, Number(process.env.TM_EMAIL_QUEUE_ORDERS_PER_SCAN || 50)));
const OBSERVED_META = '_tm_email_queue_observed_status';
const SENT_META = '_tm_email_queue_last_sent_status';
const SENT_AT_META = '_tm_email_queue_last_sent_at';

const NOTIFIABLE_STATUSES = new Set([
  'pending',
  'on-hold',
  'processing',
  'completed',
  'cancelled',
  'refunded',
  'failed',
  'shipped',
  'expedovana',
]);

type WooMeta = { id?: number; key?: string; value?: unknown };
type WooOrder = {
  id: number;
  number?: string;
  status?: string;
  date_created?: string;
  date_modified?: string;
  total?: string;
  currency?: string;
  payment_method_title?: string;
  billing?: Record<string, any>;
  shipping?: Record<string, any>;
  line_items?: Array<{ name?: string; sku?: string; quantity?: number; total?: string }>;
  shipping_lines?: Array<{ method_title?: string; method_id?: string; total?: string }>;
  meta_data?: WooMeta[];
};

export type EmailQueueState = {
  startedAt: string;
  lastScanAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  scannedOrders: number;
  tonerymaximOrders: number;
  initializedOrders: number;
  sentEmails: number;
  failedEmails: number;
  running: boolean;
  intervalMs: number;
};

let state: EmailQueueState = {
  startedAt: new Date().toISOString(),
  scannedOrders: 0,
  tonerymaximOrders: 0,
  initializedOrders: 0,
  sentEmails: 0,
  failedEmails: 0,
  running: false,
  intervalMs: POLL_INTERVAL_MS,
};

let started = false;
let running = false;
let timer: NodeJS.Timeout | null = null;
let stateLock: Promise<void> = Promise.resolve();

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/^wc-/, '');
}

function metaValue(order: WooOrder, key: string): string {
  const item = (Array.isArray(order.meta_data) ? order.meta_data : []).find((entry) => entry?.key === key);
  return String(item?.value ?? '').trim();
}

function isToneryMaximOrder(order: WooOrder): boolean {
  const values = [
    metaValue(order, 'source'),
    metaValue(order, 'sales_channel'),
    metaValue(order, 'created_via'),
    metaValue(order, '_tm_source'),
    metaValue(order, 'tm_source'),
  ].map((value) => value.toLowerCase());

  return values.some((value) => value.includes('tonerymaxim'));
}

function trackingNumber(order: WooOrder): string {
  const keys = [
    'tracking_number',
    '_tracking_number',
    'gls_tracking_number',
    '_gls_tracking_number',
    'dpd_tracking_number',
    '_dpd_tracking_number',
  ];
  for (const key of keys) {
    const value = metaValue(order, key);
    if (value) return value;
  }
  return '';
}

function trackingUrl(order: WooOrder): string {
  const keys = ['tracking_url', '_tracking_url', 'gls_tracking_url', 'dpd_tracking_url'];
  for (const key of keys) {
    const value = metaValue(order, key);
    if (value) return value;
  }
  return '';
}

function toPayload(order: WooOrder, fromStatus: string, toStatus: string): WooOrderStatusEmailPayload {
  const shippingTitle = Array.isArray(order.shipping_lines)
    ? order.shipping_lines.map((line) => line?.method_title || line?.method_id || '').filter(Boolean).join(', ')
    : '';

  return {
    event_id: `queue-${order.id}-${toStatus}-${order.date_modified || Date.now()}`,
    order_id: order.id,
    order_number: String(order.number || order.id),
    from_status: fromStatus,
    to_status: toStatus,
    changed_at: order.date_modified || new Date().toISOString(),
    customer: {
      email: String(order.billing?.email || '').trim(),
      first_name: String(order.billing?.first_name || '').trim(),
      last_name: String(order.billing?.last_name || '').trim(),
    },
    payment_method_title: String(order.payment_method_title || ''),
    shipping_method: shippingTitle,
    total: order.total || '0',
    currency: order.currency || 'EUR',
    tracking_number: trackingNumber(order),
    tracking_url: trackingUrl(order),
    line_items: Array.isArray(order.line_items)
      ? order.line_items.map((item) => ({
          name: item.name || 'Produkt',
          sku: item.sku || '',
          quantity: Number(item.quantity || 0),
          total: item.total || '0',
        }))
      : [],
  };
}

async function persistState(): Promise<void> {
  const snapshot = { ...state, running };
  const task = stateLock.then(async () => {
    await mkdir(dirname(STATE_PATH), { recursive: true });
    const temp = `${STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8');
    await rename(temp, STATE_PATH);
  });
  stateLock = task.catch(() => undefined);
  await task;
}

async function updateOrderMarkers(orderId: number, values: Array<{ key: string; value: string }>): Promise<void> {
  await wooRequest(`/orders/${orderId}`, {
    method: 'PUT',
    body: { meta_data: values },
  });
}

async function processOrder(order: WooOrder): Promise<void> {
  if (!order?.id || !isToneryMaximOrder(order)) return;
  state.tonerymaximOrders += 1;

  const currentStatus = normalizeStatus(order.status);
  if (!currentStatus) return;

  const observedStatus = normalizeStatus(metaValue(order, OBSERVED_META));
  const lastSentStatus = normalizeStatus(metaValue(order, SENT_META));

  // Prvé nájdenie objednávky iba vytvorí východiskový stav. Tým sa neposielajú staré ani duplicitné e-maily.
  if (!observedStatus) {
    await updateOrderMarkers(order.id, [{ key: OBSERVED_META, value: currentStatus }]);
    state.initializedOrders += 1;
    return;
  }

  if (observedStatus === currentStatus) return;

  // Stav, pre ktorý nechceme zákaznícky e-mail, iba uložíme ako pozorovaný.
  if (!NOTIFIABLE_STATUSES.has(currentStatus)) {
    await updateOrderMarkers(order.id, [{ key: OBSERVED_META, value: currentStatus }]);
    return;
  }

  // Ochrana pred opakovaným odoslaním rovnakého stavu.
  if (lastSentStatus === currentStatus) {
    await updateOrderMarkers(order.id, [{ key: OBSERVED_META, value: currentStatus }]);
    return;
  }

  const payload = toPayload(order, observedStatus, currentStatus);
  await sendWooOrderStatusEmail(payload);

  await updateOrderMarkers(order.id, [
    { key: OBSERVED_META, value: currentStatus },
    { key: SENT_META, value: currentStatus },
    { key: SENT_AT_META, value: new Date().toISOString() },
  ]);
  state.sentEmails += 1;
  state.lastSuccessAt = new Date().toISOString();
  console.log('[TM Email Queue] status e-mail sent', {
    orderId: order.id,
    orderNumber: order.number,
    from: observedStatus,
    to: currentStatus,
  });
}

export async function runEmailQueueOnce(): Promise<EmailQueueState> {
  if (running) return { ...state, running: true };
  running = true;
  state.running = true;
  state.lastScanAt = new Date().toISOString();

  try {
    const orders = await wooRequest<WooOrder[]>('/orders', {
      query: {
        per_page: ORDERS_PER_SCAN,
        orderby: 'date',
        order: 'desc',
      },
    });

    state.scannedOrders += Array.isArray(orders) ? orders.length : 0;

    for (const order of Array.isArray(orders) ? orders : []) {
      try {
        await processOrder(order);
      } catch (error: any) {
        state.failedEmails += 1;
        state.lastErrorAt = new Date().toISOString();
        state.lastError = error?.message || String(error || 'Neznáma chyba e-mailovej fronty.');
        console.error('[TM Email Queue] order processing failed', order?.id, state.lastError);
      }
    }
  } catch (error: any) {
    state.lastErrorAt = new Date().toISOString();
    state.lastError = error?.message || String(error || 'Neznáma chyba e-mailovej fronty.');
    console.error('[TM Email Queue] scan failed', state.lastError);
  } finally {
    running = false;
    state.running = false;
    await persistState().catch(() => undefined);
  }

  return { ...state };
}

function scheduleNext(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await runEmailQueueOnce();
    scheduleNext(POLL_INTERVAL_MS);
  }, delayMs);
  timer.unref?.();
}

export function ensureEmailQueueStarted(): void {
  if (started) return;
  started = true;
  scheduleNext(START_DELAY_MS);
  console.log(`[TM Email Queue] started, interval ${POLL_INTERVAL_MS} ms`);
}

export async function readEmailQueueState(): Promise<EmailQueueState> {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    return { ...state, ...(parsed || {}), running };
  } catch {
    return { ...state, running };
  }
}
