(() => {
  const CART_KEY = "tm_cart_v1";

  function readCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent("tm-cart-updated"));
    updateCartBadge();
  }

  function updateCartBadge() {
    const cart = readCart();
    const count = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = String(count);
    });
  }

  function money(value) {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function cartFirstFilled(...values) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text && text.toLowerCase() !== "neuvedené") return text;
    }
    return "";
  }

  function cartProductCapacity(product) {
    return cartFirstFilled(product?.capacity, product?.kapacita, product?.yield, product?.page_yield, product?.pageYield, product?.pages, product?.ml, product?.volume);
  }

  function cartProductUrl(product) {
    const direct = String(product?.url || product?.detail_url || "").trim();
    if (direct && direct !== "#") return direct;
    const slug = String(product?.slug || "").trim();
    if (slug) return `/produkt/${encodeURIComponent(slug)}`;
    return "/produkty";
  }

  function addToCart(product) {
    const cart = readCart();
    const id = String(product.id || product.sku || product.name);
    const existing = cart.find((item) => String(item.id) === id);

    if (existing) {
      existing.qty = Number(existing.qty || 1) + 1;
    } else {
      cart.push({
        id,
        sku: product.sku || "",
        name: product.name,
        price: Number(product.price || 0),
        image: product.image || "",
        url: cartProductUrl(product),
        slug: product.slug || "",
        qty: 1,
        product_type_key: product.product_type_key || "",
        product_type_label: product.product_type_label || product.product_type_detail_label || "",
        color: product.color || "",
        capacity: cartProductCapacity(product),
        yield: product.yield || "",
        page_yield: product.page_yield || "",
        warranty: "24 mesiacov",
        stock_status: product.stock_status || "",
        stock_quantity: product.stock_quantity ?? null,
        stock_text: product.stock_status === "instock" ? (product.stock_quantity != null ? `Skladom ${product.stock_quantity} ks` : "Skladom") : (product.stock_status || ""),
      });
    }

    saveCart(cart);
  }

  function renderProducts(products) {
    const grid = document.querySelector("[data-products-grid]");
    const status = document.querySelector("[data-products-status]");

    if (!grid) return;

    grid.innerHTML = "";

    if (!products.length) {
      status.textContent = "Nenašli sa žiadne produkty.";
      return;
    }

    status.textContent = `Načítané produkty: ${products.length}`;

    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "woo-product-card";

      card.innerHTML = `
        <div class="woo-product-image">
          ${product.image ? `<img src="${product.image}" alt="${product.name}" loading="lazy">` : `<span>TM</span>`}
        </div>
        <div class="woo-product-body">
          <div class="woo-product-sku">${product.sku || "bez SKU"}</div>
          <h2>${product.name}</h2>
          <div class="woo-product-stock">${product.stock_status === "instock" ? "Skladom" : "Dostupnosť: " + product.stock_status}</div>
          <div class="woo-product-price">${money(product.price)}</div>
          <button type="button" class="woo-add-cart">Pridať do košíka</button>
        </div>
      `;

      card.querySelector(".woo-add-cart").addEventListener("click", () => {
        addToCart(product);
        card.querySelector(".woo-add-cart").textContent = "Pridané ✓";
        setTimeout(() => {
          card.querySelector(".woo-add-cart").textContent = "Pridať do košíka";
        }, 900);
      });

      grid.appendChild(card);
    });
  }

  async function loadProducts() {
    const status = document.querySelector("[data-products-status]");
    const input = document.querySelector("[data-products-search]");
    const search = input ? input.value.trim() : "";

    status.textContent = "Načítavam produkty...";

    try {
      const params = new URLSearchParams({
        per_page: "12",
      });

      if (search) params.set("search", search);

      const response = await fetch(`/api/products?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error?.message || data.error || "Nepodarilo sa načítať produkty.");
      }

      renderProducts(data.products || []);
    } catch (error) {
      status.textContent = error.message || "Chyba načítania produktov.";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateCartBadge();
    loadProducts();

    document.querySelector("[data-products-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      loadProducts();
    });
  });
})();
