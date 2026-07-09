import type { APIRoute } from 'astro';
import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { buildAssistantAnswer } from '../../lib/aiSalesAssistant';

export const prerender = false;

async function logUnanswered(payload: Record<string, unknown>) {
  try {
    const dir = path.resolve(process.cwd(), '.tm-cache');
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, 'ai-unanswered.jsonl'), `${JSON.stringify({ created_at: new Date().toISOString(), ...payload })}\n`, 'utf8');
  } catch {
    // Logovanie nesmie zhodiť odpoveď asistenta.
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const message = String(body?.message || '').slice(0, 500).trim();
    const page = String(body?.page || '').slice(0, 300);
    const result = await buildAssistantAnswer(message);

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
      error: error?.message || 'AI assistant failed',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
};
