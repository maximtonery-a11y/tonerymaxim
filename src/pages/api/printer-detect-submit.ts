import type { APIRoute } from "astro";
import { getProductsCache } from "../../lib/tm-products-cache.ts";
import { productPrinterValues } from "../../lib/catalog-query.ts";
import { entitySlug, printerBrandForName } from "../../lib/seo-catalog.ts";
import { matchDetectedPrinter, type DetectedPrinterInput, type DetectedPrinterMatch } from "../../lib/detected-printer-match.ts";
import {
  completePrinterDetectionSession,
  failPrinterDetectionSession,
  printerDetectionSessionPending,
  readPrinterDetectionSession,
  validPrinterDetectionToken,
} from "../../lib/printer-detect-sessions.ts";

export const prerender = false;

const MAX_PRINTERS = 12;
const MAX_FIELD_LENGTH = 160;
const HELPER_MAJOR_VERSION = "4";

const globalStore = globalThis as typeof globalThis & {
  __TM_DETECTED_PRINTER_MODELS_V4__?: { generatedAt: string; models: string[] };
};

function cleanField(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

function normalizePrinter(value: unknown): DetectedPrinterInput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    name: cleanField(record.name),
    driver: cleanField(record.driver),
    isDefault: record.isDefault === true,
    isNetwork: record.isNetwork === true,
    isLocal: record.isLocal === true,
    isOffline: record.isOffline === true,
    isVirtual: record.isVirtual === true,
  };
}



type PrinterDetectSubmitBody = {
  token?: unknown;
  version?: unknown;
  checkOnly?: unknown;
  error?: unknown;
  printers?: unknown;
};

type DetectionResultItem = {
  source: string;
  isDefault: boolean;
  status: DetectedPrinterMatch["status"];
  reason?: string;
  model?: string;
  url?: string;
  suggestions: Array<{ model: string; url: string }>;
  manualQuery: string;
};

function submitBody(value: unknown): PrinterDetectSubmitBody {
  return value && typeof value === "object" ? value as PrinterDetectSubmitBody : {};
}

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

async function printerModels() {
  const cache = await getProductsCache();
  const current = globalStore.__TM_DETECTED_PRINTER_MODELS_V4__;
  if (current?.generatedAt === cache.generated_at) return current.models;

  const unique = new Map<string, string>();
  for (const product of cache.products || []) {
    for (const raw of productPrinterValues(product)) {
      for (const part of String(raw || "").split(/[,;|\n]+/)) {
        const model = part.replace(/\s+/g, " ").trim();
        const key = model.toLowerCase().normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "");
        if (model && key && !unique.has(key)) unique.set(key, model);
      }
    }
  }

  const models = [...unique.values()];
  globalStore.__TM_DETECTED_PRINTER_MODELS_V4__ = { generatedAt: cache.generated_at, models };
  return models;
}

function modelUrl(model: string) {
  const brand = printerBrandForName(model);
  return brand
    ? `/tlaciarne/${brand.slug}/${entitySlug(model)}`
    : `/produkty?s=${encodeURIComponent(model)}`;
}

export const POST: APIRoute = async ({ request }) => {
  let body: PrinterDetectSubmitBody;
  try {
    body = submitBody(await request.json());
  } catch {
    return json({ ok: false, error: "Neplatné údaje." }, 400);
  }

  const token = cleanField(body.token);
  if (!validPrinterDetectionToken(token)) return json({ ok: false, error: "Neplatná relácia." }, 400);

  const session = readPrinterDetectionSession(token);
  if (!session) return json({ ok: false, error: "Relácia vypršala alebo neexistuje." }, 404);
  // Retry po úspešnom spracovaní je idempotentný. Pomocník môže prísť o HTTP
  // odpoveď po tom, čo server výsledok už uložil; nesmie potom hlásiť zlyhanie.
  if (session.status === "complete") return json({ ok: true, alreadyComplete: true });
  if (session.status === "error") return json({ ok: false, error: "Relácia už skončila chybou." }, 409);
  if (!printerDetectionSessionPending(token)) return json({ ok: false, error: "Relácia už nie je aktívna." }, 409);

  const majorVersion = String(body.version || "").split(".")[0];
  if (majorVersion !== HELPER_MAJOR_VERSION) {
    failPrinterDetectionSession(token, "Pomocník pre Windows je zastaraný. Stiahnite aktuálnu verziu.");
    return json({ ok: false, error: "Neplatná verzia pomocníka." }, 409);
  }

  // Prvý malý request iba overí, že token naozaj vytvorila otvorená stránka
  // ToneryMaxim. Až po tomto potvrdení Windows helper číta lokálne tlačiarne.
  if (body.checkOnly === true) return json({ ok: true, authorized: true });

  if (body.error) {
    failPrinterDetectionSession(token, "Windows pomocník detekciu nedokončil. Skúste to znova.");
    return json({ ok: true });
  }

  if (!Array.isArray(body.printers) || body.printers.length > MAX_PRINTERS) {
    failPrinterDetectionSession(token, "Pomocník vrátil neplatný zoznam tlačiarní.");
    return json({ ok: false, error: `Očakáva sa najviac ${MAX_PRINTERS} tlačiarní.` }, 400);
  }

  try {
    const printers: DetectedPrinterInput[] = body.printers
      .map((printer: unknown) => normalizePrinter(printer))
      .filter((printer: DetectedPrinterInput) => !printer.isVirtual);
    if (!printers.length) {
      completePrinterDetectionSession(token, { printers_found: 0, results: [] });
      return json({ ok: true });
    }

    const models = await printerModels();
    const results: DetectionResultItem[] = printers.map((printer: DetectedPrinterInput): DetectionResultItem => {
      const match = matchDetectedPrinter(printer, models);
      const source = cleanField(printer.name || printer.driver || "Tlačiareň");
      const manualQuery = cleanField(printer.driver || printer.name || "");
      return {
        source,
        isDefault: printer.isDefault === true,
        status: match.status,
        reason: match.reason,
        model: match.model,
        url: match.model ? modelUrl(match.model) : undefined,
        suggestions: (match.suggestions || []).map((model) => ({ model, url: modelUrl(model) })),
        manualQuery,
      };
    }).filter((item: DetectionResultItem) => item.status !== "ignored");

    if (!completePrinterDetectionSession(token, { printers_found: printers.length, results })) {
      return json({ ok: false, error: "Relácia medzičasom vypršala." }, 409);
    }
    return json({ ok: true });
  } catch (error: unknown) {
    failPrinterDetectionSession(token, "Detekciu tlačiarne sa nepodarilo vyhodnotiť. Skúste to znova.");
    console.error("[TM printer-detect] submit failed", error instanceof Error ? error.message : error);
    return json({ ok: false, error: "Detekciu tlačiarne sa nepodarilo vyhodnotiť." }, 503);
  }
};
