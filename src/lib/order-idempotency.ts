import { join } from 'node:path';
import { mkdir, rm, stat } from 'node:fs/promises';
import { TM_DATA_ROOT, readSignedJson, writeSignedJson } from './secure-persistence';

export type OrderIdempotencyResult = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
  createdAt: string;
};

const ROOT = join(TM_DATA_ROOT, 'order-idempotency');
const LOCKS = join(ROOT, 'locks');
const RESULTS = join(ROOT, 'results');
const STALE_MS = 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function safe(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
}

export async function withOrderIdempotency<T extends OrderIdempotencyResult>(key: string, work: () => Promise<T>): Promise<T> {
  const id = safe(key);
  if (!id) return work();
  await mkdir(LOCKS, { recursive: true, mode: 0o700 });
  await mkdir(RESULTS, { recursive: true, mode: 0o700 });
  const resultFile = join(RESULTS, `${id}.json`);
  const existing = await readSignedJson<T>(resultFile);
  if (existing) return existing;
  const lockDir = join(LOCKS, id);
  let owned = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { await mkdir(lockDir, { mode: 0o700 }); owned = true; break; } catch {
      const cached = await readSignedJson<T>(resultFile);
      if (cached) return cached;
      const info = await stat(lockDir).catch(() => null);
      if (info && Date.now() - info.mtimeMs > STALE_MS) await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
      await sleep(25);
    }
  }
  if (!owned) throw new Error('Objednávka sa práve spracúva. Skúste to znova o chvíľu.');
  try {
    const cached = await readSignedJson<T>(resultFile);
    if (cached) return cached;
    const result = await work();
    await writeSignedJson(resultFile, result);
    return result;
  } finally {
    await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function getOrCreateOrderNumber(key: string, create: () => Promise<string>): Promise<string> {
  const result = await withOrderIdempotency(key, async () => ({
    ok: true,
    status: 200,
    payload: { orderNumber: await create() },
    createdAt: new Date().toISOString(),
  }));
  return String(result.payload.orderNumber || '');
}
