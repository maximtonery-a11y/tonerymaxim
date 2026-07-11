import { mkdir, unlink, readdir, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { readSignedJson, writeSignedJson, quarantineFile, TM_DATA_ROOT } from "./secure-persistence";
import { createWooOrderFromCheckout, type CheckoutOrderSource } from "./gopay-order";
import { CheckoutProfiler } from "./checkout-profiler";
import { sendOrderConfirmationEmail } from "./mail";
import { wooRequest } from "./woo-client";

const QUEUE_ROOT = join(TM_DATA_ROOT, "async-orders");
const LEGACY_QUEUE_ROOT = join(process.cwd(), ".tm-cache", "async-orders");
const STALE_PROCESSING_MS = Math.max(60_000, Number(process.env.TM_QUEUE_STALE_PROCESSING_MS || 10 * 60_000));
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
  emailSentAt?: string;
  emailAttempts?: number;
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

async function migrateLegacyQueue() {
  for (const name of ["pending", "processing", "done", "failed"]) {
    const legacyDir = join(LEGACY_QUEUE_ROOT, name);
    const targetDir = join(QUEUE_ROOT, name);
    const files = await readdir(legacyDir).catch(() => []);
    for (const file of files.filter((item) => item.endsWith(".json"))) {
      const legacyPath = join(legacyDir, file);
      try {
        const raw = JSON.parse(await (await import("node:fs/promises")).readFile(legacyPath, "utf8")) as AsyncOrderJob;
        if (raw?.id && raw?.source) {
          await writeSignedJson(join(targetDir, file), raw);
          await unlink(legacyPath).catch(() => null);
        }
      } catch { /* legacy file stays untouched */ }
    }
  }
}

async function recoverStaleProcessing() {
  const files = await readdir(PROCESSING_DIR).catch(() => []);
  const now = Date.now();
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const path = join(PROCESSING_DIR, file);
    const info = await stat(path).catch(() => null);
    if (info && now - info.mtimeMs > STALE_PROCESSING_MS) {
      await rename(path, join(PENDING_DIR, file)).catch(() => null);
    }
  }
}

async function ensureDirs() {
  await mkdir(PENDING_DIR, { recursive: true });
  await mkdir(PROCESSING_DIR, { recursive: true });
  await mkdir(DONE_DIR, { recursive: true });
  await mkdir(FAILED_DIR, { recursive: true });
  await migrateLegacyQueue();
}

async function readJob(filePath: string): Promise<AsyncOrderJob | null> {
  try {
    const job = await readSignedJson<AsyncOrderJob>(filePath);
    if (!job) await quarantineFile(filePath, "bad-signature");
    return job;
  } catch {
    return null;
  }
}

async function writeJob(dir: string, job: AsyncOrderJob) {
  await ensureDirs();
  job.updatedAt = new Date().toISOString();
  await writeSignedJson(jobFile(dir, job.id), job);
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
  const claimedPath = join(PROCESSING_DIR, file);
  await ensureDirs();
  try { await rename(pendingPath, claimedPath); } catch { return; }
  const job = await readJob(claimedPath);
  if (!job) return;

  const processingPath = claimedPath;
  try {
    job.status = "processing";
    job.attempts = Number(job.attempts || 0) + 1;
    job.updatedAt = new Date().toISOString();
    await writeJob(PROCESSING_DIR, job);

    const profiler = new CheckoutProfiler("async-woo-order", {
      asyncOrderId: job.id,
      orderNumber: job.source.orderNumber,
      attempt: job.attempts,
      paymentCode: job.source.paymentCode,
    });

    let orderId = Number(job.wooOrderId || 0);
    let orderNumber = String(job.wooOrderNumber || "");

    if (!orderId) {
      const result = await profiler.measure("woo-create-order-total", () => createWooOrderFromCheckout(job.source, {
        waitForEmail: false,
        sendConfirmationEmail: false,
      }));
      orderId = result.orderId;
      orderNumber = result.orderNumber;
      job.wooOrderId = result.orderId;
      job.wooOrderNumber = result.orderNumber;
      await writeJob(PROCESSING_DIR, job);
    }

    if (!job.emailSentAt) {
      const customerEmail = String(job.source.contact?.email || job.source.billing?.email || "").trim();
      if (customerEmail) {
        job.emailAttempts = Number(job.emailAttempts || 0) + 1;
        await profiler.measure("order-confirmation-email", () => sendOrderConfirmationEmail({
          to: customerEmail,
          orderNumber: orderNumber || String(orderId),
          source: job.source,
          paymentTitle: job.source.paymentLabel || "Platba",
          shippingTitle: job.source.shippingLabel || "Doprava",
        }));
        job.emailSentAt = new Date().toISOString();
        await wooRequest(`/orders/${orderId}`, { method: "PUT", body: { meta_data: [
          { key: "tm_confirmation_email_sent", value: "1" },
          { key: "tm_confirmation_email_sent_at", value: job.emailSentAt },
          { key: "tm_confirmation_email_recipient", value: customerEmail },
        ] } }).catch((error) => console.error("Woo email confirmation meta error:", error?.message || error));
        await writeJob(PROCESSING_DIR, job);
      }
    }

    profiler.done({ asyncOrderId: job.id, orderId, orderNumber, emailSentAt: job.emailSentAt || null });

    job.status = "done";
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
  const id = safeId(source.orderNumber || `TM-${String(Date.now()).slice(-6)}`);
  const job: AsyncOrderJob = {
    id,
    source,
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJob(PENDING_DIR, job);

  // Potvrdenie odošleme hneď po bezpečnom uložení do fronty. Zákazník tak
  // nečaká na pomalé Woo API. Pri chybe zostane emailSentAt prázdne a worker
  // odoslanie automaticky zopakuje bez vytvorenia duplicitnej objednávky.
  const customerEmail = String(source.contact?.email || source.billing?.email || "").trim();
  if (customerEmail) {
    try {
      job.emailAttempts = 1;
      await sendOrderConfirmationEmail({
        to: customerEmail,
        orderNumber: source.orderNumber,
        source,
        paymentTitle: source.paymentLabel || "Platba",
        shippingTitle: source.shippingLabel || "Doprava",
      });
      job.emailSentAt = new Date().toISOString();
      await writeJob(PENDING_DIR, job);
      console.log("[TM async order queue] immediate confirmation sent", { id, customerEmail });
    } catch (error: any) {
      job.lastError = `Potvrdenie objednávky: ${error?.message || String(error)}`;
      await writeJob(PENDING_DIR, job);
      console.error("[TM async order queue] immediate confirmation failed", id, job.lastError);
    }
  }

  scheduleAsyncOrderQueue(INITIAL_QUEUE_DELAY_MS);
  return { queued: true, queueId: id, orderNumber: source.orderNumber, emailSent: Boolean(job.emailSentAt) };
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
    await recoverStaleProcessing();
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
