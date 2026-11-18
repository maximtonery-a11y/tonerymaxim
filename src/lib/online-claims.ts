import { tmOrderNumber } from './order-display';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { TM_DATA_ROOT, readSignedJson, writeSignedJson } from './secure-persistence';
import { getWooAuthHeader, getWooBaseUrl, getToneryMaximWordPressHeaders, wooRequest } from './woo-client';
import { buildCustomerCareHtml, buildCustomerCareText, customerCareAdminEmail, sanitizeCustomerCarePayload } from './customer-care';
import { sendMail } from './mail';

type Contact = ReturnType<typeof sanitizeCustomerCarePayload>;
export type ClaimPayload = {
  claim_number: string; customer_id: number; customer_email: string;
  order_id: number; order_number: string; product_id: number;
  product_name: string; product_sku: string; reason: string; message: string; status: 'received';
};
export type StoredClaim = ClaimPayload & { id: string; wp_id: number; [key: string]: unknown };
type ClaimRecord = {
  caseNumber: string; fingerprint: string; createdAt: string; contact: Contact; payload: ClaimPayload;
  displayOrderNumber?: string; wooClaim?: StoredClaim; delivery: { customer: boolean; admin: boolean; attempts: number };
};
const DIRECTORY = join(TM_DATA_ROOT, 'online-claims');
const LOCKS = join(DIRECTORY, 'locks');
const CASE_PATTERN = /^R[A-F0-9]{24}$/;
const active = new Map<string, Promise<ClaimRecord>>();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown) => String(value ?? '').trim();
const email = (value: unknown) => text(value).toLowerCase();
const positiveId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const fileFor = (id: string) => join(DIRECTORY, `${id}.json`);

// WordPress IDs are already unique. Keep the submission hash for reconciliation
// and disk filenames; show a short reference only after Woo has assigned an ID.
export function displayClaimNumber(claim: any): string {
  const id = text(claim?.id || claim?.claim_number);
  if (!CASE_PATTERN.test(id)) return id;
  return positiveId(claim?.wp_id) ? `R-${Number(claim.wp_id)}` : '';
}

