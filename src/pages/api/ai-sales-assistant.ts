import type { APIRoute } from 'astro';
import { buildAssistantAnswer } from '../../lib/aiSalesAssistant';
import { saveAiUnanswered } from '../../lib/ai-unanswered';
import { advisorLinks } from '../../lib/ai-advisor-links';

export const prerender = false;

function explicitHumanRequest(message: string): boolean {
  const n = String(message || '').toLocaleLowerCase('sk-SK');
  return /(?:chcem|potrebujem|spoj|spojte|prepoj|prepojte|daj|dajte|mozem|môžem).*?(?:clovek|človek|operator|operátor|predajca|kolega|pracovnik|pracovník|zivy|živý)|(?:zavolajte|zavolal|ozvite|ozval|kontaktujte ma|chcem telefonovat|chcem volať|chcem volat)/i.test(n);
}

function businessRelevantForHandoff(message: string, page: string): boolean {
  const n = String(message || '').toLocaleLowerCase('sk-SK');
  if (/recept|pocasie|počasie|politika|basen|báseň|vtip|futbal|film|hudba/.test(n)) return false;
  if (/toner|napln|náplň|tlaciaren|tlačiareň|objednav|objednáv|dopr|platb|reklamac|vraten|vráten|registr|prihlas|účet|ucet|faktur|produkt|sklad|cena|zlav|zľav|bod|gopay|kurier|kuriér|gls|dpd|cesk|česk|brno|praha|tlač|tlac|kazet|valec|cartridge|firmware/.test(n)) return true;
  return /\/(produkt|produkty|tlaciarne|kosik|pokladna|reklamacie|prihlasenie|registracia|ucet)/.test(page);
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
    const history = Array.isArray(body?.history) ? body.history.slice(-12).map((turn: any) => ({
      role: turn?.role === 'assistant' ? 'assistant' : 'user',
      content: redactAiInput(turn?.content, 500),
    })).filter((turn: any) => turn.content) : [];
    const wantsHuman = explicitHumanRequest(message);
    const result: any = wantsHuman ? {
      answer: [
        'Samozrejme. Ak chcete pomoc od človeka, môžete nám zanechať telefón alebo e-mail cez kontaktný formulár nižšie.',
        'Kolega dostane vašu otázku spolu s kontaktom na info@tonerymaxim.sk a ozve sa vám podľa zadaného kontaktu.'
      ],
      products: [], groups: [], intent: 'handoff', confidence: 0.99, unanswered: false
    } : await buildAssistantAnswer(message, page, history);
    const unresolvedImportant = ((result as any).unanswered || result.intent === 'fallback' || Number((result as any).confidence || 0) < 0.35) && businessRelevantForHandoff(message, page);
    (result as any).handoffSuggested = wantsHuman || unresolvedImportant;

    if ((result as any).unanswered || result.intent === 'fallback' || Number((result as any).confidence || 0) < 0.35) {
      // Zápis je oddelený od odpovede Tomáša: zákazník na diskové logovanie nečaká.
      const confidence = Number((result as any).confidence || 0);
      const kind = ((result as any).unanswered || result.intent === 'fallback') ? 'unknown_question' : 'low_confidence';
      void saveAiUnanswered({ message, page, intent: result.intent, confidence, kind }).catch(() => undefined);
    }

    return new Response(JSON.stringify({ ok: true, ...result, sources: advisorLinks(result) }), {
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
