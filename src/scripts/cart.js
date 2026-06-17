(() => {
  const TM_PRODUCT_PLACEHOLDER_IMAGE = "/images/tm-product-placeholder-box.jpg";

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

        <div class="qty-control">
          <button type="button" data-cart-action="minus" data-sku="${esc(item.sku)}" aria-label="Znížiť množstvo">−</button>
          <input type="number" min="1" max="99" value="${qty}" data-cart-action="input" data-sku="${esc(item.sku)}" aria-label="Množstvo" />
          <button type="button" data-cart-action="plus" data-sku="${esc(item.sku)}" aria-label="Zvýšiť množstvo">+</button>
        </div>

        <div class="cart-item-total">
          ${itemDiscount > 0 ? `<small class="cart-line-discount">Zľava ${Math.round(itemDiscountRate * 100)} % · -${formatMoney(itemDiscount)}</small>` : ``}
          ${itemDiscount > 0 ? `<del>${formatMoney(itemTotal)}</del>` : ``}
          <strong>${formatMoney(itemFinal)}</strong>
        </div>
      `;

      list.appendChild(row);
    });

    const pricing = cartPricing(cart);
    const subtotal = pricing.subtotal;
    const discount = pricing.discount;
    const total = Math.max(0, subtotal - discount);

    let discountEl = document.querySelector("[data-cart-discount-line]");
    if (summary && !discountEl) {
      const line = document.createElement("div");
      line.className = "summary-line summary-discount";
      line.dataset.cartDiscountLine = "";
      line.innerHTML = `<span>Množstevná / sadová zľava</span><strong data-cart-discount>0,00 €</strong>`;
      summary.insertBefore(line, summary.querySelector(".summary-note"));
      discountEl = line;
    }

    if (discountEl) discountEl.hidden = discount <= 0;
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
    const discountValueEl = document.querySelector("[data-cart-discount]");
    if (discountValueEl) discountValueEl.textContent = `-${formatMoney(discount)}`;
    if (totalEl) totalEl.textContent = formatMoney(total);
    if (mobileTotalEl) mobileTotalEl.textContent = formatMoney(total);

    refreshCartCounters();
  }

  document.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-to-cart]");
    if (addButton) {
      addToCart({
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
      });

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
  };
})();
