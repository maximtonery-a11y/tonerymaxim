export const PRINTER_DETECT_SESSION_TTL_MS = 90_000;
export const PRINTER_DETECT_SESSION_MAX = 200;

export type PrinterDetectionSessionState =
  | { status: "pending"; expiresAt: number }
  | { status: "complete"; expiresAt: number; result: unknown }
  | { status: "error"; expiresAt: number; error: string };

const globalStore = globalThis as typeof globalThis & {
  __TM_PRINTER_DETECT_SESSIONS_V4__?: Map<string, PrinterDetectionSessionState>;
};

const sessions = globalStore.__TM_PRINTER_DETECT_SESSIONS_V4__ || new Map<string, PrinterDetectionSessionState>();
globalStore.__TM_PRINTER_DETECT_SESSIONS_V4__ = sessions;

export function validPrinterDetectionToken(token: unknown) {
  return /^[A-Za-z0-9_-]{32,96}$/.test(String(token || ""));
}

function cleanupExpired(now = Date.now()) {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function makeRoom(now = Date.now()) {
  cleanupExpired(now);
  while (sessions.size >= PRINTER_DETECT_SESSION_MAX) {
    const oldest = sessions.keys().next().value;
    if (typeof oldest !== "string") break;
    sessions.delete(oldest);
  }
}

export function registerPrinterDetectionSession(token: unknown, now = Date.now()) {
  if (!validPrinterDetectionToken(token)) return false;
  cleanupExpired(now);
  const key = String(token);
  if (sessions.has(key)) return false;
  makeRoom(now);
  sessions.set(key, { status: "pending", expiresAt: now + PRINTER_DETECT_SESSION_TTL_MS });
  return true;
}

export function printerDetectionSessionPending(token: unknown, now = Date.now()) {
  if (!validPrinterDetectionToken(token)) return false;
  cleanupExpired(now);
  return sessions.get(String(token))?.status === "pending";
}

export function completePrinterDetectionSession(token: unknown, result: unknown, now = Date.now()) {
  if (!validPrinterDetectionToken(token)) return false;
  cleanupExpired(now);
  const key = String(token);
  const current = sessions.get(key);
  if (!current || current.status !== "pending" || current.expiresAt <= now) return false;
  sessions.set(key, { status: "complete", expiresAt: current.expiresAt, result });
  return true;
}

export function failPrinterDetectionSession(token: unknown, error: string, now = Date.now()) {
  if (!validPrinterDetectionToken(token)) return false;
  cleanupExpired(now);
  const key = String(token);
  const current = sessions.get(key);
  if (!current || current.status !== "pending" || current.expiresAt <= now) return false;
  sessions.set(key, {
    status: "error",
    expiresAt: current.expiresAt,
    error: String(error || "Detekcia zlyhala.").slice(0, 160),
  });
  return true;
}

export function readPrinterDetectionSession(token: unknown, now = Date.now()) {
  if (!validPrinterDetectionToken(token)) return null;
  cleanupExpired(now);
  const current = sessions.get(String(token));
  if (!current || current.expiresAt <= now) return null;
  return current;
}

// Iba pre cielený regresný test. Neexportuje obsah relácií a v produkcii sa
// nikde nepoužíva.
export function printerDetectionSessionCountForTest(now = Date.now()) {
  cleanupExpired(now);
  return sessions.size;
}
