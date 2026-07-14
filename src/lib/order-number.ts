import { join } from 'node:path';
import { mkdir, rm, stat } from 'node:fs/promises';
import { readSignedJson, TM_DATA_ROOT, writeSignedJson } from './secure-persistence';

type OrderSequence = { value: number; updatedAt: string };

const FILE = join(TM_DATA_ROOT, 'order-sequence.json');
const LOCK_DIR = join(TM_DATA_ROOT, 'locks', 'order-sequence.lock');
const FIRST_ORDER_NUMBER = 300896;
const INITIAL_SEQUENCE_VALUE = FIRST_ORDER_NUMBER - 1;
const LOCK_STALE_MS = 30_000;
let sequenceLock: Promise<unknown> = Promise.resolve();

function normalizeSequence(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number)) return INITIAL_SEQUENCE_VALUE;
  if (number < INITIAL_SEQUENCE_VALUE) return INITIAL_SEQUENCE_VALUE;
  if (number > 999999) return 999999;
  return number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireFileLock(): Promise<() => Promise<void>> {
  await mkdir(join(TM_DATA_ROOT, 'locks'), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(LOCK_DIR, { mode: 0o700 });
      return async () => { await rm(LOCK_DIR, { recursive: true, force: true }); };
    } catch {
      const info = await stat(LOCK_DIR).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rm(LOCK_DIR, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      await sleep(20 + Math.floor(Math.random() * 30));
    }
  }
  throw new Error('Nepodarilo sa uzamknúť číselný rad objednávok.');
}

async function nextValue(): Promise<number> {
  const release = await acquireFileLock();
  try {
    const stored = await readSignedJson<OrderSequence>(FILE);
    const current = normalizeSequence(stored?.value);
    if (current >= 999999) throw new Error('Číselný rad TM objednávok dosiahol limit 999999.');
    const next = current + 1;
    await writeSignedJson(FILE, { value: next, updatedAt: new Date().toISOString() });
    return next;
  } finally {
    await release();
  }
}

export async function nextTmOrderNumber(): Promise<string> {
  const task = sequenceLock.then(nextValue, nextValue);
  sequenceLock = task.then(() => undefined, () => undefined);
  return String(await task);
}

export function tmVariableSymbol(orderNumber: unknown): string {
  const digits = String(orderNumber || '').replace(/\D/g, '').slice(-6);
  return digits || '';
}
