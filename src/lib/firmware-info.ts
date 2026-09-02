import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { portableStoragePath } from "./runtime-paths.ts";

export type FirmwareInfoEntry = {
  codes: string;
  status: string;
  kind: "toner" | "atrament" | "ine";
};

export type FirmwareInfoSnapshot = {
  source: "abix" | "initial";
  checkedAt: string;
  entries: FirmwareInfoEntry[];
};

const ABIX_ORIGIN = "https://www.abix.sk";
const LOGIN_URI = "api/login";
const ARTICLE_URI = "api/article/107/firmware-info";
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_START_DELAY_MS = 90_000;
const WORKER_GLOBAL_KEY = Symbol.for("tm.firmware-info-worker.started");
const INITIAL_SNAPSHOT: FirmwareInfoSnapshot = {
  source: "initial",
  checkedAt: "2026-09-02T07:00:00.000Z",
  entries: [
    { codes: "CF259", status: "Dostupná je verzia kazety s najnovším čipom.", kind: "toner" },
    { codes: "HP415", status: "Dostupná je verzia kazety s najnovším čipom.", kind: "toner" },
    { codes: "HP207", status: "Dostupná je verzia kazety s najnovším čipom.", kind: "toner" },
    { codes: "HP216", status: "Dostupná je verzia kazety s najnovším čipom.", kind: "toner" },
    { codes: "HP903; HP907", status: "Funkčné sú kazety s čipom označeným ABA.", kind: "atrament" },
    { codes: "HP953; HP957", status: "Funkčné sú kazety s čipom označeným AB8.", kind: "atrament" },
    { codes: "HP913; HP973", status: "Funkčné sú kazety s označením C44 a vyšším alebo A9.5; AB3.", kind: "atrament" },
    { codes: "HP912", status: "Funkčné sú kazety s čipom označeným C6.", kind: "atrament" },
    { codes: "HP963", status: "Funkčné sú kazety s čipom označeným C6.", kind: "atrament" },
  ],
};

let refreshPromise: Promise<FirmwareInfoSnapshot> | null = null;
let timer: NodeJS.Timeout | null = null;

function env(name: string): string {
  return String(process.env[name] || import.meta.env[name] || "").trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cacheDirectory(): string {
  const configured = portableStoragePath(env("TM_PERSISTENT_DATA_DIR"));
  return resolve(configured ? join(configured, "firmware-info") : join(process.cwd(), ".tm-data", "firmware-info"));
}

function cacheFile(): string {
  return join(cacheDirectory(), "latest.json");
}

function parseDigestChallenge(value: string | null): { realm: string; nonce: string } {
  const realm = value?.match(/realm="([^"]+)"/i)?.[1] || "";
  const nonce = value?.match(/nonce="([^"]+)"/i)?.[1] || "";
  if (!realm || !nonce) throw new Error("ABIX prihlásenie nevrátilo platnú prihlasovaciu výzvu.");
  return { realm, nonce };
}

function authorization(fields: Record<string, string | number>): string {
  return `Digest ${Object.entries(fields).map(([key, value]) => key === "x" ? `${key}=${value}` : `${key}="${value}"`).join(", ")}`;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5_000, Number(env("ABIX_FIRMWARE_TIMEOUT_MS") || 25_000)));
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "ToneryMAXIM-FirmwareInfo/1.0",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchArticlePayload(username: string, password: string): Promise<unknown> {
  const clientNonce = sha256(randomBytes(24).toString("hex"));
  const challengeResponse = await fetchWithTimeout(`${ABIX_ORIGIN}/${LOGIN_URI}`);
  if (challengeResponse.status !== 401) {
    throw new Error(`ABIX prihlásenie: očakávaná výzva 401, prijaté HTTP ${challengeResponse.status}.`);
  }
  const { realm, nonce } = parseDigestChallenge(challengeResponse.headers.get("www-authenticate"));
  const loginX = Math.floor(Math.random() * 100);
  const ha1 = sha256(`${username}:${realm}:${password}`);
  const ha2 = sha256(`GET:${LOGIN_URI}`);
  const loginResponseHash = sha256(`${ha1}:${nonce}:${loginX}:0:${clientNonce}:auth:${ha2}`);
  const loginResponse = await fetchWithTimeout(`${ABIX_ORIGIN}/${LOGIN_URI}`, {
    headers: { authorization: authorization({ username, realm, nonce, uri: LOGIN_URI, qop: "auth", x: loginX, cnonce: clientNonce, response: loginResponseHash }) },
  });
  if (!loginResponse.ok) throw new Error(`ABIX prihlásenie zlyhalo (HTTP ${loginResponse.status}).`);
  const auth = await loginResponse.json() as { a?: number; b?: number; c?: number; hu?: string };
  if (![auth.a, auth.b, auth.c].every(Number.isFinite) || !auth.hu) throw new Error("ABIX prihlásenie vrátilo neúplné autorizačné údaje.");

  const requestX = Math.floor(Math.random() * 100);
  const polynomial = Math.floor(Number(auth.a) * requestX ** 2 + Number(auth.b) * requestX + Number(auth.c));
  const articleHash = sha256(`${auth.hu}:${nonce}:${requestX}:${polynomial}:${clientNonce}:auth:${sha256(`GET:${ARTICLE_URI}`)}`);
  const articleResponse = await fetchWithTimeout(`${ABIX_ORIGIN}/${ARTICLE_URI}`, {
    headers: { authorization: authorization({ username, realm, nonce, uri: ARTICLE_URI, qop: "auth", x: requestX, cnonce: clientNonce, response: articleHash }) },
  });
  if (!articleResponse.ok) throw new Error(`ABIX firmware článok nie je dostupný (HTTP ${articleResponse.status}).`);
  return articleResponse.json();
}

