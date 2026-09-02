import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { portableStoragePath } from "./runtime-paths.ts";

type PriceEvent = { at: string; price: number };

type ProductPriceHistory = {
  id: string;
  sku: string;
  slug: string;
  tracked_at: string;
  current_price: number;
  current_sale: boolean;
  sale_started_at?: string;
  sale_reference_price?: number;
  events: PriceEvent[];
};

export type PriceHistoryFile = {
  version: 1;
  last_observed_at: string;
  products: Record<string, ProductPriceHistory>;
};

type Product = Record<string, any>;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_OBSERVATION_GAP_MS = 36 * 60 * 60 * 1000;
let writePromise: Promise<void> | null = null;

function env(name: string): string {
  const buildValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
  return String(process.env[name] || buildValue || "").trim();
}

export function priceHistoryDirectory(): string {
  const configured = portableStoragePath(env("TM_PERSISTENT_DATA_DIR"));
  const cacheRoot = portableStoragePath(env("TM_CACHE_DIR"));
  return resolve(configured ? join(configured, "price-history") : cacheRoot ? join(cacheRoot, "price-history") : join(process.cwd(), ".tm-data", "price-history"));
}

function historyFile(): string {
  return join(priceHistoryDirectory(), "prices.json");
}

function amount(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

function productKey(product: Product): string {
  const id = String(product?.id || "").trim();
  if (id) return `id:${id}`;
  const sku = String(product?.sku || "").trim();
  if (sku) return `sku:${sku}`;
  const slug = String(product?.slug || "").trim();
  return slug ? `slug:${slug}` : "";
}

function isWooSale(product: Product): boolean {
  const price = amount(product?.price);
  const regular = amount(product?.regular_price);
  const sale = amount(product?.sale_price);
  return price > 0 && regular > 0 && sale > 0 && sale < regular && Math.abs(price - sale) < 0.011;
}

function validHistory(value: unknown): value is PriceHistoryFile {
  const data = value as PriceHistoryFile;
  return Boolean(data && data.version === 1 && typeof data.last_observed_at === "string" && data.products && typeof data.products === "object");
}

function minimumBefore(events: PriceEvent[], atMs: number): number {
  const fromMs = atMs - THIRTY_DAYS_MS;
  let anchor: PriceEvent | undefined;
  const applicable: PriceEvent[] = [];
  for (const event of events) {
    const eventMs = new Date(event.at).getTime();
    if (!Number.isFinite(eventMs) || eventMs >= atMs) continue;
    if (eventMs < fromMs) anchor = event;
    else applicable.push(event);
  }
  if (anchor) applicable.unshift(anchor);
  const prices = applicable.map((event) => amount(event.price)).filter(Boolean);
  return prices.length ? Math.min(...prices) : 0;
}

function pruneEvents(events: PriceEvent[], nowMs: number): PriceEvent[] {
  const cutoff = nowMs - THIRTY_DAYS_MS;
  let anchor: PriceEvent | undefined;
  const recent: PriceEvent[] = [];
  for (const event of events) {
    const eventMs = new Date(event.at).getTime();
    if (!Number.isFinite(eventMs)) continue;
    if (eventMs < cutoff) anchor = event;
    else recent.push(event);
  }
  return anchor ? [anchor, ...recent] : recent;
}

export function evolvePriceHistory(previous: PriceHistoryFile | null, products: Product[], observedAt: Date): PriceHistoryFile {
  const observedMs = observedAt.getTime();
  if (!Number.isFinite(observedMs)) throw new Error("Neplatný čas kontroly cien.");
  const observedIso = observedAt.toISOString();
  const previousObservedMs = new Date(previous?.last_observed_at || "").getTime();
  const continuityLost = Boolean(previous && (!Number.isFinite(previousObservedMs) || observedMs - previousObservedMs > MAX_OBSERVATION_GAP_MS));
  const nextProducts: Record<string, ProductPriceHistory> = {};

  for (const product of products) {
    const key = productKey(product);
    const price = amount(product?.price);
    if (!key || !price) continue;
    const sale = isWooSale(product);
    const old = continuityLost ? undefined : previous?.products?.[key];
    let item: ProductPriceHistory;

    if (!old) {
      item = {
        id: String(product?.id || ""),
        sku: String(product?.sku || ""),
        slug: String(product?.slug || ""),
        tracked_at: observedIso,
        current_price: price,
        current_sale: sale,
        ...(sale ? { sale_started_at: observedIso } : {}),
        events: [{ at: observedIso, price }],
      };
    } else {
      const events = Array.isArray(old.events) ? old.events.slice() : [];
      if (!events.length || Math.abs(amount(old.current_price) - price) >= 0.011) events.push({ at: observedIso, price });
      item = {
        ...old,
        id: String(product?.id || old.id || ""),
        sku: String(product?.sku || old.sku || ""),
        slug: String(product?.slug || old.slug || ""),
        current_price: price,
        current_sale: sale,
        events: pruneEvents(events, observedMs),
      };

      if (sale && !old.current_sale) {
        const trackedMs = new Date(old.tracked_at).getTime();
        const complete = Number.isFinite(trackedMs) && trackedMs <= observedMs - THIRTY_DAYS_MS;
        const reference = complete ? minimumBefore(old.events || [], observedMs) : 0;
        item.sale_started_at = observedIso;
        if (reference > 0) item.sale_reference_price = reference;
        else delete item.sale_reference_price;
      } else if (!sale) {
        delete item.sale_started_at;
        delete item.sale_reference_price;
      }
    }

    nextProducts[key] = item;
  }

  return { version: 1, last_observed_at: observedIso, products: nextProducts };
}

export function annotateProductsWithPriceHistory(products: Product[], history: PriceHistoryFile): void {
  for (const product of products) {
    delete product.lowest_price_30d;
    delete product.lowest_price_30d_valid;
    delete product.price_reduction_started_at;
    const item = history.products[productKey(product)];
    const reference = amount(item?.sale_reference_price);
    if (!item?.current_sale || !isWooSale(product) || !reference) continue;
    product.lowest_price_30d = reference.toFixed(2);
    product.lowest_price_30d_valid = true;
    product.price_reduction_started_at = item.sale_started_at || "";
  }
}

async function readPriceHistory(): Promise<PriceHistoryFile | null> {
  try {
    const parsed = JSON.parse(await readFile(historyFile(), "utf8"));
    return validHistory(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function savePriceHistory(history: PriceHistoryFile): Promise<void> {
  const directory = priceHistoryDirectory();
  await mkdir(directory, { recursive: true });
  const temporary = `${historyFile()}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(history), "utf8");
  await rename(temporary, historyFile());
}

export async function recordAndAnnotatePrices(products: Product[], observedAt = new Date()): Promise<void> {
  while (writePromise) await writePromise;
  const operation = (async () => {
    const history = evolvePriceHistory(await readPriceHistory(), products, observedAt);
    await savePriceHistory(history);
    annotateProductsWithPriceHistory(products, history);
  })();
  writePromise = operation;
  try {
    await operation;
  } finally {
    if (writePromise === operation) writePromise = null;
  }
}
