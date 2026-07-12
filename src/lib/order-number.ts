import { join } from 'node:path';
import { readSignedJson, TM_DATA_ROOT, writeSignedJson } from './secure-persistence';

type OrderSequence = {
  value: number;
  updatedAt: string;
};

const FILE = join(TM_DATA_ROOT, 'order-sequence.json');
let sequenceLock: Promise<unknown> = Promise.resolve();

function normalizeSequence(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 100000 || number > 999999) return 100000;
  return number;
}

async function nextValue() {
  const stored = await readSignedJson<OrderSequence>(FILE);
  const current = normalizeSequence(stored?.value);
  const next = current >= 999999 ? 100000 : current + 1;
  await writeSignedJson(FILE, { value: next, updatedAt: new Date().toISOString() });
  return next;
}

/**
 * Vygeneruje najviac 6-ciferné číslo použiteľné aj ako variabilný symbol.
 * Vráti čisto číselné, najviac 6-ciferné číslo. Rovnaká hodnota sa používa
 * ako zákaznícke číslo objednávky aj variabilný symbol.
 */
export async function nextTmOrderNumber() {
  const task = sequenceLock.then(nextValue, nextValue);
  sequenceLock = task.then(() => undefined, () => undefined);
  const value = await task;
  return String(value);
}

export function tmVariableSymbol(orderNumber: unknown) {
  const digits = String(orderNumber || '').replace(/\D/g, '').slice(-6);
  return digits || '';
}
