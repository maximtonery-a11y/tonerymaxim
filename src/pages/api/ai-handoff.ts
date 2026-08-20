import type { APIRoute } from 'astro';
import { sendMail } from '../../lib/mail.ts';

export const prerender = false;
const TARGET = 'info@tonerymaxim.sk';
const attempts = new Map<string, { count: number; reset: number }>();

function clean(value: unknown, max = 500) { return String(value || '').replace(/[<>]/g, '').trim().slice(0, max); }
function esc(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c)); }
function validEmail(v: string) { return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validPhone(v: string) { return !v || /^[+\d][\d\s().-]{6,24}$/.test(v); }

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    const key = String(clientAddress || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const now = Date.now(); const current = attempts.get(key);
    if (!current || current.reset < now) attempts.set(key, { count: 1, reset: now + 15 * 60_000 });
    else { current.count += 1; if (current.count > 5) return new Response(JSON.stringify({ ok:false, error:'Príliš veľa požiadaviek. Skúste neskôr.' }), { status:429, headers:{'Content-Type':'application/json'} }); }

    const body = await request.json().catch(() => ({}));
    if (clean(body?.website, 100)) return new Response(JSON.stringify({ ok:true }), { status:200, headers:{'Content-Type':'application/json'} });
    const phone = clean(body?.phone, 40); const email = clean(body?.email, 120).toLowerCase();
    const question = clean(body?.question, 1000); const page = clean(body?.page, 300) || '/';
    const reason = clean(body?.reason, 40) === 'unanswered' ? 'AI Tomáš nepoznal spoľahlivú odpoveď' : 'Zákazník požiadal o človeka';
    const history = Array.isArray(body?.history) ? body.history.slice(-12).map((turn:any) => ({
      role: turn?.role === 'assistant' ? 'AI Tomáš' : 'Zákazník', content: clean(turn?.content, 500),
    })).filter((turn:any)=>turn.content) : [];
    if (body?.consent !== true) throw new Error('Potrebujeme súhlas s kontaktovaním.');
    if (!phone && !email) throw new Error('Zadajte telefón alebo e-mail.');
    if (!validEmail(email)) throw new Error('Skontrolujte e-mailovú adresu.');
    if (!validPhone(phone)) throw new Error('Skontrolujte telefónne číslo.');
    if (!question) throw new Error('Chýba otázka zákazníka.');

    const when = new Intl.DateTimeFormat('sk-SK', { dateStyle:'medium', timeStyle:'short', timeZone:'Europe/Bratislava' }).format(new Date());
    const transcript=history.length?history.map((turn:any)=>`${turn.role}: ${turn.content}`).join('\n'):'bez predchádzajúceho kontextu';
    const text = `AI Tomáš – odovzdanie pracovníkovi\n\nDôvod: ${reason}\nOtázka: ${question}\nTelefón: ${phone || 'neuvedený'}\nE-mail: ${email || 'neuvedený'}\nStránka: ${page}\nČas: ${when}\n\nPosledný kontext konverzácie:\n${transcript}\n\nZákazník vo formulári súhlasil s kontaktovaním k tejto otázke.`;
    await sendMail({ to: TARGET, replyTo: email || undefined, subject: 'AI Tomáš – zákazník žiada kontakt', text,
      html:`<h2>AI Tomáš – odovzdanie pracovníkovi</h2><p><b>Dôvod:</b> ${esc(reason)}<br><b>Otázka:</b> ${esc(question)}</p><p><b>Telefón:</b> ${esc(phone || 'neuvedený')}<br><b>E-mail:</b> ${esc(email || 'neuvedený')}<br><b>Stránka:</b> ${esc(page)}<br><b>Čas:</b> ${esc(when)}</p><h3>Posledný kontext konverzácie</h3><ul>${history.map((turn:any)=>`<li><b>${esc(turn.role)}:</b> ${esc(turn.content)}</li>`).join('')||'<li>bez predchádzajúceho kontextu</li>'}</ul><p>Zákazník vo formulári súhlasil s kontaktovaním k tejto otázke.</p>` });
    return new Response(JSON.stringify({ ok:true }), { status:200, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'} });
  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, error: clean(e?.message || 'Odoslanie sa nepodarilo.', 180) }), { status:400, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'} });
  }
};
