(() => {
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

  function discountRate(item) {
    if (!isCompatibleDiscountItem(item)) return 0;
    const qty = cleanQty(item.qty);
    if (qty >= 4) return 0.25;
    if (qty >= 2) return 0.10;
    return 0;
  }

  function cartPricing(cart = readCart()) {
    return cart.reduce((totals, item) => {
      const qty = cleanQty(item.qty);
      const lineOriginal = Number(item.price || 0) * qty;
      const rate = discountRate(item);
      const lineDiscount = Math.round(lineOriginal * rate * 100) / 100;
      totals.subtotal += lineOriginal;
      totals.discount += lineDiscount;
      return totals;
    }, { subtotal: 0, discount: 0 });
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
    } else {
      cart.push({
        sku,
        name: product.name || "Produkt",
        price: Number(product.price || 0),
        image: product.image || "",
        url: product.url || "#",
        qty: cleanQty(product.qty || 1),
        product_type_key: product.product_type_key || product.productTypeKey || product.type || "",
        product_type_label: product.product_type_label || product.productTypeLabel || "",
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
    const subtotalEl = document.querySelector("[data-cart-subtotal]");
    const shippingEl = document.querySelector("[data-cart-shipping]");
    const totalEl = document.querySelector("[data-cart-total]");

    if (!list) return;

    const cart = readCart();
    list.innerHTML = "";

    if (cart.length === 0) {
      if (empty) empty.hidden = false;
      if (summary) summary.hidden = true;
      refreshCartCounters();
      return;
    }

    if (empty) empty.hidden = true;
    if (summary) summary.hidden = false;

    cart.forEach((item) => {
      const qty = cleanQty(item.qty);
      const itemTotal = Number(item.price || 0) * qty;
      const itemRate = discountRate(item);
      const itemDiscount = Math.round(itemTotal * itemRate * 100) / 100;
      const itemFinal = Math.max(0, itemTotal - itemDiscount);

      const row = document.createElement("article");
      row.className = "cart-item";
      row.dataset.sku = item.sku;

      row.innerHTML = `
        <a class="cart-item-image" href="${item.url || "#"}">
          ${
            item.image
              ? `<img src="${item.image}" alt="${item.name}" />`
              : `<div class="cart-item-placeholder">TM</div>`
          }
        </a>

        <div class="cart-item-main">
          <a class="cart-item-title" href="${item.url || "#"}">${item.name}</a>
          <div class="cart-item-sku">SKU: ${item.sku}</div>
          <button class="cart-remove" type="button" data-cart-action="remove" data-sku="${item.sku}">
            Odstrániť
          </button>
        </div>

        <div class="cart-item-price">${formatMoney(item.price)}</div>

        <div class="qty-control">
          <button type="button" data-cart-action="minus" data-sku="${item.sku}" aria-label="Znížiť množstvo">−</button>
          <input type="number" min="1" max="99" value="${qty}" data-cart-action="input" data-sku="${item.sku}" aria-label="Množstvo" />
          <button type="button" data-cart-action="plus" data-sku="${item.sku}" aria-label="Zvýšiť množstvo">+</button>
        </div>

        <div class="cart-item-total">
          <strong>${formatMoney(itemFinal)}</strong>
          ${itemDiscount > 0 ? `<small>Zľava ${Math.round(itemRate * 100)} %: -${formatMoney(itemDiscount)}</small>` : ""}
        </div>
      `;

      list.appendChild(row);
    });

    const pricing = cartPricing(cart);
    const subtotal = pricing.subtotal;
    const discount = pricing.discount;
    const discountedSubtotal = Math.max(0, subtotal - discount);
    const shipping = discountedSubtotal >= 29 ? 0 : 3.9;
    const total = discountedSubtotal + shipping;

    let discountEl = document.querySelector("[data-cart-discount-line]");
    if (summary && !discountEl) {
      const line = document.createElement("div");
      line.className = "summary-line summary-discount";
      line.dataset.cartDiscountLine = "";
      line.innerHTML = `<span>Množstevná zľava</span><strong data-cart-discount>0,00 €</strong>`;
      const shippingLine = shippingEl?.closest(".summary-line");
      summary.insertBefore(line, shippingLine || summary.querySelector(".summary-note"));
      discountEl = line;
    }

    if (discountEl) discountEl.hidden = discount <= 0;
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
    const discountValueEl = document.querySelector("[data-cart-discount]");
    if (discountValueEl) discountValueEl.textContent = `-${formatMoney(discount)}`;
    if (shippingEl) shippingEl.textContent = shipping === 0 ? "Zdarma" : formatMoney(shipping);
    if (totalEl) totalEl.textContent = formatMoney(total);

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
        qty: 1,
        product_type_key: addButton.dataset.productTypeKey || addButton.dataset.type || "",
        product_type_label: addButton.dataset.productTypeLabel || "",
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

  document.addEventListener("DOMContentLoaded", () => {
    refreshCartCounters();
    renderCartPage();
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
