import { createHash } from 'node:crypto';
import { getWooAuthHeader, getWooBaseUrl } from './woo-client';

export const INVOICE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type CustomerInvoice = {
  id: string; order_id: number; order_number: string; number: string; date: string;
  type: 'invoice' | 'credit_note'; pdf: true; xml: boolean;
};
export class InvoiceError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
const positiveId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const plain = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const unavailable = () => new InvoiceError('Faktúry momentálne nie sú dostupné. Skúste to o chvíľu.');
export const invoiceHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
};
export function invoiceJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...invoiceHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
}
export function invoicePageNumber(value: unknown): number {
  const page = value == null || value === '' ? 1 : Number(value);
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new InvoiceError('Neplatná stránka.', 400);
  return page;
}
export function invoiceOrderFilter(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (!positiveId(value)) throw new InvoiceError('Neplatná objednávka.', 400);
  return Number(value);
}

async function request(endpoint: string, query: Record<string, string | number>, limit: number): Promise<any> {
  const url = new URL(getWooBaseUrl() + '/wp-json/tonerymaxim/v1/invoices' + endpoint);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  try {
    const response = await fetch(url, {
      method: 'GET', headers: { Authorization: getWooAuthHeader(), Accept: 'application/json' },
      cache: 'no-store', signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 404 && endpoint) throw new InvoiceError('Dokument nebol nájdený.', 404);
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) throw unavailable();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); throw unavailable(); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data?.ok !== true) throw unavailable();
    return data;
  } catch (error) {
    if (error instanceof InvoiceError) throw error;
    throw unavailable();
  }
}

export async function getCustomerInvoices(customerId: number, page = 1, orderId?: number): Promise<{ documents: CustomerInvoice[]; page: number; hasMore: boolean }> {
  if (!positiveId(customerId)) throw new InvoiceError('Neprihlásený zákazník.', 401);
  const query: Record<string, number> = { customer_id: customerId, page: invoicePageNumber(page) };
  if (orderId !== undefined) query.order_id = invoiceOrderFilter(orderId)!;
  const data = await request('', query, 131072);
  if (!Array.isArray(data.documents) || data.documents.length > 20 || Number(data.page) !== page || typeof data.has_more !== 'boolean') throw unavailable();
  const documents = data.documents.map((item: any): CustomerInvoice => {
    const number = plain(item?.number), date = plain(item?.date), orderNumber = plain(item?.order_number);
    const timestamp = Date.parse(date + 'T12:00:00Z');
    if (!INVOICE_ID.test(plain(item?.id)) || Number(item?.customer_id) !== customerId || !positiveId(item?.order_id)
      || (orderId !== undefined && Number(item.order_id) !== orderId) || !number || number.length > 100
      || !orderNumber || orderNumber.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date
      || !['invoice', 'credit_note'].includes(item?.type) || item?.pdf !== true || typeof item?.xml !== 'boolean') throw unavailable();
    return { id: item.id, order_id: Number(item.order_id), order_number: orderNumber, number, date,
      type: item.type, pdf: true, xml: item.xml };
  });
  return { documents, page, hasMore: data.has_more };
}

export async function downloadCustomerInvoice(customerId: number, id: string, format: string): Promise<Response> {
  if (!positiveId(customerId)) throw new InvoiceError('Neprihlásený zákazník.', 401);
  if (!INVOICE_ID.test(id) || !['pdf', 'xml'].includes(format)) throw new InvoiceError('Dokument nebol nájdený.', 404);
  const data = await request('/' + id + '/file', { customer_id: customerId, format }, 12 * 1024 * 1024);
  const file = data.file;
  const maximum = format === 'pdf' ? 8388608 : 2097152;
  const mime = format === 'pdf' ? 'application/pdf' : 'application/xml';
  if (data.document_id !== id || Number(data.customer_id) !== customerId || !file || file.mime !== mime
    || !positiveId(file.size) || Number(file.size) > maximum || !/^[a-f0-9]{64}$/.test(file.sha256)
    || typeof file.content_base64 !== 'string' || file.content_base64.length % 4 !== 0
    || file.content_base64.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.content_base64)
    || typeof file.filename !== 'string' || !/^[\p{L}\p{N}_.-]{1,180}\.(?:pdf|xml)$/u.test(file.filename)
    || !file.filename.endsWith('.' + format)) throw unavailable();
  const bytes = Buffer.from(file.content_base64, 'base64');
  if (bytes.length !== Number(file.size) || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw unavailable();
  const filename = file.filename.replace(/[^A-Za-z0-9_.-]/g, '_');
  return new Response(new Uint8Array(bytes), { status: 200, headers: {
    ...invoiceHeaders, 'Content-Type': mime, 'Content-Length': String(bytes.length),
    'Content-Disposition': 'attachment; filename="' + filename + '"; filename*=UTF-8\'\'' + encodeURIComponent(file.filename),
    'Content-Security-Policy': "sandbox; default-src 'none'",
  } });
}
