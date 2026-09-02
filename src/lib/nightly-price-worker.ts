import { randomInt } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { syncProductsCache } from "./tm-products-cache.ts";
import { priceHistoryDirectory } from "./price-history.ts";

const WORKER_GLOBAL_KEY = Symbol.for("tm.nightly-price-worker.started");
const DEFAULT_TIME_ZONE = "Europe/Bratislava";
const RETRY_MS = 30 * 60 * 1000;
const LOCK_STALE_MS = 4 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

function env(name: string): string {
  const buildValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
  return String(process.env[name] || buildValue || "").trim();
}

function workerDirectory(): string {
  return priceHistoryDirectory();
}

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return values as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

function localDateKey(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const value = parts(date, timeZone);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = wanted;
  for (let index = 0; index < 3; index += 1) {
    const actual = parts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += wanted - represented;
  }
  return new Date(guess);
}

function nextLocalDay(value: ReturnType<typeof parts>) {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function nextNightlyPriceRun(now = new Date(), randomMinute = randomInt(180), timeZone = DEFAULT_TIME_ZONE, forceNextDay = false): Date {
  const current = parts(now, timeZone);
  const minuteOfDay = current.hour * 60 + current.minute;
  let date = { year: current.year, month: current.month, day: current.day };
  let targetMinute: number;
  if (forceNextDay) {
    date = nextLocalDay(current);
    targetMinute = 60 + Math.max(0, Math.min(179, randomMinute));
  } else if (minuteOfDay < 60) targetMinute = 60 + Math.max(0, Math.min(179, randomMinute));
  else if (minuteOfDay < 239) targetMinute = Math.min(239, minuteOfDay + 1 + Math.max(0, Math.min(29, randomMinute % 30)));
  else {
    date = nextLocalDay(current);
    targetMinute = 60 + Math.max(0, Math.min(179, randomMinute));
  }
  return localToUtc(date.year, date.month, date.day, Math.floor(targetMinute / 60), targetMinute % 60, timeZone);
}

async function acquireLock(): Promise<Awaited<ReturnType<typeof open>> | null> {
  await mkdir(workerDirectory(), { recursive: true });
  const lockFile = join(workerDirectory(), "nightly.lock");
  try {
    const info = await stat(lockFile);
    if (Date.now() - info.mtimeMs > LOCK_STALE_MS) await rm(lockFile, { force: true });
  } catch { /* zámok ešte neexistuje */ }
  try {
    return await open(lockFile, "wx");
  } catch {
    return null;
  }
}

async function alreadyCompletedToday(timeZone: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(workerDirectory(), "last-success.json"), "utf8"));
    return marker?.local_date === localDateKey(new Date(), timeZone);
  } catch {
    return false;
  }
}

async function markCompleted(timeZone: string): Promise<void> {
  const target = join(workerDirectory(), "last-success.json");
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ local_date: localDateKey(new Date(), timeZone), completed_at: new Date().toISOString() }), "utf8");
  await rename(temporary, target);
}

async function runNightlyPriceUpdate(timeZone: string): Promise<boolean> {
  if (await alreadyCompletedToday(timeZone)) return true;
  const handle = await acquireLock();
  if (!handle) return false;
  try {
    if (await alreadyCompletedToday(timeZone)) return true;
    const result = await syncProductsCache({ force: true });
    if (!result.refreshed || result.warning) throw new Error(result.warning || "Katalóg sa neobnovil.");
    await markCompleted(timeZone);
    console.log(`[TM price history] Nočná kontrola dokončená: ${result.cache.total} produktov.`);
    return true;
  } finally {
    await handle.close().catch(() => undefined);
    await rm(join(workerDirectory(), "nightly.lock"), { force: true }).catch(() => undefined);
  }
}

function scheduleNext(forceNextDay = false): void {
  const timeZone = env("TM_PRICE_HISTORY_TIME_ZONE") || DEFAULT_TIME_ZONE;
  const next = nextNightlyPriceRun(new Date(), randomInt(180), timeZone, forceNextDay);
  const delay = Math.max(1_000, next.getTime() - Date.now());
  timer = setTimeout(async () => {
    let completed = false;
    try {
      completed = await runNightlyPriceUpdate(timeZone);
      if (!completed && parts(new Date(), timeZone).hour < 4) {
        timer = setTimeout(() => scheduleNext(false), RETRY_MS);
        timer.unref?.();
        return;
      }
    } catch (error) {
      console.error("[TM price history]", (error as Error)?.message || error);
      if (parts(new Date(), timeZone).hour < 4) {
        timer = setTimeout(() => scheduleNext(false), RETRY_MS);
        timer.unref?.();
        return;
      }
    }
    scheduleNext(completed);
  }, delay);
  timer.unref?.();
}

export function ensureNightlyPriceWorkerStarted(): void {
  const state = globalThis as typeof globalThis & { [WORKER_GLOBAL_KEY]?: boolean };
  if (state[WORKER_GLOBAL_KEY] || env("TM_PRICE_HISTORY_ENABLED") === "0") return;
  state[WORKER_GLOBAL_KEY] = true;
  scheduleNext();
}
