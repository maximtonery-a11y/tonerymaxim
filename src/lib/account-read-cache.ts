// Private, short-lived display reads only. Never used to authorize or price a purchase.
type Entry = { value?: unknown; until: number; bytes: number; pending?: Promise<unknown> };
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 100;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024;
let bytes = 0;

function remove(key: string) {
  const entry = entries.get(key);
  if (entry) bytes -= entry.bytes;
  entries.delete(key);
}
function evictSettled(except?: string): boolean {
  for (const [key, entry] of entries) {
    if (key !== except && !entry.pending) { remove(key); return true; }
  }
  return false;
}
export function invalidateAccountReads(customerId?: number): void {
  const prefix = customerId == null ? '' : `${customerId}:`;
  for (const key of entries.keys()) if (key.startsWith(prefix)) remove(key);
}

export function readAccountDisplay<T>(customerId: number, resource: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) return Promise.reject(new Error('Invalid account identity'));
  const key = `${customerId}:${resource}`;
  const existing = entries.get(key);
  if (existing?.pending) return existing.pending as Promise<T>;
  if (existing && existing.until > Date.now()) return Promise.resolve(existing.value as T);
  if (existing) remove(key);
  for (const [id, entry] of entries) if (!entry.pending && entry.until <= Date.now()) remove(id);
  while (entries.size >= MAX_ENTRIES && evictSettled()) { /* bounded per-process memory */ }
  // Do not grow the pending map without a bound during slow upstream responses.
  if (entries.size >= MAX_ENTRIES) return load();
  const entry: Entry = { until: 0, bytes: 0 };
  entries.set(key, entry);
  const task = Promise.resolve().then(load).then(value => {
    // A write may have invalidated this read while its HTTP request was running.
    if (entries.get(key) === entry) {
      const size = Buffer.byteLength(JSON.stringify(value) || '');
      if (size > MAX_ENTRY_BYTES) remove(key);
      else {
        while (bytes + size > MAX_BYTES && evictSettled(key)) { /* evict old display data */ }
        if (bytes + size > MAX_BYTES) remove(key);
        else {
          entry.value = value;
          entry.bytes = size;
          entry.until = Date.now() + ttlMs;
          bytes += size;
        }
      }
    }
    return value;
  }).catch(error => {
    if (entries.get(key) === entry) remove(key);
    throw error;
  }).finally(() => { entry.pending = undefined; });
  entry.pending = task;
  return task;
}
