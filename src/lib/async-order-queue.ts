import { mkdir, readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createWooOrderFromCheckout, type CheckoutOrderSource } from "./gopay-order";
import { CheckoutProfiler } from "./checkout-profiler";

const QUEUE_ROOT = join(process.cwd(), ".tm-cache", "async-orders");
const PENDING_DIR = join(QUEUE_ROOT, "pending");
const PROCESSING_DIR = join(QUEUE_ROOT, "processing");
const DONE_DIR = join(QUEUE_ROOT, "done");
const FAILED_DIR = join(QUEUE_ROOT, "failed");
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 30_000;
const INITIAL_QUEUE_DELAY_MS = Math.max(0, Number(process.env.TM_ASYNC_WOO_INITIAL_DELAY_MS || 500));
const MAX_DONE_FILES = 500;

type AsyncOrderJob = {
  id: string;
  source: CheckoutOrderSource;
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  wooOrderId?: number;
  wooOrderNumber?: string;
};

let queueLoopRunning = false;
let queueScheduled = false;

function safeId(value: string) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 90);
}

function jobFile(dir: string, id: string) {
  return join(dir, `${safeId(id)}.json`);
}

async function ensureDirs() {
  await mkdir(PENDING_DIR, { recursive: true });
  await mkdir(PROCESSING_DIR, { recursive: true });
  await mkdir(DONE_DIR, { recursive: true });
  await mkdir(FAILED_DIR, { recursive: true });
}

async function readJob(filePath: string): Promise<AsyncOrderJob | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJob(dir: string, job: AsyncOrderJob) {
  await ensureDirs();
  job.updatedAt = new Date().toISOString();
  await writeFile(jobFile(dir, job.id), JSON.stringify(job, null, 2), "utf8");
}

async function removeOldDoneFiles() {
  try {
    const files = await readdir(DONE_DIR);
    if (files.length <= MAX_DONE_FILES) return;
    const withTimes = await Promise.all(files.map(async (file) => {
      const filePath = join(DONE_DIR, file);
      const info = await stat(filePath).catch(() => null);
      return { filePath, time: info?.mtimeMs || 0 };
    }));
    const oldFiles = withTimes.sort((a, b) => a.time - b.time).slice(0, Math.max(0, files.length - MAX_DONE_FILES));
    await Promise.all(oldFiles.map((item) => unlink(item.filePath).catch(() => null)));
  } catch {
    // noop
  }
}

async function processOneJob(file: string) {
  const pendingPath = join(PENDING_DIR, file);
  const job = await readJob(pendingPath);
  if (!job) return;

  const processingPath = jobFile(PROCESSING_DIR, job.id);
  try {
    job.status = "processing";
    job.attempts = Number(job.attempts || 0) + 1;
    job.updatedAt = new Date().toISOString();
    await writeJob(PROCESSING_DIR, job);
    await unlink(pendingPath).catch(() => null);

    const profiler = new CheckoutProfiler("async-woo-order", {
      asyncOrderId: job.id,
      orderNumber: job.source.orderNumber,
      attempt: job.attempts,
      paymentCode: job.source.paymentCode,
    });

    const result = await profiler.measure("woo-create-order-total", () => createWooOrderFromCheckout(job.source, { waitForEmail: true }));
    profiler.done({ asyncOrderId: job.id, orderId: result.orderId, orderNumber: result.orderNumber });

    job.status = "done";
    job.wooOrderId = result.orderId;
    job.wooOrderNumber = result.orderNumber;
    job.lastError = undefined;
    await writeJob(DONE_DIR, job);
    await unlink(processingPath).catch(() => null);
    await removeOldDoneFiles();
  } catch (error: any) {
    const message = error?.message || String(error || "Neznáma chyba pri vytváraní Woo objednávky.");
    console.error("[TM async order queue] Woo order failed:", job.id, message);
    job.lastError = message;
    job.status = job.attempts >= MAX_ATTEMPTS ? "failed" : "pending";

    if (job.status === "failed") {
      await writeJob(FAILED_DIR, job);
      await unlink(processingPath).catch(() => null);
    } else {
      await writeJob(PENDING_DIR, job);
      await unlink(processingPath).catch(() => null);
      scheduleAsyncOrderQueue(RETRY_DELAY_MS);
    }
  }
}

export async function enqueueAsyncWooOrder(source: CheckoutOrderSource) {
  await ensureDirs();
  const id = safeId(source.orderNumber || `TM-${Date.now()}`);
  const job: AsyncOrderJob = {
    id,
    source,
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJob(PENDING_DIR, job);
  scheduleAsyncOrderQueue(INITIAL_QUEUE_DELAY_MS);
  return { queued: true, queueId: id, orderNumber: source.orderNumber };
}

export function scheduleAsyncOrderQueue(delayMs = 0) {
  if (queueScheduled || queueLoopRunning) return;
  queueScheduled = true;
  setTimeout(() => {
    queueScheduled = false;
    void processAsyncOrderQueue();
  }, Math.max(0, delayMs));
}

export async function processAsyncOrderQueue() {
  if (queueLoopRunning) return;
  queueLoopRunning = true;
  try {
    await ensureDirs();
    const files = (await readdir(PENDING_DIR)).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      await processOneJob(file);
    }
  } finally {
    queueLoopRunning = false;
  }
}

export async function getAsyncOrderQueueStats() {
  await ensureDirs();
  const count = async (dir: string) => (await readdir(dir).catch(() => [])).filter((file) => file.endsWith(".json")).length;
  return {
    pending: await count(PENDING_DIR),
    processing: await count(PROCESSING_DIR),
    done: await count(DONE_DIR),
    failed: await count(FAILED_DIR),
  };
}
