(() => {
  const TM_PRODUCT_PLACEHOLDER_IMAGE = "/images/tm-product-placeholder-box.jpg";

  let tmLoyalty = { ok: false, points: 0, discountValue: 0 };
  let tmLoyaltyApply = localStorage.getItem("tm_loyalty_apply") === "1";
  let tmCoupon = (() => { try { return JSON.parse(localStorage.getItem("tm_coupon_v1") || "null") || null; } catch { return null; } })();

  async function loadLoyalty() {
    try {
      const response = await fetch("/api/account/loyalty", { credentials: "same-origin" });
      if (!response.ok) throw new Error("not logged");
      const data = await response.json();
      tmLoyalty = { ok: true, points: Number(data.points || 0), discountValue: Number(data.discountValue || 0) };
      if (tmLoyalty.discountValue <= 0) tmLoyaltyApply = false;
      renderCartPage();
    } catch {
      tmLoyalty = { ok: false, points: 0, discountValue: 0 };
      tmLoyaltyApply = false;
    }
  }

  function loyaltyDiscountForTotal(total) {
    if (!tmLoyaltyApply || !tmLoyalty.ok) return 0;
    return Math.min(Number(tmLoyalty.discountValue || 0), Math.max(0, Number(total || 0)));
  }


  function couponDiscountForTotal(total) {
    if (!tmCoupon || !tmCoupon.ok) return 0;
    const discount = Number(tmCoupon.discount || 0);
    return Math.min(Number.isFinite(discount) ? discount : 0, Math.max(0, Number(total || 0)));
  }

  async function validateCouponCode(code) {
    const clean = String(code || "").trim();
    if (!clean) {
      tmCoupon = null;
      localStorage.removeItem("tm_coupon_v1");
      renderCartPage();
      return;
    }
    try {
      const response = await fetch("/api/coupon-validate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clean, cart: readCart() }),
      });
      const data = await response.json().catch(() => ({}));
      tmCoupon = data;
      localStorage.setItem("tm_coupon_v1", JSON.stringify(data));
      renderCartPage();
    } catch {
      tmCoupon = { ok: false, code: clean, reason: "Kupón sa nepodarilo overiť." };
      localStorage.setItem("tm_coupon_v1", JSON.stringify(tmCoupon));
      renderCartPage();
    }
  }


  async function autoLoadBestCoupon() {
    const cart = readCart();
    if (!cart.length) return;
    try {
      const response = await fetch("/api/coupon-active", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart }),
      });
      const data = await response.json().catch(() => ({}));
      if (data?.ok && data.code) {
        // Kupón načítavame vždy nanovo, aj keď je kód rovnaký.
        // Pri zmene košíka sa totiž mení výška zľavy.
        tmCoupon = data;
        localStorage.setItem("tm_coupon_v1", JSON.stringify(data));
        renderCartPage();
      } else if (tmCoupon?.ok) {
        // Ak uložený kupón už nie je aktívny/použiteľný, vyčisti ho.
        tmCoupon = null;
        localStorage.removeItem("tm_coupon_v1");
        renderCartPage();
      }
    } catch {
      // bez tichej chyby, ručné zadanie kupónu zostáva funkčné
    }
  }

  const TM_GENERIC_IMAGE_PATTERNS = [
    "toner-coloriq-kompatible.png",
    "toner-coloriq-renovacie.png",
    "drum-compatible.png",
    "image-coming-soon",
    "no-image",
    "placeholder",
  ];

  function productImageSrc(value) {
    const url = String(value || "").trim();
    if (!url) return TM_PRODUCT_PLACEHOLDER_IMAGE;
    const lower = url.toLowerCase();
    return TM_GENERIC_IMAGE_PATTERNS.some((pattern) => lower.includes(pattern)) ? TM_PRODUCT_PLACEHOLDER_IMAGE : url;
  }

  if (window.__TM_CART_INIT__) return;
  window.__TM_CART_INIT__ = true;

  const CART_KEY = "tm_cart_v1";

  function readCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    refreshCartCounters();
  }

  function cleanQty(value) {
    const number = parseInt(value, 10);
    if (!Number.isFinite(number) || number < 1) return 1;
    if (number > 99) return 99;
    return number;
  }


  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function productUrl(item) {
    const url = String(item?.url || item?.detail_url || "").trim();
    if (url && url !== "#") return url;
    const slug = String(item?.slug || "").trim();
    if (slug) return `/produkt/${encodeURIComponent(slug)}`;
    return "/produkty";
  }

  function firstFilled(...values) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text && text.toLowerCase() !== "neuvedené") return text;
    }
    return "";
  }

  function productCapacity(product) {
    return firstFilled(product?.capacity, product?.kapacita, product?.yield, product?.page_yield, product?.pageYield, product?.pages, product?.ml, product?.volume);
  }

  function mergeProductData(item, product) {
    if (!product) return item;
    return {
      ...item,
      id: item.id || product.id || "",
      sku: item.sku || product.sku || "",
      name: item.name || product.name || "Produkt",
      price: Number(item.price || product.price || 0),
      image: item.image || product.image || "",
      url: productUrl({ ...product, url: item.url || product.detail_url }),
      slug: item.slug || product.slug || "",
      product_type_key: item.product_type_key || product.product_type_key || "",
      product_type_label: item.product_type_label || product.product_type_label || product.product_type_detail_label || "",
      color: firstFilled(item.color, item.farba, product.color),
      capacity: productCapacity(item) || productCapacity(product),
      warranty: firstFilled(item.warranty, item.zaruka) || "24 mesiacov",
      stock_status: product.stock_status || item.stock_status || "instock",
      stock_quantity: product.stock_quantity ?? item.stock_quantity ?? null,
      stock_text: product.stock_text || item.stock_text || "",
    };
  }

  function findProductInSessionCache(sku) {
    const wanted = String(sku || "").trim();
    if (!wanted) return null;
    try {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (!key || (!key.startsWith("tm_catalog_v3") && !key.startsWith("tm_product_detail_v1:"))) continue;
        const raw = sessionStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const products = Array.isArray(parsed?.data?.products) ? parsed.data.products : (parsed?.product ? [parsed.product] : []);
        const match = products.find((product) => String(product?.sku || "").trim() === wanted);
        if (match) return match;
      }
    } catch {
      return null;
    }
    return null;
  }

  async function fetchProductBySku(sku) {
    const wanted = String(sku || "").trim();
    if (!wanted) return null;
    try {
      const response = await fetch(`/api/products?search=${encodeURIComponent(wanted)}&per_page=24`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok || !Array.isArray(data.products)) return null;
      return data.products.find((product) => String(product?.sku || "").trim() === wanted) || data.products[0] || null;
    } catch {
      return null;
    }
  }

  async function hydrateCartProducts() {
    const cart = readCart();
    if (!cart.length) return false;

    let changed = false;
    const hydrated = [];

    for (const item of cart) {
      const needsData = !productCapacity(item) || !item.url || item.url === "#" || !item.stock_text || !item.stock_quantity;
      let product = findProductInSessionCache(item.sku);
      if (needsData && !product) product = await fetchProductBySku(item.sku);

      const merged = product ? mergeProductData(item, product) : { ...item, url: productUrl(item), capacity: productCapacity(item) };
      hydrated.push(merged);

      if (JSON.stringify(merged) !== JSON.stringify(item)) changed = true;
    }

    if (changed) saveCart(hydrated);
    return changed;
  }

  function inferColor(item) {
    const direct = String(item?.color || item?.farba || "").trim();
    if (direct) return direct;
    const text = `${item?.sku || ""} ${item?.name || ""}`.toLowerCase();
    if (/cmyk|multipack/.test(text)) return "CMYK";
    if (/cf54[0123]|203a/.test(text)) {
      if (/cf540/.test(text)) return "čierna";
      if (/cf541/.test(text)) return "azúrová";
      if (/cf542/.test(text)) return "žltá";
      if (/cf543/.test(text)) return "purpurová";
    }
    if (/\b(bk|black|čierna|cierna)\b/.test(text)) return "čierna";
    if (/\b(c|cyan|azúrová|azurova)\b/.test(text)) return "azúrová";
    if (/\b(m|magenta|purpurová|purpurova)\b/.test(text)) return "purpurová";
    if (/\b(y|yellow|žltá|zlta)\b/.test(text)) return "žltá";
    return "Neuvedené";
  }

  function inferCapacity(item) {
    return productCapacity(item) || "Neuvedené";
  }

  function stockText(item) {
    if (item?.stock_text) return String(item.stock_text);
    if (item?.stock_status === "instock") {
      if (item.stock_quantity !== null && item.stock_quantity !== undefined && item.stock_quantity !== "") return `Skladom ${item.stock_quantity} ks`;
      return "Skladom";
    }
    if (item?.stock_status === "onbackorder") return "Na objednávku";
    if (item?.stock_status === "outofstock") return "Nie je skladom";
    return "Skladom";
  }

  function stockClass(item) {
    if (item?.stock_status === "outofstock") return "is-outofstock";
    if (item?.stock_status === "onbackorder") return "is-backorder";
    return "is-instock";
  }

  function cartItemMetaHtml(item) {
    const warranty = String(item?.warranty || item?.zaruka || "24 mesiacov").trim();
    return `
      <div class="cart-item-meta" aria-label="Parametre produktu">
        <span>Farba: <strong>${esc(inferColor(item))}</strong></span>
        <span>Kapacita: <strong>${esc(inferCapacity(item))}</strong></span>
        <span>Záruka: <strong>${esc(warranty)}</strong></span>
        <span class="cart-stock ${stockClass(item)}"><i></i>${esc(stockText(item))}</span>
      </div>
    `;
  }

  const VAT_RATE = 0.23;

