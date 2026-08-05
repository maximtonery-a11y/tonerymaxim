import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { TM_DATA_ROOT, writeSignedJson } from '../../lib/secure-persistence';
import { buildAssistantAnswer } from '../../lib/aiSalesAssistant';

export const prerender = false;

async function logUnanswered(payload: Record<string, unknown>) {
  try {
    await writeSignedJson(path.join(TM_DATA_ROOT, 'ai', 'unanswered', `${Date.now()}-${randomUUID()}.json`), {
      created_at: new Date().toISOString(),
      ...payload,
    });
  } catch {
    // Logovanie nesmie zhodiť odpoveď asistenta.
  }
}

function redactAiInput(value: unknown, max: number): string {
  return String(value || '')
    .replace(/[A-Z]{2}\d{2}(?:[\s-]?\d{4}){3,7}/gi, '[IBAN odstránený]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[e-mail odstránený]')
    .replace(/(?:\+?421|0)[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/g, '[telefón odstránený]')
    .replace(/\b(?:objednávka|objednavka|order)\s*(?:č\.?|#|:)?\s*\d{5,}\b/gi, 'objednávka [číslo odstránené]')
    .slice(0, max)
    .trim();
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const message = redactAiInput(body?.message, 500);
    let page = '/';
    try { page = new URL(String(body?.page || '/'), 'https://www.tonerymaxim.sk').pathname.slice(0, 300); } catch {}
    const result = await buildAssistantAnswer(message, page);

    if ((result as any).unanswered || result.intent === 'fallback') {
      await logUnanswered({ message, page, intent: result.intent, confidence: (result as any).confidence || 0 });
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      ok: false,
      answer: [
        'Mrzí ma, ale momentálne vám neviem správne pomôcť s vaším problémom.',
        'Kontaktujte nás počas pracovných dní od 9:00 do 15:00 na telefónnom čísle +421 917 859 206 alebo e-mailom na info@tonerymaxim.sk. Radi vám poradíme.',
      ],
      products: [],
      groups: [],
      intent: 'fallback',
      confidence: 0,
      unanswered: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
};
