import { join } from 'node:path';
import { TM_DATA_ROOT, readSignedJson, writeSignedJson } from './secure-persistence.ts';

export type MissingRegistrationRecord = {
  email: string;
  firstAttemptAt: string;
  lastAttemptAt: string;
  attempts: number;
  status: 'pending' | 'registered';
  registeredAt?: string;
};

type MissingRegistrationStore = { version: 1; records: MissingRegistrationRecord[] };

const STORE_FILE = join(TM_DATA_ROOT, 'account', 'missing-registrations.json');
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS = 5_000;
let writeQueue: Promise<void> = Promise.resolve();

function normalizedEmail(value: unknown): string {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function validDate(value: unknown): string {
  const text = String(value || '');
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : '';
}

function cleanRecord(value: any): MissingRegistrationRecord | null {
  const email = normalizedEmail(value?.email);
  const firstAttemptAt = validDate(value?.firstAttemptAt);
  const lastAttemptAt = validDate(value?.lastAttemptAt);
  if (!email || !firstAttemptAt || !lastAttemptAt) return null;
  const registeredAt = validDate(value?.registeredAt);
  return {
    email,
    firstAttemptAt,
    lastAttemptAt,
    attempts: Math.max(1, Math.min(10_000, Math.round(Number(value?.attempts) || 1))),
    status: value?.status === 'registered' ? 'registered' : 'pending',
    ...(registeredAt ? { registeredAt } : {}),
  };
}

function retained(records: MissingRegistrationRecord[], nowMs: number): MissingRegistrationRecord[] {
  return records
    .map(cleanRecord)
    .filter((record): record is MissingRegistrationRecord => Boolean(record))
    .filter((record) => nowMs - Date.parse(record.lastAttemptAt) <= RETENTION_MS)
    .sort((a, b) => Date.parse(b.lastAttemptAt) - Date.parse(a.lastAttemptAt))
    .slice(0, MAX_RECORDS);
}

async function readStore(nowMs = Date.now()): Promise<MissingRegistrationStore> {
  const stored = await readSignedJson<MissingRegistrationStore>(STORE_FILE);
  return { version: 1, records: retained(Array.isArray(stored?.records) ? stored.records : [], nowMs) };
}

function mutateStore(change: (records: MissingRegistrationRecord[], now: string) => void): Promise<void> {
  const operation = writeQueue.then(async () => {
    const now = new Date().toISOString();
    const store = await readStore(Date.parse(now));
    change(store.records, now);
    store.records = retained(store.records, Date.parse(now));
    await writeSignedJson(STORE_FILE, store);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function recordMissingRegistrationAttempt(value: unknown): Promise<void> {
  const email = normalizedEmail(value);
  if (!email) return;
  await mutateStore((records, now) => {
    const existing = records.find((record) => record.email === email);
    if (existing) {
      existing.lastAttemptAt = now;
      existing.attempts = Math.min(10_000, existing.attempts + 1);
      existing.status = 'pending';
      delete existing.registeredAt;
      return;
    }
    records.unshift({ email, firstAttemptAt: now, lastAttemptAt: now, attempts: 1, status: 'pending' });
  });
}

export async function markMissingRegistrationCompleted(value: unknown): Promise<void> {
  const email = normalizedEmail(value);
  if (!email) return;
  await mutateStore((records, now) => {
    const existing = records.find((record) => record.email === email);
    if (!existing) return;
    existing.status = 'registered';
    existing.registeredAt = now;
  });
}

export function summarizeMissingRegistrations(records: MissingRegistrationRecord[], nowMs = Date.now()) {
  const safe = retained(records, nowMs);
  const pending = safe.filter((record) => record.status === 'pending');
  return {
    abandoned: pending.filter((record) => nowMs - Date.parse(record.lastAttemptAt) >= ABANDONED_AFTER_MS),
    recent: pending.filter((record) => nowMs - Date.parse(record.lastAttemptAt) < ABANDONED_AFTER_MS),
    registered: safe.filter((record) => record.status === 'registered'),
  };
}

export async function readMissingRegistrationSummary(nowMs = Date.now()) {
  // Prázdna mutácia zároveň fyzicky odstráni záznamy staršie ako 30 dní.
  await mutateStore(() => undefined);
  const store = await readStore(nowMs);
  return summarizeMissingRegistrations(store.records, nowMs);
}
