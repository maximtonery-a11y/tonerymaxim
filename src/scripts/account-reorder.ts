import { mergeAccountReorder } from '../lib/account-reorder-cart';
import type { ReorderPlan } from '../lib/account-reorder';

const money = (value: number) => new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' }).format(value);
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
type CartAPI = { readCart(): Array<Record<string, any>>; saveCart(cart: Array<Record<string, any>>): void };
const cartAPI = () => (window as unknown as { ToneryMaximCart?: CartAPI }).ToneryMaximCart;

document.querySelectorAll<HTMLElement>('[data-account-order]').forEach(card => {
  const start = card.querySelector<HTMLButtonElement>('[data-reorder-start]');
  const panel = card.querySelector<HTMLElement>('[data-reorder-preview]');
  const status = card.querySelector<HTMLElement>('[data-reorder-status]');
  if (!start || !panel || !status) return;
  let plan: ReorderPlan | null = null;
  let previewCart = '';
  let busy = false;
  const message = (text: string) => { status.textContent = text; };
  function render() {
    if (!plan || !panel) return;
    const api = cartAPI();
    if (!api) throw new Error('Košík sa ešte načítava. Skúste to o chvíľu.');
    const current = api.readCart();
    previewCart = JSON.stringify(current);
    const merged = plan.items.length ? mergeAccountReorder(current, plan) : null;
    panel.innerHTML = `<h4>Skontrolujte opakovaný nákup</h4>
      <p>Zobrazené sú aktuálne ceny za kus. Zľavy a dopravu vypočítame v košíku. Produkty pridáme k súčasnému obsahu košíka.</p>
      <ul class="account-reorder-items">${plan.items.map(item => `<li><div><strong>${escape(item.name)}</strong><small>${escape(item.stock_text)}</small></div><span>${item.qty} ks × ${money(item.price)}</span></li>`).join('')}</ul>
      ${plan.skipped.length ? `<div class="account-reorder-warning"><strong>Upozornenia k položkám</strong><ul>${plan.skipped.map(item => `<li>${escape(item.name)}: ${escape(item.reason)}</li>`).join('')}</ul></div>` : ''}
      ${merged?.limited.length ? `<p class="account-reorder-warning">Pri položkách ${merged.limited.map(escape).join(', ')} sa celkové množstvo vrátane súčasného košíka obmedzí na 99 ks.</p>` : ''}
      ${!merged?.added ? '<p>Nie sú dostupné ďalšie produkty na vloženie. Položky môžu byť nedostupné alebo už máte v košíku maximálne množstvo.</p>' : ''}
      <div class="account-order-actions"><button type="button" class="tm-btn" data-reorder-confirm ${merged?.added ? '' : 'disabled'}>Vložiť do košíka</button><button type="button" class="tm-btn is-outline" data-reorder-cancel>Zrušiť</button></div>`;
    panel.hidden = false;
  }
  async function prepare() {
    const response = await fetch('/api/account/reorder', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ orderId: Number(card.dataset.accountOrder) }) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !Array.isArray(data.plan?.items) || !Array.isArray(data.plan?.skipped)) throw new Error(data?.error || 'Objednávku sa nepodarilo načítať.');
    plan = data.plan;
    render();
  }
  start.addEventListener('click', async () => {
    if (busy) return;
    busy = true; start.disabled = true; message('Overujeme aktuálne ceny a dostupnosť…');
    try { await prepare(); message(''); panel.querySelector<HTMLButtonElement>('[data-reorder-confirm]:not(:disabled), [data-reorder-cancel]')?.focus(); }
    catch (error) { message(error instanceof Error ? error.message : 'Objednávku sa nepodarilo načítať.'); }
    finally { busy = false; start.disabled = false; }
  });
  panel.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-reorder-cancel]')) { panel.hidden = true; message(''); start.focus(); return; }
    const confirm = target?.closest<HTMLButtonElement>('[data-reorder-confirm]');
    if (!confirm || !plan || busy) return;
    busy = true; confirm.disabled = true;
    try {
      const api = cartAPI();
      if (!api) throw new Error('Košík sa ešte načítava. Skúste to o chvíľu.');
      if (Date.now() - plan.checkedAt > 120_000) {
        await prepare(); message('Ceny a dostupnosť sme obnovili. Skontrolujte položky a potvrďte ich vloženie.'); return;
      }
      const current = api.readCart();
      if (JSON.stringify(current) !== previewCart) { render(); message('Obsah košíka sa zmenil. Skontrolujte opakovaný nákup a potvrďte ho znova.'); return; }
      const merged = mergeAccountReorder(current, plan);
      if (!merged.added) throw new Error('V košíku už máte maximálne množstvo týchto produktov.');
      // One atomic storage write, using the existing cart API; no order is submitted.
      api.saveCart(merged.cart);
      window.location.assign('/kosik');
    } catch (error) { message(error instanceof Error ? error.message : 'Produkty sa nepodarilo vložiť do košíka.'); }
    finally { busy = false; confirm.disabled = false; }
  });
});