function decodeHtml(value: string): string {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\r/g, "");
}

function articleText(payload: unknown): string {
  const candidates: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") candidates.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(payload);
  const scored = candidates
    .map((value) => ({ value, score: value.length + (/firmware/i.test(value) ? 2_000 : 0) + (/čip|cip/i.test(value) ? 2_000 : 0) + (/\b(?:CF|HP)\d{3}/i.test(value) ? 2_000 : 0) }))
    .sort((a, b) => b.score - a.score);
  if (!scored[0] || !/(?:čip|cip|kazet)/i.test(scored[0].value) || !/\b(?:CF|HP)\d{3}/i.test(scored[0].value)) {
    throw new Error("ABIX firmware článok neobsahuje rozpoznateľné údaje.");
  }
  return decodeHtml(scored[0].value);
}

function customerStatus(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").replace(/s označením\s+s označením/gi, "s označením").trim().replace(/[.;]*$/, ".");
  if (/na sklade.*najnovším čipom/i.test(clean)) return "Dostupná je verzia kazety s najnovším čipom.";
  const marking = clean.match(/funkčné\s+kazety.*?označením\s+(.+?)[.]?$/i)?.[1];
  if (marking) return `Funkčné sú kazety s čipom označeným ${marking.replace(/[.;]*$/, "")}.`;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function parseFirmwareArticle(payload: unknown): FirmwareInfoEntry[] {
  const text = articleText(payload);
  let kind: FirmwareInfoEntry["kind"] = "toner";
  const entries: FirmwareInfoEntry[] = [];
  for (const sourceLine of text.split("\n")) {
    const line = sourceLine.replace(/[•\u00a0]/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (/atramentové\s+kazety/i.test(line)) { kind = "atrament"; continue; }
    const match = line.match(/^(?:Model\s+)?([A-Z0-9][A-Z0-9\s;,./+\-]{1,80}?)\s*[-–]\s*(.+)$/i);
    if (!match || !/\d/.test(match[1]) || !/(?:čip|cip|kazet)/i.test(match[2])) continue;
    const codes = match[1].replace(/\s*;\s*/g, "; ").replace(/\s*,\s*/g, ", ").trim();
    entries.push({ codes, status: customerStatus(match[2]), kind });
  }
  const unique = [...new Map(entries.map((entry) => [`${entry.kind}:${entry.codes.toUpperCase()}`, entry])).values()];
  if (!unique.length) throw new Error("ABIX firmware článok neobsahuje žiadne rozpoznané modely.");
  return unique;
}

function validSnapshot(value: unknown): value is FirmwareInfoSnapshot {
  const item = value as FirmwareInfoSnapshot;
  return Boolean(item && typeof item.checkedAt === "string" && Array.isArray(item.entries) && item.entries.length);
}

async function saveSnapshot(snapshot: FirmwareInfoSnapshot): Promise<void> {
  const directory = cacheDirectory();
  await mkdir(directory, { recursive: true });
  const temporary = `${cacheFile()}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(snapshot, null, 2), "utf8");
  await rename(temporary, cacheFile());
}

export async function readFirmwareInfoSnapshot(): Promise<FirmwareInfoSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(cacheFile(), "utf8"));
    return validSnapshot(parsed) ? parsed : INITIAL_SNAPSHOT;
  } catch {
    return INITIAL_SNAPSHOT;
  }
}

export async function refreshFirmwareInfo(): Promise<FirmwareInfoSnapshot> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const username = env("ABIX_FIRMWARE_USERNAME");
    const password = env("ABIX_FIRMWARE_PASSWORD");
    if (!username || !password) throw new Error("Chýba ABIX_FIRMWARE_USERNAME alebo ABIX_FIRMWARE_PASSWORD.");
    const payload = await fetchArticlePayload(username, password);
    const snapshot: FirmwareInfoSnapshot = { source: "abix", checkedAt: new Date().toISOString(), entries: parseFirmwareArticle(payload) };
    await saveSnapshot(snapshot);
    return snapshot;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function ensureFirmwareInfoWorkerStarted(): void {
  const globalState = globalThis as typeof globalThis & { [WORKER_GLOBAL_KEY]?: boolean };
  if (globalState[WORKER_GLOBAL_KEY] || env("ABIX_FIRMWARE_ENABLED") === "0") return;
  if (!env("ABIX_FIRMWARE_USERNAME") || !env("ABIX_FIRMWARE_PASSWORD")) return;
  globalState[WORKER_GLOBAL_KEY] = true;
  const intervalMs = Math.max(60 * 60 * 1000, Number(env("ABIX_FIRMWARE_INTERVAL_MS") || DEFAULT_INTERVAL_MS));
  const startDelayMs = Math.max(30_000, Number(env("ABIX_FIRMWARE_START_DELAY_MS") || DEFAULT_START_DELAY_MS));
  setTimeout(() => {
    void refreshFirmwareInfo().catch((error) => console.error("[TM firmware info]", (error as Error)?.message || error));
    timer = setInterval(() => void refreshFirmwareInfo().catch((error) => console.error("[TM firmware info]", (error as Error)?.message || error)), intervalMs);
    timer.unref?.();
  }, startDelayMs).unref?.();
}
