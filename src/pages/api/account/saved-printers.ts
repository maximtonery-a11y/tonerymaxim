import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { bratislavaDay, endTonerCare, expireTonerCare, replacementDate, validPlanDate } from "../../../lib/toner-care-rules";
import { compactKey, getProductsCache, normalize } from "../../../lib/tm-products-cache";
import { readCustomerSession } from "../../../lib/auth-session";
import { entitySlug, printerBrandForName } from "../../../lib/seo-catalog";
import {
  getSavedPrintersFromCustomer,
  getWooCustomerById,
  saveWooCustomerPrinters,
  type SavedPrinter,
} from "../../../lib/woo-client";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function printerBrand(printer: string) {
  const brands = ["HP", "Canon", "Brother", "Epson", "Xerox", "Samsung", "Lexmark", "Kyocera", "OKI", "Ricoh", "Konica Minolta"];
  const text = normalize(printer);
  if (/\bhp\b/.test(text) || text.includes("hewlett")) return "HP";
  return brands.find((brand) => text.includes(normalize(brand))) || "";
}

async function findPrinter(query: string): Promise<SavedPrinter | null> {
  const q = String(query || "").trim();
  if (!q) return null;

  const normalizedQ = normalize(q);
  const compactQ = compactKey(q);
  const cache = await getProductsCache();
  const map = new Map<string, SavedPrinter>();

  for (const product of cache.products) {
    const printers = [
      ...(Array.isArray(product.printers) ? product.printers : []),
      ...(Array.isArray(product.compatible_printers) ? product.compatible_printers : []),
    ];
    for (const item of printers) {
      const title = String(item || "").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const key = compactKey(title);
      const current = map.get(key);
      if (current) {
        current.product_count = Number(current.product_count || 0) + 1;
      } else {
        const brand = printerBrandForName(title);
        map.set(key, {
          title,
          brand: printerBrand(title),
          product_count: 1,
          url: brand
            ? `/tlaciarne/${brand.slug}/${entitySlug(title)}`
            : `/produkty?printer=${encodeURIComponent(title)}`,
        });
      }
    }
  }

  const matches = [...map.values()]
    .map((printer) => {
      const titleNorm = normalize(printer.title);
      const titleCompact = compactKey(printer.title);
      let score = 0;
      if (titleCompact === compactQ) score += 100;
      if (titleNorm === normalizedQ) score += 80;
      if (titleNorm.includes(normalizedQ)) score += 40;
      if (titleCompact.includes(compactQ)) score += 45;
      if (normalizedQ.includes(titleNorm)) score += 20;
      score += Math.min(15, Number(printer.product_count || 0));
      return { printer, score };
    })
    .filter((item) => item.score >= 40)
    .sort((a, b) => b.score - a.score || a.printer.title.localeCompare(b.printer.title, "sk", { numeric: true }));

  return matches[0]?.printer || null;
}

async function requireCustomer(cookies: any) {
  const session = readCustomerSession(cookies);
  if (!session?.id) return null;
  return await getWooCustomerById(session.id);
}

export const GET: APIRoute = async ({ cookies }) => {
  const customer = await requireCustomer(cookies);
  if (!customer) return json({ ok: false, error: "Nie ste prihlásený." }, 401);
  return json({ ok: true, printers: getSavedPrintersFromCustomer(customer).map((printer) => expireTonerCare(printer)) });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const customer = await requireCustomer(cookies);
  if (!customer) return json({ ok: false, error: "Nie ste prihlásený." }, 401);

  const body = await request.json().catch(() => ({}));
  const query = String(body.title || body.model || body.q || "").trim();
  const printer = await findPrinter(query);
  if (!printer) return json({ ok: false, error: "Tento model sme v databáze nenašli." }, 404);

  const existing = getSavedPrintersFromCustomer(customer);
  const exists = existing.some((item) => compactKey(item.title) === compactKey(printer.title));
  const printers = exists ? existing : [{ ...printer, added_at: new Date().toISOString() }, ...existing].slice(0, 20);
  await saveWooCustomerPrinters(customer.id, printers);

  return json({ ok: true, printer, printers });
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  const customer = await requireCustomer(cookies);
  if (!customer) return json({ ok: false, error: "Nie ste prihlásený." }, 401);

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  if (!title) return json({ ok: false, error: "Chýba model tlačiarne." }, 400);

  const existing = getSavedPrintersFromCustomer(customer).map((printer) => expireTonerCare(printer));
  const index = existing.findIndex((item) => compactKey(item.title) === compactKey(title));
  if (index < 0) return json({ ok: false, error: "Uložená tlačiareň nebola nájdená." }, 404);
  const previous = existing[index];

  if (body.action === "disable" || body.care_enabled === false) {
    const updated = endTonerCare(previous, "disabled");
    existing[index] = updated;
    await saveWooCustomerPrinters(customer.id, existing);
    return json({ ok: true, printer: updated, printers: existing });
  }

  const installedAt = validPlanDate(body.installed_at);
  const expectedMonths = Number(body.expected_months ?? 3);
  if (!Number.isInteger(expectedMonths) || expectedMonths < 1 || expectedMonths > 24) {
    return json({ ok: false, error: "Predpokladaná výdrž musí byť 1 až 24 celých mesiacov." }, 400);
  }
  const preferredType = ["compatible", "original", "renovated", "any"].includes(String(body.preferred_type || ""))
    ? String(body.preferred_type)
    : "any";
  const careEnabled = body.care_enabled === true;

  if (careEnabled && !installedAt) {
    return json({ ok: false, error: "Pri aktívnom strážcovi zadajte dátum vloženia náplne." }, 400);
  }

  const today = bratislavaDay();
  if (installedAt && installedAt > today) {
    return json({ ok: false, error: "Dátum vloženia nemôže byť v budúcnosti." }, 400);
  }

  const due = installedAt ? replacementDate(installedAt, expectedMonths) : "";
  if (careEnabled && due < today) {
    return json({ ok: false, error: "Termín výmeny už uplynul. Nastavte nový plán výmeny." }, 400);
  }
  const cycleChanged = !previous.care_enabled || previous.installed_at !== installedAt || Number(previous.expected_months || 3) !== expectedMonths;
  const base = cycleChanged && previous.care_enabled ? endTonerCare(previous, "changed") : previous;
  const updated = {
    ...base,
    care_enabled: careEnabled,
    installed_at: installedAt,
    expected_months: expectedMonths,
    expected_replacement_at: due,
    reminder_days: 30,
    preferred_type: preferredType as "compatible" | "original" | "renovated" | "any",
    ...(cycleChanged ? {
      care_cycle_id: randomUUID(),
      care_ended_at: "",
      care_end_reason: undefined,
      care_reminders: [],
      customer_reminder_sent_for: "",
      admin_reminder_sent_for: "",
      last_reminder_at: "",
    } : {}),
  };

  existing[index] = updated;
  await saveWooCustomerPrinters(customer.id, existing);
  return json({ ok: true, printer: updated, printers: existing });
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const customer = await requireCustomer(cookies);
  if (!customer) return json({ ok: false, error: "Nie ste prihlásený." }, 401);

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  if (!title) return json({ ok: false, error: "Chýba model tlačiarne." }, 400);

  const printers = getSavedPrintersFromCustomer(customer).filter((printer) => compactKey(printer.title) !== compactKey(title));
  await saveWooCustomerPrinters(customer.id, printers);

  return json({ ok: true, printers });
};
