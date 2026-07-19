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

  const state = { busy: false };

  function openPanel() {
    panel.hidden = false;
    toggle.hidden = true;
    setTimeout(() => input.focus(), 80);
  }

  function closePanel() {
    panel.hidden = true;
    toggle.hidden = false;
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
      url: product.url || `/novy/produkty?s=${encodeURIComponent(product.sku || product.name || '')}`,
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
    const url = escapeHtml(product.url || `/novy/produkty?s=${encodeURIComponent(product.sku || product.name || '')}`);
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

    addMessage('user', `<p>${escapeHtml(question)}</p>`);
    const loading = addMessage('bot', '<p>Hľadám odpoveď…</p>');
    const startTop = messages.scrollTop;

    try {
      const response = await fetch('/novy/api/ai-sales-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, page: location.pathname }),
      });

      const data = await response.json();
      loading.innerHTML = `${textToHtml(data.answer || 'Nenašiel som presnú odpoveď.')}${renderGroups(data.groups)}`;
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
  close.addEventListener('click', closePanel);


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
