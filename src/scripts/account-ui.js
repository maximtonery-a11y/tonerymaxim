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
        if (typeof cartApi.showAddCartDrawer === 'function') cartApi.showAddCartDrawer(cartProduct);
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


  function addDirectProductToCart(card) {
    const cartApi = window.ToneryMaximCart;
    if (!cartApi || typeof cartApi.addToCart !== 'function') return false;

    const name = card?.dataset.productName || 'Produkt';
    const sku = card?.dataset.productSku || name;
    const price = Number(card?.dataset.productPrice || 0);
    if (!sku || !price) return false;

    const cartProduct = { sku, name, price, qty: 1, url: `/produkty?s=${encodeURIComponent(sku || name)}` };
    cartApi.addToCart(cartProduct);
    if (typeof cartApi.showAddCartDrawer === 'function') cartApi.showAddCartDrawer(cartProduct);
    return true;
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-account-add-recent]');
    if (!button) return;
    event.preventDefault();
    const card = button.closest('[data-recent-product-card]');
    const ok = addDirectProductToCart(card);
    setAddedState(button, ok ? 'Pridané do košíka' : 'Produkt sa nepodarilo pridať');
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-account-add-recent-all]');
    if (!button) return;
    event.preventDefault();
    const cards = [...document.querySelectorAll('[data-recent-product-card]')];
    let added = 0;
    for (const card of cards) if (addDirectProductToCart(card)) added += 1;
    setAddedState(button, added ? 'Pridané do košíka' : 'Produkty sa nenašli');
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-recent-product]');
    if (!button) return;
    event.preventDefault();

    const card = button.closest('[data-recent-product-card]');
    const key = card?.dataset.recentKey || '';
    if (!card || !key) return;

    await fetch('/api/account/hide-recent-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key }),
    }).catch(() => null);

    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';
    setTimeout(() => {
      card.remove();
      const remaining = document.querySelectorAll('[data-recent-product-card]').length;
      const panel = document.querySelector('[data-recent-products-panel]');
      if (panel && !remaining) {
        const grid = panel.querySelector('.quick-products-grid');
        grid?.remove();
        panel.insertAdjacentHTML('beforeend', '<div class="account-empty-box"><strong>Zatiaľ tu nemáte žiadne produkty.</strong><p>Po prvej objednávke sa tu zobrazia produkty pre rýchle opakovanie nákupu.</p></div>');
      }
    }, 180);
  });

  const addPrinterForm = document.querySelector('[data-add-printer-form]');
  const printerInput = document.querySelector('[data-printer-search-input]');
  const suggestionsBox = document.querySelector('[data-printer-suggestions]');
  const selectedPrinterInput = document.querySelector('[data-selected-printer-title]');
  const printerMessage = document.querySelector('[data-printer-form-message]');
  const savedPrintersList = document.querySelector('[data-saved-printers-list]');
  let printerSearchTimer = null;
  let activePrinterSuggestions = [];

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showPrinterMessage(text, type = 'error') {
    if (!printerMessage) return;
    printerMessage.hidden = false;
    printerMessage.textContent = text;
    printerMessage.dataset.type = type;
  }

  function hidePrinterMessage() {
    if (!printerMessage) return;
    printerMessage.hidden = true;
    printerMessage.textContent = '';
  }

  function printerBrandFromTitle(title) {
    const text = normalize(title);
    if (text.includes('hewlett') || /(^|\s)hp(\s|$)/.test(text)) return 'HP';
    const brands = ['Canon', 'Brother', 'Epson', 'Xerox', 'Samsung', 'Lexmark', 'Kyocera', 'OKI', 'Ricoh', 'Konica Minolta'];
    return brands.find((brand) => text.includes(normalize(brand))) || '';
  }

  function renderSuggestions(printers = []) {
    if (!suggestionsBox) return;
    activePrinterSuggestions = printers;

    if (!printers.length) {
      suggestionsBox.hidden = true;
      suggestionsBox.innerHTML = '';
      return;
    }

    suggestionsBox.innerHTML = printers.slice(0, 10).map((printer, index) => {
      const title = String(printer.title || '').trim();
      const brand = printer.brand || printerBrandFromTitle(title);
      const count = Number(printer.product_count || printer.productCount || 0);
      return `
        <button type="button" class="printer-suggestion" data-printer-index="${index}">
          <span class="printer-suggestion-main">
            <strong>${escapeHtml(title)}</strong>
            ${brand ? `<small>${escapeHtml(brand)}</small>` : ''}
          </span>
          <span class="printer-suggestion-count">${count > 0 ? `${count} produktov` : 'Náplne'}</span>
        </button>
      `;
    }).join('');
    suggestionsBox.hidden = false;
  }

  function uniquePrinters(items = []) {
    const map = new Map();
    for (const item of items) {
      const title = String(item?.title || '').trim();
      if (!title) continue;
      const key = normalize(title).replace(/[^a-z0-9]+/g, '');
      if (map.has(key)) continue;
      map.set(key, {
        title,
        brand: item.brand || printerBrandFromTitle(title),
        product_count: Number(item.product_count || item.productCount || 0),
        url: item.url || `/produkty?printer=${encodeURIComponent(title)}`,
      });
    }
    return [...map.values()];
  }

  async function searchPrinters(query) {
    const q = String(query || '').trim();
    selectedPrinterInput && (selectedPrinterInput.value = '');
    if (q.length < 2) {
      renderSuggestions([]);
      return;
    }

    const response = await fetch(`/api/smart-search?q=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/json' },
    }).catch(() => null);

    if (!response?.ok) {
      renderSuggestions([]);
      return;
    }

    const data = await response.json().catch(() => ({}));
    renderSuggestions(uniquePrinters(Array.isArray(data.printers) ? data.printers : []));
  }

  printerInput?.addEventListener('input', () => {
    hidePrinterMessage();
    clearTimeout(printerSearchTimer);
    printerSearchTimer = setTimeout(() => searchPrinters(printerInput.value), 180);
  });

  printerInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const first = activePrinterSuggestions[0];
    if (!first || selectedPrinterInput?.value) return;
    event.preventDefault();
    printerInput.value = first.title;
    if (selectedPrinterInput) selectedPrinterInput.value = first.title;
    suggestionsBox && (suggestionsBox.hidden = true);
  });

  suggestionsBox?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-printer-index]');
    if (!item) return;
    const printer = activePrinterSuggestions[Number(item.dataset.printerIndex || 0)];
    const title = printer?.title || '';
    if (!title) return;
    if (printerInput) printerInput.value = title;
    if (selectedPrinterInput) selectedPrinterInput.value = title;
    suggestionsBox.hidden = true;
  });

  document.addEventListener('click', (event) => {
    if (!suggestionsBox || suggestionsBox.hidden) return;
    if (event.target.closest('[data-printer-suggestions]') || event.target.closest('[data-printer-search-input]')) return;
    suggestionsBox.hidden = true;
  });

  function savedPrinterEmptyHtml() {
    return `
      <div class="account-empty-box" data-no-printers-box>
        <strong>Nemáte uloženú žiadnu tlačiareň.</strong>
        <p>Pridajte si model tlačiarne a nabudúce nájdete správne náplne rýchlejšie.</p>
      </div>
    `;
  }

  function renderSavedPrinter(printer) {
    const title = String(printer?.title || '').trim();
    if (!title || !savedPrintersList) return;
    const empty = savedPrintersList.querySelector('[data-no-printers-box]');
    empty?.remove();

    const brand = printer.brand || printerBrandFromTitle(title);
    const count = Number(printer.product_count || 0);
    const url = printer.url || `/produkty?printer=${encodeURIComponent(title)}`;

    const article = document.createElement('article');
    article.className = 'saved-printer-mini';
    article.setAttribute('data-saved-printer-card', '');
    article.dataset.printerTitle = title;
    article.innerHTML = `
      <div class="saved-printer-mini-icon" aria-hidden="true">▤</div>
      <div class="saved-printer-mini-body">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml([brand, count > 0 ? `${count} kompatibilných produktov` : 'Kompatibilné náplne'].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="saved-printer-mini-actions">
        <a class="account-link-pill is-small" href="${escapeHtml(url)}">Zobraziť náplne</a>
        <button class="tm-btn is-danger-soft is-small" type="button" data-remove-saved-printer>Odstrániť</button>
      </div>
    `;
    savedPrintersList.prepend(article);
  }

  addPrinterForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    hidePrinterMessage();

    const title = selectedPrinterInput?.value || printerInput?.value || '';
    const submit = addPrinterForm.querySelector('button[type="submit"]');
    if (submit) setLoadingState(submit);

    const response = await fetch('/api/account/saved-printers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => null);

    if (submit) clearLoadingState(submit);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok || !data?.ok) {
      showPrinterMessage(data?.error || 'Model tlačiarne sa nepodarilo uložiť.');
      return;
    }

    const duplicate = [...(savedPrintersList?.querySelectorAll('[data-saved-printer-card]') || [])]
      .some((card) => normalize(card.dataset.printerTitle) === normalize(data.printer.title));
    if (!duplicate) renderSavedPrinter(data.printer);
    addPrinterForm.reset();
    if (selectedPrinterInput) selectedPrinterInput.value = '';
    renderSuggestions([]);
    showPrinterMessage('Tlačiareň bola uložená.', 'success');
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-saved-printer]');
    if (!button) return;
    event.preventDefault();

    const card = button.closest('[data-saved-printer-card]');
    const title = card?.dataset.printerTitle || '';
    if (!card || !title) return;

    button.disabled = true;
    const response = await fetch('/api/account/saved-printers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => null);

    if (!response?.ok) {
      button.disabled = false;
      return;
    }

    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';
    setTimeout(() => {
      card.remove();
      if (savedPrintersList && !savedPrintersList.querySelector('[data-saved-printer-card]')) {
        savedPrintersList.innerHTML = savedPrinterEmptyHtml();
      }
    }, 180);
  });

  const addSavedProductForm = document.querySelector('[data-add-saved-product-form]');
  const productInput = document.querySelector('[data-product-search-input]');
  const productSuggestionsBox = document.querySelector('[data-product-suggestions]');
  const selectedProductIdInput = document.querySelector('[data-selected-product-id]');
  const selectedProductSkuInput = document.querySelector('[data-selected-product-sku]');
  const productMessage = document.querySelector('[data-product-form-message]');
  const savedProductsList = document.querySelector('[data-saved-products-list]');
  let productSearchTimer = null;
  let activeProductSuggestions = [];

  function showProductMessage(text, type = 'error') {
    if (!productMessage) return;
    productMessage.hidden = false;
    productMessage.textContent = text;
    productMessage.dataset.type = type;
  }

  function hideProductMessage() {
    if (!productMessage) return;
    productMessage.hidden = true;
    productMessage.textContent = '';
  }

  function formatEuro(value) {
    const number = Number(value || 0);
    if (!number) return '—';
    return new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' }).format(number);
  }

  function productKey(product) {
    return String(product?.id || product?.sku || product?.title || '').trim();
  }

  function productTypeClass(type, label = '') {
    const raw = `${type || ''} ${label || ''}`;
    const normalized = normalize(raw);
    if (
      normalized.includes('kompatibil') ||
      normalized.includes('compatible') ||
      normalized.includes('compat') ||
      normalized === 'k'
    ) return 'is-compatible';
    if (
      normalized.includes('original') ||
      normalized.includes('originalny') ||
      normalized.includes('originalne') ||
      normalized.includes('orig')
    ) return 'is-original';
    if (
      normalized.includes('renov') ||
      normalized.includes('repas') ||
      normalized.includes('reman') ||
      normalized.includes('recykl')
    ) return 'is-renovated';
    return '';
  }

  function productTypeText(type, label = '') {
    const cls = productTypeClass(type, label);
    if (cls === 'is-compatible') return 'Kompatibilný';
    if (cls === 'is-original') return 'Originálny';
    if (cls === 'is-renovated') return 'Renovovaný';
    return String(label || type || '').trim();
  }

  function productTypeSlug(type, label = '') {
    const cls = productTypeClass(type, label);
    if (cls === 'is-compatible') return 'compatible';
    if (cls === 'is-original') return 'original';
    if (cls === 'is-renovated') return 'renovated';
    return 'other';
  }

  function productGroupLabel(slug) {
    if (slug === 'compatible') return 'Kompatibilné';
    if (slug === 'original') return 'Originálne';
    if (slug === 'renovated') return 'Renovované';
    return 'Produkty';
  }

  function productGroupSubtitle(slug, count) {
    const label = count === 1 ? 'produkt' : count > 1 && count < 5 ? 'produkty' : 'produktov';
    return `${count} ${label} · zobraziť`;
  }

  function renderProductSuggestions(products = []) {
    if (!productSuggestionsBox) return;
    activeProductSuggestions = products;

    if (!products.length) {
      productSuggestionsBox.hidden = true;
      productSuggestionsBox.innerHTML = '';
      return;
    }

    const groups = [
      ['compatible', 'Kompatibilné'],
      ['original', 'Originálne'],
      ['renovated', 'Renovované'],
      ['other', 'Produkty'],
    ];

    const typed = new Map();
    for (const [slug] of groups) typed.set(slug, []);

    products.forEach((product, originalIndex) => {
      const slug = productTypeSlug(product.type || product.product_type_key || '', product.typeLabel || product.type_label || product.product_type_label || '');
      const target = typed.get(slug) ? slug : 'other';
      typed.get(target).push({ product, originalIndex });
    });

    const groupRows = groups.map(([slug]) => {
      const items = typed.get(slug) || [];
      if (!items.length) return '';
      return `
        <button type="button" class="tm-smart-group tm-smart-group--${slug} account-smart-group" data-product-index="${items[0].originalIndex}">
          <span class="tm-smart-group-dot"></span>
          <span>
            <strong>${escapeHtml(productGroupLabel(slug))} (${items.length})</strong>
            <small>${escapeHtml(productGroupSubtitle(slug, items.length))}</small>
          </span>
          <b>Vybrať</b>
        </button>
      `;
    }).join('');

    const productRows = products.slice(0, 14).map((product, originalIndex) => {
      const title = String(product.title || product.name || '').trim();
      const sku = String(product.sku || '').trim();
      const price = Number(product.price || 0);
      const type = product.type || product.product_type_key || '';
      const typeLabel = product.typeLabel || product.type_label || product.product_type_label || '';
      const image = product.image || '';
      const slug = productTypeSlug(type, typeLabel);
      const typeText = productTypeText(type, typeLabel);

      return `
        <button type="button" class="tm-smart-item tm-smart-item--${slug} account-smart-product-item" data-product-index="${originalIndex}">
          <span class="tm-smart-thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : '🧾'}</span>
          <span class="tm-smart-copy">
            <span>${escapeHtml(title)}</span>
            ${sku || typeText ? `<small>${escapeHtml([sku, typeText].filter(Boolean).join(' · '))}</small>` : ''}
          </span>
          <span class="tm-smart-side">
            ${typeText ? `<em class="tm-smart-type tm-smart-type--${slug}">${escapeHtml(typeText)}</em>` : ''}
            ${price ? `<span class="tm-smart-price"><strong>${formatEuro(price)}</strong></span>` : '<span class="tm-smart-arrow">›</span>'}
          </span>
        </button>
      `;
    }).join('');

    productSuggestionsBox.innerHTML = `
      <section class="tm-smart-section tm-smart-section--productGroups account-smart-product-groups">
        <h3>Nájdené typy produktov</h3>
        <div>${groupRows}</div>
      </section>
      <section class="tm-smart-section tm-smart-section--products account-smart-product-results">
        <h3>Produkty</h3>
        <div>${productRows}</div>
      </section>
    `;
    productSuggestionsBox.hidden = false;
  }

  function uniqueProducts(items = []) {
    const map = new Map();
    for (const item of items) {
      const title = String(item?.title || item?.name || '').trim();
      const key = String(item?.id || item?.sku || title).trim();
      if (!title || !key || map.has(key)) continue;
      map.set(key, {
        id: item.id,
        sku: item.sku || '',
        title,
        image: item.image || productImage(item),
        price: Number(item.price || item.regular_price || 0),
        type: item.type || item.product_type_key || '',
        typeLabel: item.typeLabel || item.type_label || item.product_type_label || '',
        url: item.url || item.detail_url || (item.slug ? `/produkt/${item.slug}` : `/produkty?s=${encodeURIComponent(item.sku || title)}`),
      });
    }
    return [...map.values()];
  }

  async function fetchProductSuggestions(query) {
    const q = String(query || '').trim();
    const all = [];

    const smartResponse = await fetch(`/api/smart-search?q=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/json' },
    }).catch(() => null);

    if (smartResponse?.ok) {
      const smartData = await smartResponse.json().catch(() => ({}));
      if (Array.isArray(smartData.products)) all.push(...smartData.products);
    }

    const productResponse = await fetch(`/api/products?search=${encodeURIComponent(q)}&per_page=24`, {
      headers: { Accept: 'application/json' },
    }).catch(() => null);

    if (productResponse?.ok) {
      const productData = await productResponse.json().catch(() => ({}));
      if (Array.isArray(productData.products)) all.push(...productData.products);
    }

    return uniqueProducts(all).slice(0, 12);
  }

  async function searchSavedProducts(query) {
    const q = String(query || '').trim();
    if (selectedProductIdInput) selectedProductIdInput.value = '';
    if (selectedProductSkuInput) selectedProductSkuInput.value = '';
    if (q.length < 2) {
      renderProductSuggestions([]);
      return;
    }

    const products = await fetchProductSuggestions(q);
    renderProductSuggestions(products);
  }

  productInput?.addEventListener('input', () => {
    hideProductMessage();
    clearTimeout(productSearchTimer);
    productSearchTimer = setTimeout(() => searchSavedProducts(productInput.value), 180);
  });

  productInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const first = activeProductSuggestions[0];
    if (!first || selectedProductIdInput?.value) return;
    event.preventDefault();
    productInput.value = first.title;
    if (selectedProductIdInput) selectedProductIdInput.value = first.id || '';
    if (selectedProductSkuInput) selectedProductSkuInput.value = first.sku || '';
    productSuggestionsBox && (productSuggestionsBox.hidden = true);
  });

  productSuggestionsBox?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-product-index]');
    if (!item) return;
    const product = activeProductSuggestions[Number(item.dataset.productIndex || 0)];
    if (!product?.title) return;
    if (productInput) productInput.value = product.title;
    if (selectedProductIdInput) selectedProductIdInput.value = product.id || '';
    if (selectedProductSkuInput) selectedProductSkuInput.value = product.sku || '';
    productSuggestionsBox.hidden = true;
  });

  document.addEventListener('click', (event) => {
    if (!productSuggestionsBox || productSuggestionsBox.hidden) return;
    if (event.target.closest('[data-product-suggestions]') || event.target.closest('[data-product-search-input]')) return;
    productSuggestionsBox.hidden = true;
  });

  function savedProductsEmptyHtml() {
    return `
      <div class="account-empty-box" data-no-saved-products-box>
        <strong>Nemáte uložený žiadny produkt.</strong>
        <p>Pridajte si toner, náplň alebo valec a ďalšiu objednávku vybavíte rýchlejšie.</p>
      </div>
    `;
  }

  function renderSavedProduct(product) {
    if (!savedProductsList) return;
    const key = productKey(product);
    const title = String(product?.title || '').trim();
    if (!key || !title) return;

    const type = product.type || product.product_type_key || '';
    const typeLabel = product.type_label || product.typeLabel || product.product_type_label || '';
    const typeClass = productTypeClass(type, typeLabel);
    const typeText = productTypeText(type, typeLabel);
    const price = Number(product.price || 0);
    const image = product.image || '';
    const url = product.url || `/produkty?s=${encodeURIComponent(product.sku || title)}`;

    const empty = savedProductsList.querySelector('[data-no-saved-products-box]');
    empty?.remove();

    const article = document.createElement('article');
    article.className = `saved-product-card ${typeClass}`.trim();
    article.setAttribute('data-saved-product-card', '');
    article.dataset.productKey = key;
    article.dataset.productName = title;
    article.dataset.productSku = product.sku || product.id || '';
    article.dataset.productPrice = String(price || 0);
    article.dataset.productUrl = url;
    article.dataset.productImage = image;
    article.innerHTML = `
      <div class="saved-product-image-wrap">
        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy">` : '<span>▧</span>'}
      </div>
      <div class="saved-product-body">
        ${typeText ? `<em class="account-product-type ${typeClass}">${escapeHtml(typeText)}</em>` : ''}
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml([product.sku, typeLabel].filter(Boolean).join(' · '))}</span>
        <b>${formatEuro(price)}</b>
      </div>
      <div class="saved-product-actions">
        <a class="account-link-pill is-small" href="${escapeHtml(url)}">Zobraziť</a>
        <button class="tm-btn is-green is-small" type="button" data-add-saved-product-to-cart>Objednať</button>
        <button class="tm-btn is-danger-soft is-small" type="button" data-remove-saved-product>Odstrániť</button>
      </div>
    `;
    savedProductsList.prepend(article);
  }

  addSavedProductForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideProductMessage();

    const submit = addSavedProductForm.querySelector('button[type="submit"]');
    if (submit) setLoadingState(submit);

    const body = {
      id: selectedProductIdInput?.value || '',
      sku: selectedProductSkuInput?.value || '',
      title: productInput?.value || '',
    };

    const response = await fetch('/api/account/saved-products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (submit) clearLoadingState(submit);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok || !data?.ok) {
      showProductMessage(data?.error || 'Produkt sa nepodarilo uložiť.');
      return;
    }

    const key = productKey(data.product);
    const duplicate = [...(savedProductsList?.querySelectorAll('[data-saved-product-card]') || [])]
      .some((card) => normalize(card.dataset.productKey) === normalize(key));
    if (!duplicate) renderSavedProduct(data.product);
    addSavedProductForm.reset();
    if (selectedProductIdInput) selectedProductIdInput.value = '';
    if (selectedProductSkuInput) selectedProductSkuInput.value = '';
    renderProductSuggestions([]);
    showProductMessage('Produkt bol uložený.', 'success');
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-add-saved-product-to-cart]');
    if (!button) return;
    event.preventDefault();

    const card = button.closest('[data-saved-product-card]');
    const cartApi = window.ToneryMaximCart;
    const price = Number(card?.dataset.productPrice || 0);
    const sku = card?.dataset.productSku || card?.dataset.productKey || '';
    const name = card?.dataset.productName || 'Produkt';
    const url = card?.dataset.productUrl || `/produkty?s=${encodeURIComponent(sku || name)}`;
    const image = card?.dataset.productImage || '';

    if (!cartApi || typeof cartApi.addToCart !== 'function' || !sku || !price) {
      setAddedState(button, 'Produkt sa nepodarilo pridať');
      return;
    }

    const cartProduct = { sku, name, price, image, url, qty: 1 };
    cartApi.addToCart(cartProduct);
    if (typeof cartApi.showAddCartDrawer === 'function') cartApi.showAddCartDrawer(cartProduct);
    setAddedState(button, 'Pridané do košíka');
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-saved-product]');
    if (!button) return;
    event.preventDefault();

    const card = button.closest('[data-saved-product-card]');
    const key = card?.dataset.productKey || '';
    if (!card || !key) return;

    button.disabled = true;
    const response = await fetch('/api/account/saved-products', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: key, sku: card.dataset.productSku || '', title: card.dataset.productName || '' }),
    }).catch(() => null);

    if (!response?.ok) {
      button.disabled = false;
      return;
    }

    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';
    setTimeout(() => {
      card.remove();
      if (savedProductsList && !savedProductsList.querySelector('[data-saved-product-card]')) {
        savedProductsList.innerHTML = savedProductsEmptyHtml();
      }
    }, 180);
  });

})();
