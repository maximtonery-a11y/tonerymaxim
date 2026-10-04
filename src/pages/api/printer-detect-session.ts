import type { APIRoute } from "astro";
import {
  readPrinterDetectionSession,
  registerPrinterDetectionSession,
  validPrinterDetectionToken,
} from "../../lib/printer-detect-sessions.ts";

export const prerender = false;

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: { token?: unknown };
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? parsed as { token?: unknown } : {};
  } catch {
    return json({ ok: false, error: "Neplatné údaje." }, 400);
  }
  const token = String(body.token || "");
  if (!validPrinterDetectionToken(token)) return json({ ok: false, error: "Neplatný token." }, 400);
  if (!registerPrinterDetectionSession(token)) return json({ ok: false, error: "Reláciu sa nepodarilo vytvoriť." }, 409);
  return json({ ok: true });
};

export const GET: APIRoute = async ({ url }) => {
  const token = String(url.searchParams.get("token") || "");
  if (!validPrinterDetectionToken(token)) return json({ ok: false, status: "invalid" }, 400);

  const session = readPrinterDetectionSession(token);
  if (!session) return json({ ok: false, status: "expired" }, 404);
  if (session.status === "pending") return json({ ok: true, status: "pending" });
  if (session.status === "error") return json({ ok: true, status: "error", error: session.error });
  return json({ ok: true, status: "complete", result: session.result });
};
