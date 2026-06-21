import type { APIRoute } from "astro";
import { compactKey, getProductsCache, normalize } from "../../../lib/tm-products-cache";
import { readCustomerSession } from "../../../lib/auth-session";
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
        map.set(key, {
          title,
          brand: printerBrand(title),
          product_count: 1,
          url: `/produkty?printer=${encodeURIComponent(title)}`,
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
  return json({ ok: true, printers: getSavedPrintersFromCustomer(customer) });
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