export class ClaimInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function claimsRequest(endpoint = '/reklamacie', options: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | number> } = {}): Promise<any> {
  const url = new URL(`${getWooBaseUrl()}/wp-json/tonerymaxim/v1${endpoint}`);
  for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, String(value));
  const method = options.method || 'GET';
  const response = await fetch(url, {
    method, headers: { Authorization: getWooAuthHeader(), Accept: 'application/json', 'Content-Type': 'application/json', ...getToneryMaximWordPressHeaders(method) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw new Error('Reklamačné API nepotvrdilo operáciu.');
  if (method === 'GET' && !Array.isArray(data.claims)) throw new Error('Neplatný zoznam reklamácií.');
  return data;
}

function verifiedClaim(value: any, payload: ClaimPayload): StoredClaim {
  const id = text(value?.id || value?.claim_number);
  if (!positiveId(value?.wp_id) || id !== payload.claim_number
    || Number(value?.customer_id) !== payload.customer_id || Number(value?.order_id) !== payload.order_id
    || Number(value?.product_id) !== payload.product_id || text(value?.order_number) !== payload.order_number
    || text(value?.product_sku) !== payload.product_sku
    || text(value?.product_name) !== payload.product_name || text(value?.reason) !== payload.reason
    || text(value?.message) !== payload.message) throw new Error('Uloženie reklamácie nebolo overené.');
  // Older plugin responses do not expose the email. If present, it must match.
  if (value.customer_email !== undefined && email(value.customer_email) !== payload.customer_email) throw new Error('Neplatný vlastník reklamácie.');
  return { ...value, id, wp_id: Number(value.wp_id) };
}

async function synchronize(record: ClaimRecord): Promise<void> {
  if (record.wooClaim) return;
  const query: Record<string, string | number> = { customer_email: record.payload.customer_email, claim_number: record.caseNumber };
  if (record.payload.customer_id) query.customer_id = record.payload.customer_id;
  // Reconcile by the stable case number before POST, including a lost POST response.
  const list = await claimsRequest('/reklamacie', { query });
  let candidate = list.claims.find((item: any) => text(item.id || item.claim_number) === record.caseNumber);
  if (!candidate) {
    const created = await claimsRequest('/reklamacie', { method: 'POST', body: record.payload });
    const confirmed = verifiedClaim(created.claim, record.payload);
    const readBack = await claimsRequest('/reklamacie', { query });
    candidate = readBack.claims.find((item: any) => text(item.id || item.claim_number) === record.caseNumber);
    if (Number(candidate?.wp_id) !== confirmed.wp_id) throw new Error('Reklamáciu sa nepodarilo spätne načítať.');
  }
  record.wooClaim = verifiedClaim(candidate, record.payload);
  await writeSignedJson(fileFor(record.caseNumber), record);
}

async function processRecord(record: ClaimRecord): Promise<ClaimRecord> {
  try { await synchronize(record); }
  catch { console.error('[TM claims] Woo confirmation pending', record.caseNumber); return record; }
  if (record.delivery.customer && record.delivery.admin) return record;
  // Older outbox records contain a plugin lookup reference that can be a Woo ID.
  if (record.displayOrderNumber === undefined) {
    const order = await wooRequest<any>(`/orders/${record.payload.order_id}`).catch(() => null);
    record.displayOrderNumber = Number(order?.id) === record.payload.order_id ? tmOrderNumber(order) : '';
  }
  const contact = { ...record.contact, orderNumber: record.displayOrderNumber || '—' };
  const caseNumber = displayClaimNumber(record.wooClaim);
  const submitted = new Intl.DateTimeFormat('sk-SK', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Bratislava' }).format(new Date(record.createdAt));
  const content = buildCustomerCareText('reklamacia', caseNumber, contact);
  const plain = `${content}\nDátum a čas prijatia podania: ${submitted}\n`;
  const html = buildCustomerCareHtml('reklamacia', caseNumber, contact);
  for (const recipient of ['customer', 'admin'] as const) {
    if (record.delivery[recipient]) continue;
    try {
      const result = await sendMail({
        to: recipient === 'customer' ? record.contact.email : customerCareAdminEmail(),
        subject: recipient === 'customer' ? `Reklamáciu ${caseNumber} sme prijali | ToneryMAXIM.sk` : `Nová reklamácia ${caseNumber} | ToneryMAXIM.sk`,
        text: plain, html: `${html}<pre style="white-space:pre-wrap">${escapeHtml(plain)}</pre>`,
        replyTo: recipient === 'admin' ? record.contact.email : customerCareAdminEmail(),
      });
      // A resolved SMTP call still needs to have accepted this sole recipient.
      const destination = recipient === 'customer' ? record.contact.email : customerCareAdminEmail();
      if (!Array.isArray(result.accepted) || !result.accepted.some((entry: any) => email(entry?.address || entry) === destination)) throw new Error('SMTP príjemcu neprijal.');
      record.delivery[recipient] = true;
      await writeSignedJson(fileFor(record.caseNumber), record);
    } catch { console.error('[TM claims] email delivery pending', record.caseNumber, recipient); }
  }
  record.delivery.attempts += 1;
  try { await writeSignedJson(fileFor(record.caseNumber), record); }
  catch { console.error('[TM claims] delivery checkpoint pending', record.caseNumber); }
  return record;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!);
}

async function locked(id: string, work: () => Promise<ClaimRecord>): Promise<ClaimRecord> {
  const running = active.get(id);
  if (running) return running;
  const task = (async () => {
    await mkdir(LOCKS, { recursive: true, mode: 0o700 });
    const lock = join(LOCKS, `${id}.lock`);
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const info = await stat(lock).catch(() => null);
      // A stale lease is only removed; the next attempt takes a fresh lock.
      if (info && Date.now() - info.mtimeMs > 10 * 60_000) await rm(lock, { recursive: true, force: true });
      const existing = await readSignedJson<ClaimRecord>(fileFor(id));
      if (existing) return existing;
      throw new ClaimInputError('Podanie sa práve spracováva. Zopakujte rovnaký pokus o chvíľu.', 503);
    }
    try { return await work(); }
    finally { await rm(lock, { recursive: true, force: true }); }
  })();
  active.set(id, task);
  try { return await task; } finally { active.delete(id); }
}

export function claimResult(record: ClaimRecord) {
  const wooSaved = Boolean(record.wooClaim);
  return {
    ok: true, caseNumber: record.wooClaim ? displayClaimNumber(record.wooClaim) : null, wooSaved,
    emailSent: record.delivery.customer, emailPending: !record.delivery.customer,
    adminEmailPending: !record.delivery.admin,
    claim: record.wooClaim || { ...record.payload, id: record.caseNumber, wp_id: null, created_at: record.createdAt, status_label: 'Prijatá – spracováva sa' },
  };
}

export async function submitOnlineClaim(scope: string, submissionId: unknown, contact: Contact, payload: Omit<ClaimPayload, 'claim_number'>, displayOrderNumber: string) {
  const key = text(submissionId);
  if (!key) throw new ClaimInputError('Formulár bol aktualizovaný. Obnovte stránku a odošlite reklamáciu znova.');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new ClaimInputError('Neplatný identifikátor podania. Obnovte formulár.');
  const id = `R${hash([scope, key]).slice(0, 24).toUpperCase()}`;
  const fingerprint = hash([scope, contact, payload]);
  const record = await locked(id, async () => {
    let stored = await readSignedJson<ClaimRecord>(fileFor(id));
    if (stored) {
      if (stored.fingerprint !== fingerprint) throw new ClaimInputError('Tento pokus už obsahuje iné údaje. Obnovte formulár pre nové podanie.', 409);
    } else {
      stored = { caseNumber: id, fingerprint, displayOrderNumber, createdAt: new Date().toISOString(), contact, payload: { ...payload, claim_number: id }, delivery: { customer: false, admin: false, attempts: 0 } };
      // The durable outbox exists BEFORE contacting Woo or SMTP.
      await writeSignedJson(fileFor(id), stored);
    }
    return processRecord(stored);
  });
  if (record.fingerprint !== fingerprint) throw new ClaimInputError('Tento pokus už obsahuje iné údaje. Obnovte formulár pre nové podanie.', 409);
  return claimResult(record);
}

export async function pendingCustomerClaims(customerId: number) {
  const records = await recordsOnDisk();
  return records.filter(record => record.payload.customer_id === customerId && !record.wooClaim).map(record => claimResult(record).claim);
}

async function recordsOnDisk(): Promise<ClaimRecord[]> {
  let names: string[];
  try { names = await readdir(DIRECTORY); } catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
  const records: ClaimRecord[] = [];
  for (const name of names) {
    const id = name.replace(/\.json$/, '');
    if (!name.endsWith('.json') || !CASE_PATTERN.test(id)) continue;
    const record = await readSignedJson<ClaimRecord>(fileFor(id));
    if (record?.caseNumber === id) records.push(record);
  }
  return records;
}

let scanning = false;
export async function retryOnlineClaims(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    for (const record of await recordsOnDisk()) {
      if (record.wooClaim && record.delivery.customer && record.delivery.admin) continue;
      try { await locked(record.caseNumber, async () => processRecord(await readSignedJson<ClaimRecord>(fileFor(record.caseNumber)) || record)); }
      catch { console.error('[TM claims] retry pending', record.caseNumber); }
    }
  } finally { scanning = false; }
}

