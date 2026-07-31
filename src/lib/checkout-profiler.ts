import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TM_CACHE_ROOT } from './runtime-paths';

export type CheckoutProfileEntry = {
  step: string;
  ms: number;
};

export type CheckoutProfileRecord = {
  id: string;
  ts: string;
  name: string;
  ok: boolean;
  totalMs: number;
  steps: CheckoutProfileEntry[];
  slowest: CheckoutProfileEntry[];
  context: Record<string, unknown>;
  extra: Record<string, unknown>;
  error?: string;
};

const MAX_RECORDS = 200;
const PROFILE_FILE = join(TM_CACHE_ROOT, 'checkout-profiler.json');

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function isEnabled() {
  const value = String(process.env.CHECKOUT_PROFILER || import.meta.env.CHECKOUT_PROFILER || '1').toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJson(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
}

async function readRecords(): Promise<CheckoutProfileRecord[]> {
  try {
    const raw = await readFile(PROFILE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveRecord(record: CheckoutProfileRecord) {
  try {
    await mkdir(dirname(PROFILE_FILE), { recursive: true });
    const records = await readRecords();
    records.unshift(record);
    await writeFile(PROFILE_FILE, JSON.stringify(records.slice(0, MAX_RECORDS), null, 2), 'utf8');
  } catch (error) {
    console.error('[TM checkout profiler] save failed', error instanceof Error ? error.message : String(error));
  }
}

export async function readCheckoutProfiles(limit = 100): Promise<CheckoutProfileRecord[]> {
  const records = await readRecords();
  return records.slice(0, Math.max(1, Math.min(limit, MAX_RECORDS)));
}

export function summarizeCheckoutProfiles(records: CheckoutProfileRecord[]) {
  const completed = records.filter((record) => record.ok);
  const failed = records.filter((record) => !record.ok);
  const totals = completed.map((record) => record.totalMs).sort((a, b) => a - b);
  const avg = totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : 0;
  const p95 = totals.length ? totals[Math.max(0, Math.ceil(totals.length * 0.95) - 1)] : 0;

  const stepTotals = new Map<string, { count: number; total: number; max: number }>();
  for (const record of records) {
    for (const step of record.steps || []) {
      const current = stepTotals.get(step.step) || { count: 0, total: 0, max: 0 };
      current.count += 1;
      current.total += step.ms;
      current.max = Math.max(current.max, step.ms);
      stepTotals.set(step.step, current);
    }
  }

  const slowSteps = Array.from(stepTotals.entries())
    .map(([step, data]) => ({
      step,
      count: data.count,
      avgMs: Math.round(data.total / Math.max(1, data.count)),
      maxMs: data.max,
      totalMs: data.total,
    }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 12);

  return {
    total: records.length,
    completed: completed.length,
    failed: failed.length,
    avgMs: avg,
    p95Ms: p95,
    slowSteps,
    recent: records.slice(0, 50),
  };
}

export class CheckoutProfiler {
  private readonly id = createId();
  private readonly started = nowMs();
  private last = this.started;
  private readonly steps: CheckoutProfileEntry[] = [];
  private readonly enabled = isEnabled();
  private finished = false;

  constructor(private readonly name: string, private readonly context: Record<string, unknown> = {}) {}

  mark(step: string) {
    if (!this.enabled || this.finished) return;
    const current = nowMs();
    this.steps.push({ step, ms: Math.round(current - this.last) });
    this.last = current;
  }

  async measure<T>(step: string, task: () => Promise<T>): Promise<T> {
    const stepStart = nowMs();
    try {
      return await task();
    } finally {
      if (this.enabled && !this.finished) {
        this.steps.push({ step, ms: Math.round(nowMs() - stepStart) });
        this.last = nowMs();
      }
    }
  }

  done(extra: Record<string, unknown> = {}) {
    if (!this.enabled || this.finished) return;
    this.finished = true;
    const totalMs = Math.round(nowMs() - this.started);
    const slowest = [...this.steps].sort((a, b) => b.ms - a.ms).slice(0, 5);
    const record: CheckoutProfileRecord = {
      id: this.id,
      ts: new Date().toISOString(),
      name: this.name,
      ok: true,
      totalMs,
      steps: this.steps,
      slowest,
      context: safeJson(this.context),
      extra: safeJson(extra),
    };

    console.log('[TM checkout profiler]', this.name, { totalMs, slowest, ...record.extra });
    void saveRecord(record);
  }

  fail(error: unknown, extra: Record<string, unknown> = {}) {
    if (!this.enabled || this.finished) return;
    this.finished = true;
    const totalMs = Math.round(nowMs() - this.started);
    const slowest = [...this.steps].sort((a, b) => b.ms - a.ms).slice(0, 5);
    const record: CheckoutProfileRecord = {
      id: this.id,
      ts: new Date().toISOString(),
      name: this.name,
      ok: false,
      totalMs,
      steps: this.steps,
      slowest,
      context: safeJson(this.context),
      extra: safeJson(extra),
      error: error instanceof Error ? error.message : String(error),
    };

    console.error('[TM checkout profiler] FAILED', this.name, { totalMs, slowest, error: record.error, ...record.extra });
    void saveRecord(record);
  }
}
