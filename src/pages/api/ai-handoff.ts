import type { APIRoute } from 'astro';
import { sendMail } from '../../lib/mail';

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
    if (body?.consent !== true) throw new Error('Potrebujeme súhlas s kontaktovaním.');
    if (!phone && !email) throw new Error('Zadajte telefón alebo e-mail.');
    if (!validEmail(email)) throw new Error('Skontrolujte e-mailovú adresu.');
    if (!validPhone(phone)) throw new Error('Skontrolujte telefónne číslo.');
    if (!question) throw new Error('Chýba otázka zákazníka.');

    const when = new Intl.DateTimeFormat('sk-SK', { dateStyle:'medium', timeStyle:'short', timeZone:'Europe/Bratislava' }).format(new Date());
    const text = `AI Tomáš – zákazník žiada pomoc človeka\n\nOtázka: ${question}\nTelefón: ${phone || 'neuvedený'}\nE-mail: ${email || 'neuvedený'}\nStránka: ${page}\nČas: ${when}\n\nZákazník vo formulári súhlasil s kontaktovaním k tejto otázke.`;
    await sendMail({ to: TARGET, replyTo: email || undefined, subject: 'AI Tomáš – zákazník žiada kontakt', text,
      html:`<h2>AI Tomáš – zákazník žiada pomoc človeka</h2><p><b>Otázka:</b> ${esc(question)}</p><p><b>Telefón:</b> ${esc(phone || 'neuvedený')}<br><b>E-mail:</b> ${esc(email || 'neuvedený')}<br><b>Stránka:</b> ${esc(page)}<br><b>Čas:</b> ${esc(when)}</p><p>Zákazník vo formulári súhlasil s kontaktovaním k tejto otázke.</p>` });
    return new Response(JSON.stringify({ ok:true }), { status:200, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'} });
  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, error: clean(e?.message || 'Odoslanie sa nepodarilo.', 180) }), { status:400, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'} });
  }
};