function netFromGross(value) {
  const number = Number(value || 0);
  return Math.round((number / (1 + VAT_RATE)) * 100) / 100;
}

function vatFromGross(value) {
  const number = Number(value || 0);
  return Math.round((number - netFromGross(number)) * 100) / 100;
}

function formatMoney(value) {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function cartCount(cart = readCart()) {
    return cart.reduce((sum, item) => sum + cleanQty(item.qty), 0);
  }

  function cartTotal(cart = readCart()) {
    return cart.reduce((sum, item) => {
      return sum + Number(item.price || 0) * cleanQty(item.qty);
    }, 0);
  }

  function isCompatibleDiscountItem(item) {
    const type = String(item?.product_type_key || item?.productTypeKey || "").toLowerCase();
    const label = String(item?.product_type_label || item?.productTypeLabel || item?.name || "").toLowerCase();
    return type === "compatible" || label.includes("kompatibil");
  }

  function quantityDiscountRate(item) {
    if (!isCompatibleDiscountItem(item)) return 0;
    const qty = cleanQty(item.qty);
    if (qty >= 4) return 0.25;
    if (qty >= 2) return 0.10;
    return 0;
  }

  function normalizeSeriesText(value) {
    return String(value || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]/g, "");
  }

  function seriesText(item) {
    return `${item?.sku || ""} ${item?.name || ""} ${item?.series_pack_key || ""} ${item?.series_pack_label || ""}`;
  }

  function seriesColorKey(item) {
    const compact = normalizeSeriesText(seriesText(item));
    const readable = String(seriesText(item) || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, " ");

    let match = compact.match(/W\d{3}([0-3])A?/);
    if (match) return { "0": "black", "1": "cyan", "2": "yellow", "3": "magenta" }[match[1]] || "";

    match = compact.match(/(?:CF|CE|CB)\d{2}([0-3])(?:A|X|XC|YC|AC)?/);
    if (match) return { "0": "black", "1": "cyan", "2": "yellow", "3": "magenta" }[match[1]] || "";

    match = compact.match(/(?:TN|LC|BU|WT|CRG|CLI|PGI|PG|CL|T)\d{2,5}(BK|BLACK|C|CYAN|M|MAGENTA|Y|YELLOW|K)/);
    if (match) {
      const suffix = match[1];
      if (suffix === "BK" || suffix === "BLACK" || suffix === "K") return "black";
      if (suffix === "C" || suffix === "CYAN") return "cyan";
      if (suffix === "M" || suffix === "MAGENTA") return "magenta";
      if (suffix === "Y" || suffix === "YELLOW") return "yellow";
    }

    if (/(BK|BLACK|CIERNA|K)$/.test(compact) || /\b(BK|BLACK|CIERNA|CIERNA)\b/.test(readable)) return "black";
    if (/(C|CYAN)$/.test(compact) || /\b(C|CYAN|AZUROVA|AZUROVA|MODRA)\b/.test(readable)) return "cyan";
    if (/(M|MAGENTA)$/.test(compact) || /\b(M|MAGENTA|PURPUROVA|PURPUROVA)\b/.test(readable)) return "magenta";
    if (/(Y|YELLOW)$/.test(compact) || /\b(Y|YELLOW|ZLTA|ZLTA)\b/.test(readable)) return "yellow";
    return "";
  }

  function seriesBaseKey(item) {
    if (item?.series_pack_key) return normalizeSeriesText(item.series_pack_key);
    const compact = normalizeSeriesText(seriesText(item));

    let match = compact.match(/(W\d{3})[0-3]A?/);
    if (match) return match[1];

    match = compact.match(/((?:CF|CE|CB)\d{2})[0-3](?:A|X|XC|YC|AC)?/);
    if (match) return match[1];

    match = compact.match(/((?:TN|LC|BU|WT|CRG|CLI|PGI|PG|CL|T)\d{2,5})(?:BK|BLACK|C|CYAN|M|MAGENTA|Y|YELLOW|K)/);
    if (match) return match[1];

    return "";
  }

  function seriesPackDiscount(cart) {
    const groups = new Map();
    (cart || []).forEach((item) => {
      const base = seriesBaseKey(item);
      const color = seriesColorKey(item);
      if (!base || !color) return;
      if (!groups.has(base)) groups.set(base, new Map());
      const byColor = groups.get(base);
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push(item);
    });

    let discount = 0;
    groups.forEach((byColor) => {
      const required = ["black", "cyan", "magenta", "yellow"];
      if (!required.every((color) => byColor.has(color))) return;

      const colorLines = required.map((color) => {
        const items = byColor.get(color) || [];
        const qty = items.reduce((sum, item) => sum + cleanQty(item.qty), 0);
        const total = items.reduce((sum, item) => sum + Number(item.price || 0) * cleanQty(item.qty), 0);
        return { qty, unit: total / Math.max(1, qty) };
      });

      const setQty = Math.min(...colorLines.map((line) => line.qty));
      if (setQty < 1) return;
      const oneSetTotal = colorLines.reduce((sum, line) => sum + Number(line.unit || 0), 0);
      discount += Math.round(oneSetTotal * setQty * 0.05 * 100) / 100;
    });

    return Math.round(discount * 100) / 100;
  }

  function cartPricing(cart = readCart()) {
    const totals = (cart || []).reduce((acc, item) => {
      const qty = cleanQty(item.qty);
      const lineOriginal = Number(item.price || 0) * qty;
      const rate = quantityDiscountRate(item);
      const lineDiscount = Math.round(lineOriginal * rate * 100) / 100;
      acc.subtotal += lineOriginal;
      acc.discount += lineDiscount;
      return acc;
    }, { subtotal: 0, discount: 0 });

    totals.discount = Math.round((totals.discount + seriesPackDiscount(cart || [])) * 100) / 100;
    return totals;
  }

  function cartDiscountedTotal(cart = readCart()) {
    const totals = cartPricing(cart);
    return Math.max(0, totals.subtotal - totals.discount);
  }

  function addToCart(product) {
    const cart = readCart();
    const sku = String(product.sku || "").trim();

    if (!sku) return;

    const existing = cart.find((item) => item.sku === sku);

    if (existing) {
      existing.qty = cleanQty(existing.qty) + cleanQty(product.qty || 1);
      if (!existing.product_type_key && (product.product_type_key || product.productTypeKey || product.type)) {
        existing.product_type_key = product.product_type_key || product.productTypeKey || product.type || "";
      }
      if (!existing.product_type_label && (product.product_type_label || product.productTypeLabel)) {
        existing.product_type_label = product.product_type_label || product.productTypeLabel || "";
      }
      if (product.series_pack_key || product.seriesPackKey) existing.series_pack_key = product.series_pack_key || product.seriesPackKey || existing.series_pack_key || "";
      if (product.series_pack_label || product.seriesPackLabel) existing.series_pack_label = product.series_pack_label || product.seriesPackLabel || existing.series_pack_label || "";
      if (product.series_pack_discount_rate || product.seriesPackDiscountRate) existing.series_pack_discount_rate = Number(product.series_pack_discount_rate || product.seriesPackDiscountRate || existing.series_pack_discount_rate || 0);
      existing.url = productUrl({ ...existing, url: existing.url || product.url || product.detail_url });
      existing.slug = existing.slug || product.slug || "";
      existing.color = firstFilled(existing.color, existing.farba, product.color, product.farba);
      existing.capacity = productCapacity(existing) || productCapacity(product);
      existing.warranty = existing.warranty || product.warranty || product.zaruka || "24 mesiacov";
      existing.stock_status = product.stock_status || existing.stock_status || "instock";
      existing.stock_quantity = product.stock_quantity ?? existing.stock_quantity ?? null;
      existing.stock_text = product.stock_text || existing.stock_text || "";
    } else {
      cart.push({
        sku,
        name: product.name || "Produkt",
        price: Number(product.price || 0),
        image: product.image || "",
        url: productUrl(product),
        slug: product.slug || "",
        qty: cleanQty(product.qty || 1),
        product_type_key: product.product_type_key || product.productTypeKey || product.type || "",
        product_type_label: product.product_type_label || product.productTypeLabel || "",
        series_pack_key: product.series_pack_key || product.seriesPackKey || "",
        series_pack_label: product.series_pack_label || product.seriesPackLabel || "",
        series_pack_discount_rate: Number(product.series_pack_discount_rate || product.seriesPackDiscountRate || 0),
        color: product.color || product.farba || "",
        capacity: productCapacity(product),
        warranty: product.warranty || product.zaruka || "24 mesiacov",
        stock_status: product.stock_status || "instock",
        stock_quantity: product.stock_quantity ?? null,
        stock_text: product.stock_text || "",
      });
    }

    saveCart(cart);
  }

  let addCartDrawerTimer = null;

  function ensureAddCartDrawer() {
    let drawer = document.querySelector('[data-add-cart-drawer]');
    if (drawer) return drawer;

    drawer = document.createElement('div');
    drawer.className = 'add-cart-drawer';
    drawer.dataset.addCartDrawer = '';
    drawer.hidden = true;
    drawer.innerHTML = `
      <div class="add-cart-backdrop" data-add-cart-close></div>
      <aside class="add-cart-panel" role="dialog" aria-modal="true" aria-labelledby="add-cart-title">
        <button class="add-cart-close" type="button" data-add-cart-close aria-label="Zavrieť">×</button>
        <div class="add-cart-status" data-add-cart-status></div>
        <div class="add-cart-product" data-add-cart-product></div>
        <div class="add-cart-summary" data-add-cart-summary></div>
        <div class="add-cart-actions">
          <a class="btn-primary" href="/pokladna">Do pokladne</a>
          <a class="btn-secondary" href="/kosik">Do košíka</a>
          <button class="btn-link" type="button" data-add-cart-close>Pokračovať v nákupe</button>
        </div>
      </aside>
    `;
    document.body.appendChild(drawer);
    drawer.addEventListener('click', (event) => {
      if (event.target.closest('[data-add-cart-close]')) hideAddCartDrawer();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideAddCartDrawer();
    });
    return drawer;
  }

  function hideAddCartDrawer() {
    const drawer = document.querySelector('[data-add-cart-drawer]');
    if (!drawer) return;
    if (addCartDrawerTimer) window.clearTimeout(addCartDrawerTimer);
    addCartDrawerTimer = null;
    drawer.classList.remove('is-open');
    document.body.classList.remove('has-add-cart-drawer');
    window.setTimeout(() => {
      if (!drawer.classList.contains('is-open')) drawer.hidden = true;
    }, 240);
  }

  function addCartMetaRows(item) {
    const rows = [];
    const type = firstFilled(item?.product_type_label, item?.productTypeLabel);
    const color = inferColor(item);
    const capacity = inferCapacity(item);
    const stock = stockText(item);

    if (type) rows.push(`<span>${esc(type)}</span>`);
    if (color && color !== 'Neuvedené') rows.push(`<span>Farba: <strong>${esc(color)}</strong></span>`);
    if (capacity && capacity !== 'Neuvedené') rows.push(`<span>Kapacita: <strong>${esc(capacity)}</strong></span>`);
    if (stock) rows.push(`<span class="cart-stock ${stockClass(item)}"><i></i>${esc(stock)}</span>`);

    return rows.length ? `<div class="add-cart-meta">${rows.join('')}</div>` : '';
  }

  function showAddCartDrawer(product) {
    const drawer = ensureAddCartDrawer();
    const cart = readCart();
    const sku = String(product?.sku || '').trim();
    const item = cart.find((cartItem) => String(cartItem.sku || '').trim() === sku) || product || cart[cart.length - 1] || {};
    const pricing = cartPricing(cart);
    const total = Math.max(0, pricing.subtotal - pricing.discount);
    const missingFreeShipping = Math.max(0, 29 - total);
    const itemGross = Number(item.price || 0);
    const itemNet = netFromGross(itemGross);
    const count = cartCount(cart);

    const statusEl = drawer.querySelector('[data-add-cart-status]');
    if (statusEl) {
      statusEl.innerHTML = `
        <strong>Produkt bol pridaný do košíka</strong>
      `;
      statusEl.classList.toggle('is-free', missingFreeShipping <= 0);
    }

    const productEl = drawer.querySelector('[data-add-cart-product]');
    if (productEl) {
      productEl.innerHTML = `
        <div class="add-cart-thumb">
          <img src="${esc(productImageSrc(item.image))}" alt="${esc(item.name || 'Produkt')}" />
        </div>
        <div class="add-cart-product-info">
          <h2 id="add-cart-title">${esc(item.name || 'Produkt')}</h2>
          ${addCartMetaRows(item)}
          <div class="add-cart-pricebox">
            <strong>${formatMoney(itemGross)}</strong>
            <span>s DPH</span>
          </div>
        </div>
      `;
    }

    const summaryEl = drawer.querySelector('[data-add-cart-summary]');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div><span>V košíku</span><strong>${count} ${count === 1 ? 'produkt' : count > 1 && count < 5 ? 'produkty' : 'produktov'}</strong></div>
        <div><span>Spolu</span><strong>${formatMoney(total)} s DPH</strong></div>
        <p class="${missingFreeShipping <= 0 ? 'is-free' : ''}">${missingFreeShipping <= 0 ? 'Dopravu máte zdarma' : `Do dopravy zdarma chýba ${formatMoney(missingFreeShipping)}`}</p>
      `;
    }


    if (addCartDrawerTimer) window.clearTimeout(addCartDrawerTimer);
    drawer.hidden = false;
    document.body.classList.add('has-add-cart-drawer');
    window.requestAnimationFrame(() => drawer.classList.add('is-open'));
    addCartDrawerTimer = window.setTimeout(() => hideAddCartDrawer(), 10000);
  }

  function updateQty(sku, qty) {
    const cart = readCart().map((item) => {
      if (item.sku === sku) {
        return { ...item, qty: cleanQty(qty) };
      }
      return item;
    });

    saveCart(cart);
  }

  function removeFromCart(sku) {
    saveCart(readCart().filter((item) => item.sku !== sku));
  }

  function clearCart() {
    saveCart([]);
  }

  function refreshCartCounters() {
    const count = cartCount();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = String(count);
    });
  }

  function renderCartPage() {
    const list = document.querySelector("[data-cart-list]");
    const empty = document.querySelector("[data-cart-empty]");
    const summary = document.querySelector("[data-cart-summary]");
    const mobileSticky = document.querySelector("[data-cart-mobile-sticky]");
    const mobileTotalEl = document.querySelector("[data-cart-mobile-total]");
    const subtotalEl = document.querySelector("[data-cart-subtotal]");
    const netEl = document.querySelector("[data-cart-net]");
    const vatEl = document.querySelector("[data-cart-vat]");
    const totalEl = document.querySelector("[data-cart-total]");

    if (!list) return;

    const cart = readCart();
    list.innerHTML = "";

    if (cart.length === 0) {
      if (empty) empty.hidden = false;
      if (summary) summary.hidden = true;
      if (mobileSticky) mobileSticky.hidden = true;
      refreshCartCounters();
      return;
    }

    if (empty) empty.hidden = true;
    if (summary) summary.hidden = false;
    if (mobileSticky) mobileSticky.hidden = false;

    cart.forEach((item) => {
      const qty = cleanQty(item.qty);
      const itemTotal = Number(item.price || 0) * qty;
      const itemDiscountRate = quantityDiscountRate(item);
      const itemDiscount = Math.round(itemTotal * itemDiscountRate * 100) / 100;
      const itemFinal = Math.max(0, itemTotal - itemDiscount);

      const row = document.createElement("article");
      row.className = "cart-item";
      row.dataset.sku = item.sku;

      row.innerHTML = `
        <a class="cart-item-image" href="${esc(productUrl(item))}">
          ${
            item.image
              ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" />`
              : `<img src="${esc(TM_PRODUCT_PLACEHOLDER_IMAGE)}" alt="${esc(item.name)}" />`
          }
        </a>

        <div class="cart-item-main">
          <a class="cart-item-title" href="${esc(productUrl(item))}">${esc(item.name)}</a>
          <div class="cart-item-sku">SKU: ${esc(item.sku)}</div>
          ${cartItemMetaHtml(item)}
          <button class="cart-remove" type="button" data-cart-action="remove" data-sku="${esc(item.sku)}">
            Odstrániť
          </button>
        </div>

        <div class="cart-item-price">${formatMoney(item.price)}</div>

        <div class="cart-item-quantity">
          <div class="qty-control">
            <button type="button" data-cart-action="minus" data-sku="${esc(item.sku)}" aria-label="Znížiť množstvo">−</button>
            <input type="number" min="1" max="99" value="${qty}" data-cart-action="input" data-sku="${esc(item.sku)}" aria-label="Množstvo" />
            <button type="button" data-cart-action="plus" data-sku="${esc(item.sku)}" aria-label="Zvýšiť množstvo">+</button>
          </div>
        </div>

        <div class="cart-item-total">
          ${itemDiscount > 0 ? `<small class="cart-line-discount">Zľava ${Math.round(itemDiscountRate * 100)} % · -${formatMoney(itemDiscount)}</small>` : ``}
          ${itemDiscount > 0 ? `<del>${formatMoney(itemTotal)}</del>` : ``}
          <strong>${formatMoney(itemFinal)}</strong>
        </div>

        <div class="cart-benefit-grid" data-cart-benefits>
          <div class="cart-benefit-card cart-benefit-expedition">
            <span class="cart-benefit-icon" aria-hidden="true">🚚</span>
            <div>
              <strong>Expedujeme najbližší pracovný deň</strong>
              <small>Produkty skladom pripravíme na odoslanie čo najskôr.</small>
            </div>
          </div>
          ${isCompatibleDiscountItem(item) ? `
            <div class="cart-benefit-card cart-benefit-discount">
              <span class="cart-benefit-icon" aria-hidden="true">%</span>
              <div>
                <strong>Množstevná zľava</strong>
                <small>Od 2 ks 10 %, od 4 ks 25 %.</small>
              </div>
            </div>
            <div class="cart-benefit-card cart-benefit-auto">
              <span class="cart-benefit-icon" aria-hidden="true">✓</span>
              <div>
                <strong>Zľava automaticky</strong>
                <small>Uplatní sa v košíku aj v pokladni.</small>
              </div>
            </div>
          ` : ``}
          <div class="cart-benefit-card cart-benefit-shipping" data-free-shipping-card>
            <span class="cart-benefit-icon" aria-hidden="true">🎁</span>
            <div>
              <strong data-free-shipping-title>Doprava zdarma od 29 €</strong>
              <small data-free-shipping-text></small>
            </div>
          </div>
        </div>
      `;

      list.appendChild(row);
    });

    const pricing = cartPricing(cart);
    const subtotal = pricing.subtotal;
    const discount = pricing.discount;
    const beforeCouponTotal = Math.max(0, subtotal - discount);
    const couponDiscount = couponDiscountForTotal(beforeCouponTotal);
    const beforeLoyaltyTotal = Math.max(0, beforeCouponTotal - couponDiscount);
    const loyaltyDiscount = loyaltyDiscountForTotal(beforeLoyaltyTotal);
    const total = Math.max(0, beforeLoyaltyTotal - loyaltyDiscount);
    const freeShippingThreshold = 29;
    const missingForFreeShipping = Math.max(0, freeShippingThreshold - total);

    document.querySelectorAll("[data-free-shipping-card]").forEach((card) => {
      const title = card.querySelector("[data-free-shipping-title]");
      const text = card.querySelector("[data-free-shipping-text]");
      const hasFreeShipping = missingForFreeShipping <= 0.001;
      card.classList.toggle("is-free", hasFreeShipping);
      if (title) title.textContent = hasFreeShipping ? "Dopravu máte zadarmo" : "Doprava zdarma od 29 €";
      if (text) {
        text.textContent = hasFreeShipping
          ? "Pri tejto objednávke za dopravu neplatíte."
          : `Do dopravy zadarmo vám chýba nakúpiť za ${formatMoney(missingForFreeShipping)}.`;
      }
    });

    let discountEl = document.querySelector("[data-cart-discount-line]");
    if (summary && !discountEl) {
      const line = document.createElement("div");
      line.className = "summary-line summary-discount";
      line.dataset.cartDiscountLine = "";
      line.innerHTML = `<span>Množstevná / sadová zľava</span><strong data-cart-discount>0,00 €</strong>`;
      summary.insertBefore(line, summary.querySelector(".summary-note"));
      discountEl = line;
    }

    let couponEl = document.querySelector("[data-cart-coupon-line]");
    if (summary && !couponEl) {
      const line = document.createElement("div");
      line.className = "summary-line summary-coupon";
      line.dataset.cartCouponLine = "";
      line.innerHTML = `<span>Kupónová zľava</span><strong data-cart-coupon>0,00 €</strong>`;
      summary.insertBefore(line, summary.querySelector(".summary-note"));
      couponEl = line;
    }

    let couponBox = document.querySelector("[data-cart-coupon-box]");
    if (summary && !couponBox) {
      couponBox = document.createElement("form");
      couponBox.className = "summary-note coupon-note";
      couponBox.dataset.cartCouponBox = "";
      couponBox.innerHTML = `<strong>Zľavový kupón</strong><div class="coupon-inline"><input type="text" data-coupon-input placeholder="Zadajte kód kupónu"><button type="submit" data-coupon-apply>Použiť</button></div><small data-coupon-message></small>`;
      summary.insertBefore(couponBox, summary.querySelector(".summary-total"));
    }

    let loyaltyEl = document.querySelector("[data-cart-loyalty-line]");
    if (summary && !loyaltyEl) {
      const line = document.createElement("div");
      line.className = "summary-line summary-loyalty";
      line.dataset.cartLoyaltyLine = "";
      line.innerHTML = `<span>Vernostná zľava</span><strong data-cart-loyalty>0,00 €</strong>`;
      summary.insertBefore(line, summary.querySelector(".summary-total"));
      loyaltyEl = line;
    }

    let loyaltyBox = document.querySelector("[data-cart-loyalty-box]");
    if (summary && !loyaltyBox) {
      loyaltyBox = document.createElement("div");
      loyaltyBox.className = "summary-note loyalty-note";
      loyaltyBox.dataset.cartLoyaltyBox = "";
      summary.insertBefore(loyaltyBox, summary.querySelector(".summary-total"));
    }

    if (loyaltyBox) {
      loyaltyBox.hidden = !tmLoyalty.ok || tmLoyalty.discountValue <= 0;
      if (!loyaltyBox.hidden) {
        loyaltyBox.innerHTML = `<strong>Vernostné body</strong><span>Máte ${tmLoyalty.points} bodov = zľava ${formatMoney(tmLoyalty.discountValue)}.</span><label class="checkline"><input type="checkbox" data-loyalty-toggle ${tmLoyaltyApply ? "checked" : ""}> Použiť zľavu v tejto objednávke</label>`;
      }
    }

    if (couponEl) couponEl.hidden = couponDiscount <= 0;
    const couponValueEl = document.querySelector("[data-cart-coupon]");
    if (couponValueEl) couponValueEl.textContent = `-${formatMoney(couponDiscount)}`;
    const couponInput = document.querySelector("[data-coupon-input]");
    if (couponInput && document.activeElement !== couponInput) couponInput.value = tmCoupon?.code || "";
    const couponMessage = document.querySelector("[data-coupon-message]");
    if (couponMessage) {
      if (tmCoupon?.ok) couponMessage.textContent = `${tmCoupon.label || "Kupón"}: -${formatMoney(couponDiscount)}`;
      else couponMessage.textContent = tmCoupon?.reason || "";
      couponMessage.className = tmCoupon?.ok ? "is-success" : "is-error";
    }

    if (loyaltyEl) loyaltyEl.hidden = loyaltyDiscount <= 0;
    const loyaltyValueEl = document.querySelector("[data-cart-loyalty]");
    if (loyaltyValueEl) loyaltyValueEl.textContent = `-${formatMoney(loyaltyDiscount)}`;

    if (discountEl) discountEl.hidden = discount <= 0;
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
    const discountValueEl = document.querySelector("[data-cart-discount]");
    if (discountValueEl) discountValueEl.textContent = `-${formatMoney(discount)}`;
    if (netEl) netEl.textContent = formatMoney(netFromGross(total));
    if (vatEl) vatEl.textContent = formatMoney(vatFromGross(total));
    if (totalEl) totalEl.textContent = formatMoney(total);
    if (mobileTotalEl) mobileTotalEl.textContent = formatMoney(total);

    refreshCartCounters();
  }


  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-cart-coupon-box]");
    if (!form) return;
    event.preventDefault();
    validateCouponCode(form.querySelector("[data-coupon-input]")?.value || "");
  });

  document.addEventListener("change", (event) => {
    const loyaltyToggle = event.target.closest("[data-loyalty-toggle]");
    if (loyaltyToggle) {
      tmLoyaltyApply = Boolean(loyaltyToggle.checked);
      localStorage.setItem("tm_loyalty_apply", tmLoyaltyApply ? "1" : "0");
      renderCartPage();
    }
  });

  document.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-to-cart]");
    if (addButton) {
      const product = {
        sku: addButton.dataset.sku,
        name: addButton.dataset.name,
        price: addButton.dataset.price,
        image: addButton.dataset.image,
        url: addButton.dataset.url,
        slug: addButton.dataset.slug || "",
        qty: 1,
        product_type_key: addButton.dataset.productTypeKey || addButton.dataset.type || "",
        product_type_label: addButton.dataset.productTypeLabel || "",
        color: addButton.dataset.color || "",
        capacity: addButton.dataset.capacity || addButton.dataset.yield || addButton.dataset.pageYield || addButton.dataset.kapacita || "",
        warranty: addButton.dataset.warranty || "24 mesiacov",
        stock_status: addButton.dataset.stockStatus || "instock",
        stock_quantity: addButton.dataset.stockQuantity || null,
        stock_text: addButton.dataset.stockText || "",
      };

      addToCart(product);
      showAddCartDrawer(product);

      const originalText = addButton.textContent;
      addButton.textContent = "Pridané do košíka";
      addButton.classList.add("is-added");

      setTimeout(() => {
        addButton.textContent = originalText;
        addButton.classList.remove("is-added");
      }, 1000);

      return;
    }

    const cartButton = event.target.closest("[data-cart-action]");
    if (!cartButton) return;

    const action = cartButton.dataset.cartAction;
    const sku = cartButton.dataset.sku;

    if (action === "remove") {
      removeFromCart(sku);
      renderCartPage();
      return;
    }

    if (action === "minus") {
      const item = readCart().find((cartItem) => cartItem.sku === sku);
      updateQty(sku, cleanQty(item?.qty || 1) - 1);
      renderCartPage();
      return;
    }

    if (action === "plus") {
      const item = readCart().find((cartItem) => cartItem.sku === sku);
      updateQty(sku, cleanQty(item?.qty || 1) + 1);
      renderCartPage();
      return;
    }

    if (action === "clear") {
      clearCart();
      renderCartPage();
    }
  });

  document.addEventListener("change", (event) => {
    const input = event.target.closest('input[data-cart-action="input"]');
    if (!input) return;

    updateQty(input.dataset.sku, input.value);
    renderCartPage();
  });

  document.addEventListener("DOMContentLoaded", async () => {
    refreshCartCounters();
    renderCartPage();
    loadLoyalty();
    autoLoadBestCoupon();
    if (document.querySelector("[data-cart-list]")) {
      const changed = await hydrateCartProducts();
      if (changed) renderCartPage();
    }
  });

  window.ToneryMaximCart = {
    readCart,
    saveCart,
    addToCart,
    updateQty,
    removeFromCart,
    clearCart,
    renderCartPage,
    cartPricing,
    cartDiscountedTotal,
    showAddCartDrawer,
    hideAddCartDrawer,
  };
})();
