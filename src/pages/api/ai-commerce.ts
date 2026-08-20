import type { APIRoute } from 'astro';
import { searchCommerce, commerceCapabilities } from '../../lib/ai-commerce/engine.ts';

export const prerender = false;

function text(v: unknown, max = 500) { return String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function extractQuery(message: string) {
  const code = message.match(/\b(?:CF|CE|CRG|TN|DR|W|Q|CLT|MLT|TK|PGI|CLI|LC)[- ]?\d{2,}[A-Z0-9-]*\b/i)?.[0];
  if (code) return code;
  const printer = message.match(/\b(?:HP|Brother|Canon|Epson|Samsung|OKI|Xerox|Kyocera|Lexmark|Ricoh|Sharp|Toshiba|Pantum|Dell|Konica(?:\s+Minolta)?)\s+[A-Z-]*\d{3,}[A-Z0-9-]*\b/i)?.[0];
  return printer || message;
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const message = text(body?.message);
  if (!message) return Response.json({ ok: false, error: 'Napíšte produkt alebo model tlačiarne.' }, { status: 400 });
  const query = extractQuery(message);
  const result = await searchCommerce(query);
  return Response.json({ ok: true, engine: commerceCapabilities.version, query, ...result }, { headers: { 'Cache-Control': 'no-store' } });
};
