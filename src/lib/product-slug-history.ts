import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { TM_PRODUCT_CACHE_ROOT } from './runtime-paths.ts';
import { PRODUCT_SLUG_RECOVERY_SEED } from './product-slug-recovery-seed.ts';

const HISTORY_FILE = path.join(TM_PRODUCT_CACHE_ROOT, 'product-slug-history.json');

type History = Record<string, string>; // historical slug -> stable Woo product ID

function cleanSlug(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function readHistory(): Promise<History> {
  try {
    const parsed = JSON.parse(await readFile(HISTORY_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function rememberProductSlugChanges(previous: any[], next: any[]) {
  if (!Array.isArray(previous) || !Array.isArray(next) || !previous.length || !next.length) return 0;
  const nextById = new Map<string, any>();
  for (const product of next) {
    const id = String(product?.id || '').trim();
    if (id) nextById.set(id, product);
  }
  const history = await readHistory();
  let added = 0;
  for (const oldProduct of previous) {
    const id = String(oldProduct?.id || '').trim();
    const oldSlug = cleanSlug(oldProduct?.slug);
    const newSlug = cleanSlug(nextById.get(id)?.slug);
    if (!id || !oldSlug || !newSlug || oldSlug === newSlug) continue;
    if (!history[oldSlug]) { history[oldSlug] = id; added++; }
  }
  if (!added) return 0;
  await mkdir(TM_PRODUCT_CACHE_ROOT, { recursive: true });
  const tmp = `${HISTORY_FILE}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(history, null, 2), 'utf8');
  await rename(tmp, HISTORY_FILE);
  return added;
}

export async function productIdForHistoricalSlug(value: unknown): Promise<string | null> {
  const slug = cleanSlug(value);
  if (!slug) return null;
  const history = await readHistory();
  return history[slug] || PRODUCT_SLUG_RECOVERY_SEED[slug] || null;
}
