// Small negative lookup cache: bounded entries, bounded keys, no timers.
export class BoundedMissCache {
  private readonly entries = new Map<string, number>();
  readonly maxEntries: number;
  readonly ttlMs: number;
  private readonly now: () => number;
  constructor(maxEntries = 512, ttlMs = 300_000, now: () => number = Date.now) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("Invalid negative cache limits");
    }
  }
  get size(): number { return this.entries.size; }
  has(key: string): boolean {
    const expires = this.entries.get(key);
    if (expires === undefined) return false;
    if (expires <= this.now()) { this.entries.delete(key); return false; }
    // LRU refresh does not extend TTL.
    this.entries.delete(key);
    this.entries.set(key, expires);
    return true;
  }
  add(key: string): void {
    if (key.length > 256) return;
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, this.now() + this.ttlMs);
  }
}
