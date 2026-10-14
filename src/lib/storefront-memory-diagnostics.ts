// Deliberately no catalogue/worker imports, I/O, timers or retained product arrays.
type SizeRef = { readonly size: number };
type MemorySample = ReturnType<typeof process.memoryUsage>;
type SyncRun = {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'running' | 'refreshed' | 'unchanged' | 'retained-old' | 'failed';
  before: MemorySample;
  after?: MemorySample;
  observedPeak?: MemorySample;
  peakStage?: string;
  samples?: number;
};
type State = {
  misses?: WeakRef<SizeRef>;
  positive?: WeakRef<SizeRef>;
  sync?: SyncRun;
};
const root = globalThis as typeof globalThis & { __TM_MEMORY_DIAGNOSTICS_V1__?: State };
function state(): State { return root.__TM_MEMORY_DIAGNOSTICS_V1__ ||= {}; }
export function observePrinterCache(positive: SizeRef, misses?: SizeRef): void {
  const current = state();
  if (current.positive?.deref() !== positive) current.positive = new WeakRef(positive);
  if (misses && current.misses?.deref() !== misses) current.misses = new WeakRef(misses);
}
export function beginCatalogSync(): void {
  const before = process.memoryUsage();
  state().sync = { startedAt: new Date().toISOString(), status: 'running', before, observedPeak: { ...before }, peakStage: 'start', samples: 1 };
}
export function sampleCatalogSync(stage: 'woo-page' | 'enrichment' | 'publication' | 'finish'): void {
  const run = state().sync;
  if (!run || run.status !== 'running') return;
  const sample = process.memoryUsage();
  run.samples = (run.samples || 0) + 1;
  if (sample.rss > (run.observedPeak?.rss || 0)) {
    run.observedPeak = sample;
    run.peakStage = stage;
  }
}
export function finishCatalogSync(status: 'refreshed' | 'unchanged' | 'retained-old' | 'failed'): void {
  const run = state().sync;
  if (!run) return;
  sampleCatalogSync('finish');
  run.status = status;
  run.finishedAt = new Date().toISOString();
  run.durationMs = Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
  run.after = process.memoryUsage();
}
export function storefrontMemoryDiagnostics() {
  const globals = globalThis as typeof globalThis & {
    __TM_PRODUCTS_FILE_CACHE__?: { generated_at?: string; products?: unknown[] };
    __TM_PRODUCT_DETAILS_CACHE__?: SizeRef;
    __TM_PRODUCTS_API_RESULT_CACHE__?: Map<string, { bytes?: number; expiresAt?: number }>;
    __TM_AI_COMMERCE_SEARCH_CACHE__?: Map<string, { bytes?: number; expires?: number }>;
    __TM_PRINTERS_INDEX__?: SizeRef;
    __TM_PRODUCTS_SYNC_PROMISE__?: unknown;
  };
  const current = root.__TM_MEMORY_DIAGNOSTICS_V1__;
  return {
    revision: 'memory-v1',
    catalogGeneratedAt: globals.__TM_PRODUCTS_FILE_CACHE__?.generated_at ?? null,
    catalogProducts: globals.__TM_PRODUCTS_FILE_CACHE__?.products?.length ?? null,
    detailCacheEntries: globals.__TM_PRODUCT_DETAILS_CACHE__?.size ?? 0,
    productApiCacheEntries: globals.__TM_PRODUCTS_API_RESULT_CACHE__?.size ?? 0,
    productApiCacheBytes: [...(globals.__TM_PRODUCTS_API_RESULT_CACHE__?.values() || [])].reduce((sum, entry) => sum + (entry.bytes || 0), 0),
    productApiCacheByteLimit: 8 * 1024 * 1024,
    aiCommerceCacheEntries: globals.__TM_AI_COMMERCE_SEARCH_CACHE__?.size ?? 0,
    aiCommerceCacheJsonBytes: [...(globals.__TM_AI_COMMERCE_SEARCH_CACHE__?.values() || [])].reduce((sum, entry) => sum + (entry.bytes || 0), 0),
    aiCommerceCacheJsonByteLimit: 8 * 1024 * 1024,
    printerApiIndexEntries: globals.__TM_PRINTERS_INDEX__?.size ?? 0,
    // Last observed generation only; WeakRef must never keep a catalogue alive.
    printerPositiveEntries: current?.positive?.deref()?.size ?? null,
    printerNegativeEntries: current?.misses?.deref()?.size ?? null,
    printerNegativeLimit: 512,
    printerNegativeTtlSeconds: 300,
    syncRunning: Boolean(globals.__TM_PRODUCTS_SYNC_PROMISE__),
    // Bounded: only the latest attempt, no error text or customer information.
    lastSync: current?.sync ? structuredClone(current.sync) : null,
  };
}
