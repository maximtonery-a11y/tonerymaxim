// Separate process on the same persistent volume as the store. No ad account writes.
import { stat, readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TM_DATA_ROOT } from "../src/lib/secure-persistence.ts";
import { TM_PRODUCT_CACHE_ROOT } from "../src/lib/runtime-paths.ts";
import { readAnalyticsEvents } from "../src/lib/tm-analytics.ts";
import { siteDemand, demandOffers, changedOffers, type OfferState } from "../src/lib/ads-site-demand.ts";
import type { CatalogProduct } from "../src/lib/catalog-query.ts";

const cataloguePath = join(TM_PRODUCT_CACHE_ROOT, "products.json");
const logPath = join(TM_DATA_ROOT, "analytics", "events.jsonl");
const directory = join(TM_DATA_ROOT, "ads-intelligence");
const resultPath = join(directory, "site-demand.json");
let catalog: CatalogProduct[] = [];
let catalogVersion = "";
let generatedAt = "";
let lastSignature = "";
let lastRun = 0;
const baselinePath = join(directory, "offer-baseline.json");
let baseline: { offers: Record<string, OfferState>; changes: ReturnType<typeof changedOffers> } | null = null;
try {
  const stored = JSON.parse(await readFile(baselinePath, "utf8"));
  if (stored.offers && Array.isArray(stored.changes)) baseline = stored;
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
let running = true;
process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });
await mkdir(directory, { recursive: true });
async function persist(value: object, target = resultPath) {
  const temporary = target + "." + process.pid + ".tmp";
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, target);
}
async function update() {
  const p = await stat(cataloguePath);
  const l = await stat(logPath).catch(() => null);
  const version = [p.ino, p.size, p.mtimeMs].join("/");
  const signature = [version, l?.ino, l?.size, l?.mtimeMs].join("/");
  const now = Date.now();
  if (lastSignature === signature && now-lastRun < 60_000) return;
  if (version !== catalogVersion) {
    const source = JSON.parse(await readFile(cataloguePath, "utf8"));
    if (!Array.isArray(source.products) || !source.products.length || !Number.isFinite(Date.parse(source.generated_at))) throw Error("catalogue unavailable");
    const offers = demandOffers(source.products);
    const fresh = baseline ? changedOffers(baseline.offers, offers, new Date(now).toISOString()) : [];
    const changes = [...(baseline?.changes || []).filter(x => Date.parse(x.at) > now-3_600_000), ...fresh];
    const next = { offers, changes };
    await persist(next, baselinePath);
    baseline = next; catalog = source.products; generatedAt = source.generated_at; catalogVersion = version;
  }
  const events = l ? await readAnalyticsEvents() : [];
  const observed = l && (l.size === 0 || events.length > 0);
  const rows = siteDemand(catalog, events, now);
  await persist({ status: observed ? "observed" : "partial", observed_at: new Date(now).toISOString(), catalogue_at: generatedAt,
    interval_minutes: 60, scope: "consented_site_events_available_in_local_log", coverage: "bounded_log",
    catalogue_candidates: Object.keys(baseline!.offers).length, offer_changes: baseline!.changes.filter(x => Date.parse(x.at) > now-3_600_000), rows: observed ? rows : null });
  lastSignature = signature; lastRun = now;
}
do {
  try { await update(); }
  catch { lastSignature = ""; await persist({status:"unavailable", observed_at:new Date().toISOString(), rows:null}); }
  if (process.argv.includes("--once") || !running) break;
  await delay(5000);
} while (running);
