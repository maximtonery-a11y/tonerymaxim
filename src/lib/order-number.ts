import { join } from 'node:path';
import { readSignedJson, TM_DATA_ROOT, writeSignedJson } from './secure-persistence';

type OrderSequence = {
  value: number;
  updatedAt: string;
};

const FILE = join(TM_DATA_ROOT, 'order-sequence.json');
const FIRST_ORDER_NUMBER = 300896;
const INITIAL_SEQUENCE_VALUE = FIRST_ORDER_NUMBER - 1;
let sequenceLock: Promise<unknown> = Promise.resolve();

function normalizeSequence(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number)) return INITIAL_SEQUENCE_VALUE;
  if (number < INITIAL_SEQUENCE_VALUE) return INITIAL_SEQUENCE_VALUE;
  if (number > 999999) return 999999;
  return number;
}

async function nextValue(): Promise<number> {
  const stored = await readSignedJson<OrderSequence>(FILE);
  const current = normalizeSequence(stored?.value);

  if (current >= 999999) {
    throw new Error('Číselný rad TM objednávok dosiahol limit 999999.');
  }

  const next = current + 1;

  // Číslo sa uloží ešte pred vytvorením Woo objednávky a pred odoslaním e-mailu.
  // Aj keď ďalší krok zlyhá, číslo sa už nikdy znovu nepoužije.
  await writeSignedJson(FILE, {
    value: next,
    updatedAt: new Date().toISOString(),
  });

  return next;
}

/**
 * Vygeneruje jedinečné 6-ciferné číslo objednávky a variabilný symbol.
 * Číselný rad začína hodnotou 300896.
 */
export async function nextTmOrderNumber(): Promise<string> {
  const task = sequenceLock.then(nextValue, nextValue);
  sequenceLock = task.then(() => undefined, () => undefined);
  const value = await task;
  return String(value);
}

export function tmVariableSymbol(orderNumber: unknown): string {
  const digits = String(orderNumber || '').replace(/\D/g, '').slice(-6);
  return digits || '';
}
