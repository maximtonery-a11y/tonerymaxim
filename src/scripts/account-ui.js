(() => {
  const sidebar = document.querySelector('[data-account-sidebar]');
  const toggle = document.querySelector('[data-account-menu-toggle]');

  if (sidebar && toggle) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('is-open');
    });
  }

  const PRODUCT_LOOKUP = {
    'tn2421-compatible': { search: 'tn2421', type: 'compatible' },
    'dr2401': { search: 'dr2401' },
    'paper-a4': { search: 'kancelarsky papier a4' },
    'w1420a': { search: 'w1420a', type: 'compatible' },
    'crg067': { search: 'crg-067' },
  };

  const PRODUCT_SETS = {
    'last-order': ['tn2421-compatible', 'dr2401', 'paper-a4'],
    'brother-dcp-l2532dw': ['tn2421-compatible', 'dr2401'],
    'hp-m110w': ['w1420a'],
    'canon-mf655cdw': ['crg067'],
  };

  const productCache = new Map();

  function normalize(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function productUrl(product) {
    if (product?.detail_url) return product.detail_url;
    if (product?.slug) return `/produkt/${product.slug}`;
    return `/produkty?s=${encodeURIComponent(product?.sku || product?.name || '')}`;
  }

  function productImage(product) {
    if (product?.image) return product.image;
    if (Array.isArray(product?.images) && product.images[0]) {
      if (typeof product.images[0] === 'string') return product.images[0];
      return product.images[0]?.src || '';
    }
    return '';
  }

  function toCartProduct(product) {
    return {
      sku: String(product.sku || product.id || '').trim(),
      name: product.name || 'Produkt',
      price: Number(product.price || product.regular_price || 0),
      image: productImage(product),
      url: productUrl(product),
      qty: 1,
    };
  }

  function scoreProduct(product, config) {
    const haystack = normalize(`${product.sku || ''} ${product.name || ''} ${product.product_type_key || ''} ${product.product_type_label || ''}`);
    const search = normalize(config.search);
    let score = 0;

    if (haystack.includes(search)) score += 20;
    if (normalize(product.sku) === search) score += 40;
    if (normalize(product.name).includes(search)) score += 25;
    if (config.type && normalize(product.product_type_key || product.product_type_label).includes(normalize(config.type))) score += 35;
    if (product.stock_status === 'instock') score += 8;
    if (Number(product.price || 0) > 0) score += 4;

    return score;
  }

  async function resolveProduct(key) {
    if (productCache.has(key)) return productCache.get(key);

    const config = PRODUCT_LOOKUP[key];
    if (!config) return null;

    const params = new URLSearchParams({
      search: config.search,
      per_page: '24',
    });

    if (config.type) params.set('type', config.type);

    const response = await fetch(`/api/products?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    if (!products.length) return null;

    const resolved = [...products].sort((a, b) => scoreProduct(b, config) - scoreProduct(a, config))[0];
    productCache.set(key, resolved);
    return resolved;
  }

  async function addKeysToCart(keys = []) {
    const cartApi = window.ToneryMaximCart;
    if (!cartApi || typeof cartApi.addToCart !== 'function') return { ok: false, added: 0 };

    let added = 0;
    for (const key of keys) {
      const product = await resolveProduct(key);
      const cartProduct = product ? toCartProduct(product) : null;
      if (cartProduct?.sku) {
        cartApi.addToCart(cartProduct);
        added += 1;
      }
    }

    return { ok: added > 0, added };
  }

  function setAddedState(button, text = 'Pridané do košíka') {
    const original = button.textContent;
    button.textContent = text;
    button.classList.add('is-added');
    button.disabled = true;

    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('is-added');
      button.disabled = false;
    }, 1200);
  }

  function setLoadingState(button) {
    const original = button.textContent;
    button.dataset.originalText = original;
    button.textContent = 'Pridávam...';
    button.disabled = true;
  }

  function clearLoadingState(button) {
    if (!button.dataset.originalText) return;
    button.textContent = button.dataset.originalText;
    button.disabled = false;
    delete button.dataset.originalText;
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-account-add-product], [data-account-add-set]');
    if (!button) return;

    event.preventDefault();

    const productKey = button.dataset.accountAddProduct;
    const setKey = button.dataset.accountAddSet;
    const keys = productKey ? [productKey] : PRODUCT_SETS[setKey] || [];

    if (!keys.length) return;

    setLoadingState(button);
    const result = await addKeysToCart(keys);
    clearLoadingState(button);

    if (!result.ok) {
      setAddedState(button, 'Produkt sa nenašiel');
      return;
    }

    if (button.dataset.redirectCart === 'true') {
      window.location.href = '/kosik';
      return;
    }

    setAddedState(button);
  });

  const removeButtons = document.querySelectorAll('[data-remove-printer]');
  removeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-printer-card]');
      if (!card) return;
      card.style.opacity = '0';
      card.style.transform = 'translateY(8px)';
      setTimeout(() => card.remove(), 180);
    });
  });

  const addPrinterForm = document.querySelector('[data-add-printer-form]');
  const printerGrid = document.querySelector('[data-saved-printers-grid]');

  if (addPrinterForm && printerGrid) {
    addPrinterForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const brand = addPrinterForm.querySelector('[name="brand"]')?.value || '';
      const model = addPrinterForm.querySelector('[name="model"]')?.value.trim() || '';
      if (!brand || !model) return;

      const printerName = `${brand} ${model}`.replace(/\s+/g, ' ').trim();
      const href = `/produkty?printer=${encodeURIComponent(printerName).replace(/%20/g, '+')}`;

      const card = document.createElement('section');
      card.className = 'saved-printer-card';
      card.setAttribute('data-printer-card', '');
      card.innerHTML = `
        <div class="saved-printer-icon">🖨️</div>
        <div>
          <span class="account-mini-label">✓ Novo pridaná</span>
          <h3>${printerName}</h3>
          <p class="saved-printer-meta">Tlačiareň je uložená v zákazníckej zóne. Po napojení na účet sa bude ukladať do databázy.</p>
          <div class="saved-printer-products">
            <article class="saved-printer-product account-product-row"><div><strong>Odporúčané náplne</strong><span>Zobrazia sa podľa modelu tlačiarne.</span></div><strong>—</strong></article>
          </div>
          <div class="saved-printer-actions">
            <a class="tm-btn is-green is-small" href="${href}">Zobraziť náplne</a>
            <button class="tm-btn is-danger-soft is-small" type="button" data-remove-printer>Odstrániť</button>
          </div>
        </div>
        <div class="saved-printer-last"><small>Posledný nákup</small><strong>Zatiaľ bez nákupu</strong></div>
      `;
      printerGrid.prepend(card);
      addPrinterForm.reset();

      card.querySelector('[data-remove-printer]')?.addEventListener('click', () => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(8px)';
        setTimeout(() => card.remove(), 180);
      });
    });
  }
})();
