(function () {
  const root = document.querySelector('[data-ai-sales-assistant]');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const panel = root.querySelector('[data-ai-panel]');
  const toggle = root.querySelector('[data-ai-toggle]');
  const close = root.querySelector('[data-ai-close]');
  const form = root.querySelector('[data-ai-form]');
  const input = root.querySelector('[data-ai-input]');
  const messages = root.querySelector('[data-ai-messages]');
  const quick = root.querySelector('[data-ai-quick]');
  const handoff = root.querySelector('[data-ai-handoff]');
  const handoffForm = root.querySelector('[data-ai-handoff-form]');
  const handoffQuestion = root.querySelector('[data-ai-handoff-question]');
  const handoffPhone = root.querySelector('[data-ai-handoff-phone]');
  const handoffEmail = root.querySelector('[data-ai-handoff-email]');
  const handoffConsent = root.querySelector('[data-ai-handoff-consent]');
  const handoffHp = root.querySelector('[data-ai-handoff-hp]');
  const handoffStatus = root.querySelector('[data-ai-handoff-status]');
  const handoffClose = root.querySelector('[data-ai-handoff-close]');
  const handoffContinue = root.querySelector('[data-ai-handoff-continue]');

  const state = { busy: false, history: [], lastQuestion: '' };
  const mobileQuery = window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)');

  function openPanel() {
    if (document.querySelector('.tm-cookie-consent.tm-cookie-is-open')) return;
    panel.hidden = false;
    toggle.hidden = true;
    toggle.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
    document.documentElement.classList.add('tm-ai-open');
  }

  function closePanel(options = {}) {
    input.blur();
    panel.hidden = true;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'false');
    root.classList.remove('is-open', 'has-keyboard');
    document.documentElement.classList.remove('tm-ai-open');
    if (options.restoreFocus) toggle.focus({ preventScroll: true });
  }

  function updateViewportState() {
    if (!window.visualViewport) return;
    const viewportHeight = Math.round(window.visualViewport.height);
    root.style.setProperty('--tm-ai-visual-height', `${viewportHeight}px`);
    root.classList.toggle('has-keyboard', mobileQuery.matches && window.innerHeight - viewportHeight > 150);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[char]));
  }

  function textToHtml(answer) {
    const parts = Array.isArray(answer) ? answer : String(answer || '').split(/\n+/).filter(Boolean);
    return parts.map((part, index) => {
      const text = escapeHtml(part);
      if (index === 0 && /:$/.test(part)) return `<p><b>${text}</b></p>`;
      return `<p>${text}</p>`;
    }).join('');
  }

  function addMessage(type, html, options = {}) {
    const item = document.createElement('article');
    item.className = `tm-ai-msg tm-ai-msg--${type}`;
    item.innerHTML = html;
    messages.appendChild(item);
    if (options.scroll !== false) messages.scrollTop = messages.scrollHeight;
    return item;
  }

  function formatPrice(product) {
    const price = Number(product.price || 0);
    if (!Number.isFinite(price) || price <= 0) return '';
    return price.toLocaleString('sk-SK', { style: 'currency', currency: 'EUR' });
  }

  function productPayload(product) {
    return {
      id: product.id || '',
      sku: product.sku || '',
      name: product.name || 'Produkt',
      price: Number(product.price || 0),
      image: product.image || '',
      url: product.url || `/produkty?s=${encodeURIComponent(product.sku || product.name || '')}`,
      slug: product.slug || '',
      product_type_key: product.product_type_key || 'product',
      product_type_label: product.product_type_label || 'PRODUKT',
      color: product.color || '',
      capacity: product.capacity || '',
      warranty: product.warranty || '24 mesiacov',
      stock_status: product.stock_status || 'instock',
      stock_quantity: product.stock_quantity || null,
      stock_text: product.stock_text || '',
    };
  }

  function renderProductCard(product) {
    const name = escapeHtml(product.name || 'Produkt');
    const sku = escapeHtml(product.sku || '');
    const type = escapeHtml(product.product_type_label || product.type || '');
    const capacity = escapeHtml(product.capacity || '');
    const url = escapeHtml(product.url || `/produkty?s=${encodeURIComponent(product.sku || product.name || '')}`);
    const price = escapeHtml(formatPrice(product));
    const payload = escapeHtml(JSON.stringify(productPayload(product)));

    return `
      <article class="tm-ai-product">
        <strong>${name}</strong>
        <div class="tm-ai-product__meta">
          ${sku ? `<span>${sku}</span>` : ''}
          ${type ? `<span>${type}</span>` : ''}
          ${capacity ? `<span>${capacity}</span>` : ''}
        </div>
        ${price ? `<div class="tm-ai-product__price">${price}</div>` : ''}
        <div class="tm-ai-product__actions">
          <a href="${url}">Otvoriť</a>
          <button type="button" data-ai-add-to-cart="${payload}">Do košíka</button>
        </div>
      </article>`;
  }

  function groupTitle(group) {
    const count = Number(group.count || 0);
    return `${escapeHtml(group.label || 'produkty')} (${count})`;
  }

  function renderGroups(groups) {
    if (!Array.isArray(groups) || !groups.length) return '';

    return `
      <div class="tm-ai-groups">
        ${groups.map((group, index) => `
          <details class="tm-ai-group" ${index === 0 ? 'open' : ''}>
            <summary>${groupTitle(group)}</summary>
            <div class="tm-ai-product-list">
              ${(group.products || []).map(renderProductCard).join('')}
            </div>
          </details>
        `).join('')}
      </div>`;
  }

  function addToCart(product) {
    if (window.ToneryMaximCart && typeof window.ToneryMaximCart.addToCart === 'function') {
      window.ToneryMaximCart.addToCart({ ...product, qty: 1 });
      if (typeof window.ToneryMaximCart.showAddCartDrawer === 'function') {
        window.ToneryMaximCart.showAddCartDrawer({ ...product, qty: 1 });
      }
      return true;
    }

    const event = new CustomEvent('tm:add-to-cart', { detail: { ...product, qty: 1 } });
    window.dispatchEvent(event);

    try {
      const key = 'tm_cart_v1';
      const current = JSON.parse(localStorage.getItem(key) || '[]');
      const existing = current.find((item) => item.sku && product.sku && item.sku === product.sku);
      if (existing) existing.qty = Number(existing.qty || 1) + 1;
      else current.push({ ...product, qty: 1 });
      localStorage.setItem(key, JSON.stringify(current));
      window.dispatchEvent(new Event('storage'));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function askAssistant(question) {
    if (!question || state.busy) return;
    state.busy = true;
    state.lastQuestion = question;
    if (handoff) handoff.hidden = true;

    addMessage('user', `<p>${escapeHtml(question)}</p>`);
    const requestHistory = state.history.slice(-12);
    const loading = addMessage('bot', '<p>Hľadám odpoveď…</p>');
    const startTop = messages.scrollTop;

    try {
      const response = await fetch('/api/ai-sales-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, page: location.pathname, history: requestHistory }),
      });

      const data = await response.json();
      loading.innerHTML = `${textToHtml(data.answer || 'Nenašiel som presnú odpoveď.')}${renderGroups(data.groups)}`;
      state.history.push({ role: 'user', content: question });
      state.history.push({ role: 'assistant', content: Array.isArray(data.answer) ? data.answer.join(' ') : String(data.answer || '') });
      if (state.history.length > 12) state.history = state.history.slice(-12);
      if (handoff && data.handoffSuggested === true) {
        handoff.hidden = false;
        handoff.classList.remove('is-success');
        if (handoffQuestion) handoffQuestion.value = question;
        if (handoffStatus) handoffStatus.textContent = '';
      }
      // Neodskakujeme automaticky na koniec dlhej ponuky. Používateľ vidí odpoveď od začiatku.
      messages.scrollTop = startTop;
    } catch (error) {
      loading.innerHTML = '<p>Teraz sa mi nepodarilo odpovedať. Skúste napísať model tlačiarne alebo toneru presnejšie.</p>';
      messages.scrollTop = startTop;
    } finally {
      state.busy = false;
    }
  }

  toggle.addEventListener('click', openPanel);
  close.addEventListener('click', () => closePanel({ restoreFocus: true }));

  root.addEventListener('click', (event) => {
    if (mobileQuery.matches && event.target === root && !panel.hidden) closePanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closePanel({ restoreFocus: true });
  });

  window.addEventListener('tm:cookie-panel', (event) => {
    if (event.detail?.open && !panel.hidden) closePanel();
  });

  window.visualViewport?.addEventListener('resize', updateViewportState);
  window.visualViewport?.addEventListener('scroll', updateViewportState);
  updateViewportState();


  quick.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-prompt]');
    if (!button) return;
    input.value = '';
    askAssistant(button.dataset.aiPrompt || button.textContent.trim());
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    input.value = '';
    askAssistant(question);
  });


  function hideHandoff(options = {}) {
    if (!handoff) return;
    handoff.hidden = true;
    handoff.classList.remove('is-success');
    if (handoffStatus) handoffStatus.textContent = '';
    if (options.focusInput) input?.focus({ preventScroll: true });
  }

  handoffClose?.addEventListener('click', () => hideHandoff({ focusInput: true }));
  handoffContinue?.addEventListener('click', () => hideHandoff({ focusInput: true }));

  handoffForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = handoffQuestion?.value.trim() || state.lastQuestion || '';
    const phone = handoffPhone?.value.trim() || '';
    const email = handoffEmail?.value.trim() || '';
    if (!question) { if (handoffStatus) handoffStatus.textContent = 'Napíšte otázku pre pracovníka.'; return; }
    if (!phone && !email) { if (handoffStatus) handoffStatus.textContent = 'Zadajte telefón alebo e-mail.'; return; }
    if (!handoffConsent?.checked) { if (handoffStatus) handoffStatus.textContent = 'Potvrďte súhlas s kontaktovaním.'; return; }
    const button = handoffForm.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    if (handoffStatus) handoffStatus.textContent = 'Odosielam…';
    try {
      const response = await fetch('/api/ai-handoff', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ phone, email, question, page:location.pathname, consent:true, website:handoffHp?.value || '' }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Odoslanie sa nepodarilo.');
      if (handoffStatus) handoffStatus.textContent = 'Odoslané. Kolega dostal vašu otázku a kontakt. Môžete pokračovať s AI Tomášom.';
      handoff?.classList.add('is-success');
      if (handoffPhone) handoffPhone.value = ''; if (handoffEmail) handoffEmail.value = ''; if (handoffConsent) handoffConsent.checked = false;
    } catch (error) { if (handoffStatus) handoffStatus.textContent = error?.message || 'Odoslanie sa nepodarilo. Skúste kontakt info@tonerymaxim.sk.'; }
    finally { if (button) button.disabled = false; }
  });

  messages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-add-to-cart]');
    if (!button) return;

    try {
      const product = JSON.parse(button.dataset.aiAddToCart || '{}');
      const ok = addToCart(product);
      button.textContent = ok ? 'Pridané' : 'Otvoriť produkt';
      if (!ok && product.url) location.href = product.url;
    } catch (_) {
      button.textContent = 'Chyba';
    }
  });
})();