function normalized(value: unknown): string { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
// Keep the wire reference stable for old plugin versions and pending claim retries.
// Outbound receipts use displayOrderNumber from the verified order.
export function claimOrderReference(order: any): string {
  for (const key of ['tm_order_number', 'gopay_order_number']) {
    const value = order.meta_data?.find((item: any) => item.key === key)?.value;
    if (text(value)) return text(value);
  }
  return text(order.number || order.id);
}

export function claimMessageWithContact(contact: Contact): string {
  return [contact.message, '', `Meno: ${contact.name}`, `E-mail: ${contact.email}`,
    contact.phone ? `Telefón: ${contact.phone}` : '', contact.iban ? `IBAN pre prípadné vrátenie peňazí: ${contact.iban}` : ''].filter((line, index) => line || index === 1).join('\n');
}

export async function resolvePublicClaim(contact: Contact) {
  const requestedNumber = normalized(contact.orderNumber);
  if (!requestedNumber) throw new ClaimInputError('Zadajte číslo objednávky.');
  let order: any;
  for (let page = 1; page <= 10; page++) {
    const orders = await wooRequest<any[]>('/orders', { query: { search: contact.email, per_page: 100, page, orderby: 'date', order: 'desc' } });
    if (!Array.isArray(orders)) throw new Error('Neplatná odpoveď objednávok.');
    order = orders.find(item => email(item.billing?.email) === contact.email && [tmOrderNumber(item), claimOrderReference(item), item.number, item.id].some(value => normalized(value) === requestedNumber));
    if (order || orders.length < 100) break;
  }
  if (!order) throw new ClaimInputError('Objednávku sa nepodarilo overiť podľa čísla a e-mailu. Skontrolujte údaje. Pri staršom nákupe nás kontaktujte na info@tonerymaxim.sk.');
  const requested = normalized(contact.product);
  const items: any[] = Array.isArray(order.line_items) ? order.line_items : [];
  let matches = items.filter(item => normalized(item.sku) === requested || normalized(item.name) === requested);
  if (!matches.length && requested.length >= 4) matches = items.filter(item => normalized(item.name).includes(requested));
  if (matches.length !== 1 || !positiveId(matches[0].product_id || matches[0].variation_id)) throw new ClaimInputError('Produkt uveďte presným názvom alebo SKU z objednávky.');
  const product = matches[0];
  const payload: Omit<ClaimPayload, 'claim_number'> = { customer_id: Number(order.customer_id || 0), customer_email: contact.email, order_id: Number(order.id), order_number: claimOrderReference(order), product_id: Number(product.product_id || product.variation_id), product_name: text(product.name), product_sku: text(product.sku), reason: contact.reason, message: claimMessageWithContact(contact), status: 'received' };
  return { payload, displayOrderNumber: tmOrderNumber(order) };
}
