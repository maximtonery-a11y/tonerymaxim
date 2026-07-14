(() => {
  const TM_PRODUCT_PLACEHOLDER_IMAGE = "/images/tm-product-placeholder-box.jpg";
  const TM_INK_PLACEHOLDER_IMAGE = "/images/tm-ink-placeholder-box.jpg";

  const TM_GENERIC_IMAGE_PATTERNS = [
    "toner-coloriq-kompatible",
    "toner-coloriq-renovacie",
    "drum-compatible",
    "remanufactured-drum",
    "image-coming-soon",
    "no-image",
    "placeholder",
  ];

  const TM_INK_IMAGE_PATTERNS = [
    "ink-remanufactured",
    "compatible-ink-coloriq",
  ];


  function ensureCatalogImageFitStyles() {
    if (document.getElementById("tm-catalog-image-fit-styles")) return;
    const style = document.createElement("style");
    style.id = "tm-catalog-image-fit-styles";
    style.textContent = `
      .tm-row-photo {
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .tm-row-photo img {
        width: 100%;
        height: 100%;
        max-width: 160px;
        max-height: 124px;
        object-fit: contain;
        object-position: center;
        display: block;
        margin: auto;
      }
      @media (max-width: 760px) {
        .tm-row-photo img {
          max-width: 120px;
          max-height: 104px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function isMissingValue(value) {
    const text = String(value || "").trim().toLowerCase();
    return !text || text === "neuvedené" || text === "neuvedene" || text === "n/a" || text === "-";
  }

  function isInkProduct(product) {
    const attrs = Array.isArray(product?.attributes_all) ? product.attributes_all : Array.isArray(product?.attributes) ? product.attributes : [];
    const attrText = attrs.map((attr) => `${attr?.name || ""} ${attr?.slug || ""} ${attr?.value || ""}`).join(" ");
    const categoryText = Array.isArray(product?.categories) ? product.categories.map((cat) => `${cat?.name || ""} ${cat?.slug || ""}`).join(" ") : "";
    const text = `${product?.name || ""} ${product?.slug || ""} ${product?.sku || ""} ${product?.product_type_label || ""} ${product?.product_type_detail_label || ""} ${categoryText} ${attrText}`.toLowerCase();
    return text.includes("atrament") || text.includes("ink") || text.includes("nápl") || text.includes("napl") || text.includes("kazeta") || text.includes("cartridge");
  }

  function productImageSrc(value, product) {
    const url = String(value || "").trim();
    const lower = url.toLowerCase();
    const inkProduct = isInkProduct(product);
    if (!url) return inkProduct ? TM_INK_PLACEHOLDER_IMAGE : TM_PRODUCT_PLACEHOLDER_IMAGE;
    if (lower.includes("tm-ink-placeholder-box")) return TM_INK_PLACEHOLDER_IMAGE;
    if (lower.includes("tm-product-placeholder-box") && inkProduct) return TM_INK_PLACEHOLDER_IMAGE;
    if (lower.includes("tm-product-placeholder-box")) return TM_PRODUCT_PLACEHOLDER_IMAGE;
    if (TM_INK_IMAGE_PATTERNS.some((pattern) => lower.includes(pattern))) return TM_INK_PLACEHOLDER_IMAGE;
    return TM_GENERIC_IMAGE_PATTERNS.some((pattern) => lower.includes(pattern)) ? TM_PRODUCT_PLACEHOLDER_IMAGE : url;
  }

  const CART_KEY = "tm_cart_v1";

  const CATALOG_CACHE_VERSION = "tm_catalog_v3";
  const CATALOG_CACHE_TTL = 10 * 60 * 1000;

  let currentPage = 1;
  let totalPages = 1;
  let currentSearch = "";
  let currentPrinter = "";
  let currentBrand = "";
  let currentCategory = "";
  let currentType = "";
  let currentColor = "";
  let currentStock = "";
  let modalInstalled = false;

  function catalogCacheKey() {
    return [CATALOG_CACHE_VERSION, currentPage, currentSearch || "all", currentPrinter || "all", currentBrand || "all", currentCategory || "all", currentType || "all", currentColor || "all", currentStock || "all"].join(":");
  }

  function readCatalogCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(catalogCacheKey()) || "null");
      if (!cached || !cached.time || !cached.data) return null;
      if (Date.now() - cached.time > CATALOG_CACHE_TTL) return null;
      return cached.data;
    } catch {
      return null;
    }
  }

  function writeCatalogCache(data) {
    try {
      sessionStorage.setItem(catalogCacheKey(), JSON.stringify({
        time: Date.now(),
        data,
      }));
    } catch {
      // sessionStorage môže byť vypnutý, výpis funguje aj bez cache
    }
  }

  function productDetailCacheKey(product) {
    const slug = String(product?.slug || product?.detail_url || "").split("/").filter(Boolean).pop() || String(product?.id || "");
    return slug ? `tm_product_detail_v1:${slug}` : "";
  }

  function writeProductDetailCache(product) {
    try {
      const key = productDetailCacheKey(product);
      if (!key) return;
      sessionStorage.setItem(key, JSON.stringify({
        time: Date.now(),
        product,
      }));
    } catch {
      // Detail produktu sa načíta aj bez rýchlej cache.
    }
  }

  function typeRank(product) {
    const key = product?.product_type_key || "product";
    if (key === "compatible") return 0;
    if (key === "original") return 1;
    if (key === "renovated") return 2;
    return 3;
  }

  function sortProducts(products) {
    return [...(products || [])].sort((a, b) => {
      const rank = typeRank(a) - typeRank(b);
      if (rank !== 0) return rank;

      const stockA = a.stock_status === "instock" ? 0 : 1;
      const stockB = b.stock_status === "instock" ? 0 : 1;
      if (stockA !== stockB) return stockA - stockB;

      return String(a.name || "").localeCompare(String(b.name || ""), "sk");
    });
  }


  function filterLabel(kind, value) {
    const labels = {
      brand: { HP: "HP", Canon: "Canon", Brother: "Brother", Epson: "Epson", Xerox: "Xerox", Samsung: "Samsung", Lexmark: "Lexmark", Kyocera: "Kyocera", OKI: "OKI", Ricoh: "Ricoh", Utax: "Utax", Toshiba: "Toshiba" },
      category: {
        "tonery": "Tonery",
        "atramentove-naplne": "Atramentové náplne",
        "opticke-valce": "Optické valce",
        "ostatne-komponenty": "Ostatné komponenty",
      },
      type: { compatible: "Kompatibilné", original: "Originálne", renovated: "Renovované" },
      color: { cierna: "Čierna", cyan: "Cyan", purpurova: "Purpurová", yellow: "Yellow", multipack: "Multipack" },
      stock: { instock: "Skladom", "expedujeme-dnes": "Expedujeme dnes", "10plus": "Viac ako 10 ks" },
    };
    return labels[kind]?.[value] || value || "";
  }

  function setUrlState() {
    const url = new URL(window.location.href);
    const setOrDelete = (key, value) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    };

    setOrDelete("s", currentSearch);
    setOrDelete("printer", currentPrinter);
    setOrDelete("brand", currentBrand);
    setOrDelete("category", currentCategory);
    setOrDelete("type", currentType);
    setOrDelete("color", currentColor);
    setOrDelete("stock", currentStock);
    url.searchParams.delete("search");
    url.searchParams.delete("q");
    window.history.replaceState({}, "", url.toString());
  }

  function activeFilterItems() {
    return [
      currentBrand ? { kind: "brand", label: `Značka: ${filterLabel("brand", currentBrand)}` } : null,
      currentCategory ? { kind: "category", label: `Kategória: ${filterLabel("category", currentCategory)}` } : null,
      currentType ? { kind: "type", label: `Typ: ${filterLabel("type", currentType)}` } : null,
      currentColor ? { kind: "color", label: `Farba: ${filterLabel("color", currentColor)}` } : null,
      currentStock ? { kind: "stock", label: `${filterLabel("stock", currentStock)}` } : null,
      currentPrinter ? { kind: "printer", label: `Hľadanie: ${currentPrinter}` } : null,
      currentSearch ? { kind: "search", label: `Hľadanie: ${currentSearch}` } : null,
    ].filter(Boolean);
  }

  function clearFilter(kind) {
    if (kind === "brand") currentBrand = "";
    if (kind === "category") currentCategory = "";
    if (kind === "type") currentType = "";
    if (kind === "color") currentColor = "";
    if (kind === "stock") currentStock = "";
    if (kind === "printer") currentPrinter = "";
    if (kind === "search") {
      currentSearch = "";
      const input = document.querySelector("[data-catalog-search]");
      if (input) input.value = "";
    }

    currentPage = 1;
    loadProducts();
  }

  function updateFilterButtons() {
    document.querySelector("[data-active-filters]")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-clear-filter]");
      if (!button) return;
      clearFilter(button.dataset.clearFilter || "");
    });

    document.querySelectorAll("[data-filter]").forEach((button) => {
      const kind = button.dataset.filter;
      const value = button.dataset.filterValue || "";
      const active =
        (kind === "brand" && value === currentBrand) ||
        (kind === "category" && value === currentCategory) ||
        (kind === "type" && value === currentType) ||
        (kind === "color" && value === currentColor) ||
        (kind === "stock" && value === currentStock);
      button.classList.toggle("is-active", active);
    });

    const active = activeFilterItems();
    const target = document.querySelector("[data-active-filters]");
    if (target) {
      target.innerHTML = active.length
        ? active.map((item) => `
            <button type="button" class="catalog-filter-chip" data-clear-filter="${esc(item.kind)}" aria-label="Zrušiť filter ${esc(item.label)}">
              <span>${esc(item.label)}</span>
              <strong aria-hidden="true">×</strong>
            </button>
          `).join("")
        : `<span class="catalog-filter-chip catalog-filter-chip--muted">Zobrazené všetky produkty</span>`;
    }
  }

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

  function esc(value) {
    return String(value ?? "").replace(/[&<>"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    }[char]));
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
    if (window.ToneryMaximCart && typeof window.ToneryMaximCart.addToCart === "function") {
      window.ToneryMaximCart.addToCart(product);
      if (typeof window.ToneryMaximCart.showAddCartDrawer === "function") window.ToneryMaximCart.showAddCartDrawer(product);
      return;
    }

    const cart = readCart();
    const id = String(product.id || product.sku || product.name);
    const existing = cart.find((item) => String(item.id) === id);

    if (existing) {
      existing.qty = Number(existing.qty || 1) + 1;
      existing.url = existing.url && existing.url !== "#" ? existing.url : cartProductUrl(product);
      existing.slug = existing.slug || product.slug || "";
      existing.color = existing.color || product.color || "";
      existing.capacity = existing.capacity || cartProductCapacity(product);
      existing.yield = existing.yield || product.yield || "";
      existing.page_yield = existing.page_yield || product.page_yield || "";
      existing.warranty = existing.warranty || "24 mesiacov";
      existing.stock_status = product.stock_status || existing.stock_status || "";
      existing.stock_quantity = product.stock_quantity ?? existing.stock_quantity ?? null;
      existing.stock_text = existing.stock_text || (typeof stockText === "function" ? stockText(product) : "");
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
        stock_text: stockText(product),
      });
    }

    saveCart(cart);
  }

  function stockText(product) {
    if (product.stock_status === "instock") {
      if (product.stock_quantity !== null && product.stock_quantity !== undefined) return `Skladom ${product.stock_quantity} ks`;
      return "Skladom";
    }
    if (product.stock_status === "outofstock") return "Nie je skladom";
    if (product.stock_status === "onbackorder") return "Na objednávku";
    return product.stock_status || "Dostupnosť neznáma";
  }

  function isProductInStock(product) {
    return product.stock_status === "instock";
  }

  function stockClass(product) {
    if (product.stock_status === "instock") return "is-instock";
    if (product.stock_status === "outofstock") return "is-outofstock";
    if (product.stock_status === "onbackorder") return "is-backorder";
    return "is-unknown";
  }

  function mobileGroupInfo(key, count) {
    if (key === "compatible") return { title: `Kompatibilné tonery (${count})`, key };
    if (key === "original") return { title: `Originálne tonery (${count})`, key };
    if (key === "renovated") return { title: `Renovované tonery (${count})`, key };
    return { title: `Ostatné produkty (${count})`, key: "product" };
  }

  function mobileGroupCounts(products) {
    return products.reduce((acc, product) => {
      const key = product?.product_type_key || "product";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  function dispatchText(product) {
    return product.stock_status === "instock" ? "Expedujeme dnes" : "Termín dodania overíme";
  }

  function normalizePrinter(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^(toner|kazeta|náplň|napln|produkt)\s+(je\s+)?(kompatibiln[ýáéy]|vhodn[ýáéy])\s+(s|pre)\s+(tlačiarňami|tlaciarnami|tlačiarne|tlaciarne)?\s*/i, "")
      .replace(/^(kompatibiln[éey]|kompatibilne|vhodn[éey]|vhodne|pre|modely|tlačiarne|tlaciarne|printers?|models?)\s*:?-?\s*/i, "")
      .replace(/\s*(a\s+ďalšie|a\s+dalsie|a\s+iné|a\s+ine|and\s+other).*$/i, "")
      .replace(/[.。]+$/g, "")
      .trim();
  }

  function isRealPrinterModel(value) {
    const text = normalizePrinter(value);
    if (text.length < 4 || text.length > 90) return false;
    if (!/\d/.test(text)) return false;
    if (/\b(toner|kazeta|náplň|napln|produkt|strán|stran|pages|záruka|zaruka|skladom|kompatibiln[ýáéy])\b/i.test(text)) return false;
    return /\b(HP|Brother|Canon|Epson|Xerox|Samsung|Lexmark|Dell|Kyocera|OKI|Ricoh|Konica|Minolta|Utax|Panasonic|Toshiba|LaserJet|OfficeJet|DeskJet|PIXMA|i-SENSYS|DCP|MFC|HL|WorkForce|EcoTank|Expression)\b/i.test(text) ||
      /\b[A-Z]{1,5}[- ]?[A-Z]?\d{2,5}[A-Z0-9-]*\b/.test(text);
  }

  function getPrinters(product) {
    const candidates = [
      product.compatible_printers,
      product.printers,
      product.compatibility,
      product.compatible_models,
      product.printer_models,
      product.models,
    ];

    const values = [];

    for (const item of candidates) {
      if (Array.isArray(item) && item.length) {
        item.forEach((x) => values.push(typeof x === "string" ? x : x.name || x.title || x.model));
      }

      if (typeof item === "string" && item.trim()) {
        item.split(/[,;\n]/).forEach((x) => values.push(x));
      }
    }

    const seen = new Set();
    return values
      .map(normalizePrinter)
      .filter(isRealPrinterModel)
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function productParams(product) {
    const params = [];
    const color = product.color || "Neuvedené";

    params.push(`<span class="tm-meta-color"><i style="--swatch:${colorHex(color)}"></i>${esc(color)}</span>`);

    params.push(`
      <span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>
        ${esc(product.yield || product.page_yield || product.capacity || product.kapacita || "Neuvedené")}
      </span>
    `);

    params.push(`
      <span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>
        24 mes. záruka
      </span>
    `);

    return params.join("");
  }

  function colorHex(color) {
    const c = String(color || "").toLowerCase();
    if (c.includes("žlt") || c.includes("zlt") || c.includes("yellow")) return "#facc15";
    if (c.includes("azú") || c.includes("azur") || c.includes("cyan")) return "#06b6d4";
    if (c.includes("purp") || c.includes("magenta")) return "#d946ef";
    if (c.includes("čier") || c.includes("cier") || c.includes("black")) return "#111827";
    if (c.includes("cmyk") || c.includes("multi")) return "linear-gradient(90deg,#06b6d4,#d946ef,#facc15,#111827)";
    return "#94a3b8";
  }

  function typeData(product) {
    const key = product.product_type_key || "product";

    if (key === "original") {
      return {
        key,
        label: "ORIGINÁL",
        note: "🏅 Originálna kvalita výrobcu",
        iconImage: "/design-icons/icon-original.png",
      };
    }

    if (key === "compatible") {
      return {
        key,
        label: "KOMPATIBILNÝ",
        note: "⭐ Odporúčame, najpredávanejší model",
        iconImage: "/design-icons/icon-compatible.png",
      };
    }

    if (key === "renovated") {
      return {
        key,
        label: "RENOVOVANÝ",
        note: "🏢 Ekologická voľba pre kancelárie",
        iconImage: "/design-icons/icon-renovated.png",
      };
    }

    return {
      key,
      label: product.product_type_label || "PRODUKT",
      note: product.product_type_note || "Spotrebný materiál",
      iconImage: "",
    };
  }

  function printerProductsUrl(printer) {
    const url = new URL("/produkty", window.location.origin);
    url.searchParams.set("printer", printer);
    return `${url.pathname}?${url.searchParams.toString()}`;
  }

  function compatibilityPreview(product) {
    const printers = getPrinters(product);
    if (!printers.length) return "Kompatibilita bude doplnená.";
    return printers.slice(0, 4).join(", ");
  }

  function ensureModal() {
    if (modalInstalled) return;
    modalInstalled = true;

    const modal = document.createElement("dialog");
    modal.className = "tm-printer-modal";
    modal.innerHTML = `
      <div class="tm-printer-modal-card">
        <button class="tm-modal-close" type="button" aria-label="Zavrieť">×</button>
        <h2>Všetky kompatibilné modely tlačiarní</h2>
        <p data-modal-subtitle>Táto skupina produktov je vhodná pre tieto modely.</p>
        <div class="tm-modal-printer-grid" data-modal-printers></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".tm-modal-close").addEventListener("click", () => modal.close());
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.close();
    });
  }

  function openPrinterModal(product) {
    ensureModal();
    const modal = document.querySelector(".tm-printer-modal");
    const grid = modal.querySelector("[data-modal-printers]");
    const printers = getPrinters(product);

    grid.innerHTML = printers.length
      ? printers.map((printer) => `<a href="${printerProductsUrl(printer)}">${esc(printer)}</a>`).join("")
      : `<span>Kompatibilita bude doplnená.</span>`;

    if (modal instanceof HTMLDialogElement) modal.showModal();
  }

  function ensureAvailabilityModal() {
    let modal = document.querySelector(".tm-availability-modal");
    if (modal) return modal;

    modal = document.createElement("dialog");
    modal.className = "tm-availability-modal";
    modal.innerHTML = `
      <form class="tm-availability-card" method="dialog" data-availability-form>
        <button class="tm-modal-close" type="button" data-availability-close aria-label="Zavrieť">×</button>
        <p class="tm-availability-eyebrow">Overenie dostupnosti</p>
        <h2>Opýtať sa na produkt</h2>
        <label>
          Produkt
          <input type="text" name="product" data-availability-product readonly>
        </label>
        <label>
          Otázka
          <textarea name="message" rows="4" data-availability-message>Poprosím o overenie dostupnosti daného produktu.</textarea>
        </label>
        <div class="tm-availability-grid">
          <label>
            Meno
            <input type="text" name="name" required placeholder="Vaše meno">
          </label>
          <label>
            E-mail
            <input type="email" name="email" required placeholder="vas@email.sk">
          </label>
        </div>
        <label>
          Mobil <span>voliteľné</span>
          <input type="tel" name="phone" placeholder="+421917859206">
        </label>
        <button class="tm-availability-submit" type="submit">Odoslať otázku</button>
        <p class="tm-availability-note">Formulár otvorí pripravený e-mail pre zákaznícku podporu.</p>
      </form>
    `;
    document.body.appendChild(modal);

    modal.querySelector("[data-availability-close]").addEventListener("click", () => modal.close());
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.close();
    });
    modal.querySelector("[data-availability-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const product = String(data.get("product") || "");
      const message = String(data.get("message") || "");
      const name = String(data.get("name") || "");
      const email = String(data.get("email") || "");
      const phone = String(data.get("phone") || "");
      const body = [
        message,
        "",
        `Produkt: ${product}`,
        `Meno: ${name}`,
        `E-mail: ${email}`,
        phone ? `Mobil: ${phone}` : "Mobil: neuvedený",
      ].join("\n");
      window.location.href = `mailto:info@tonerymaxim.sk?subject=${encodeURIComponent(`Overenie dostupnosti: ${product}`)}&body=${encodeURIComponent(body)}`;
      modal.close();
    });

    return modal;
  }

  function openAvailabilityModal(product) {
    const modal = ensureAvailabilityModal();
    modal.querySelector("[data-availability-product]").value = product?.name || "";
    modal.querySelector("[data-availability-message]").value = "Poprosím o overenie dostupnosti daného produktu.";
    if (modal instanceof HTMLDialogElement) modal.showModal();
  }


  function updateMobileQuery() {
    const node = document.querySelector("[data-catalog-mobile-query]");
    if (!node) return;

    const label = currentPrinter || currentSearch || currentBrand || "";
    if (!label) {
      node.hidden = true;
      node.textContent = "";
      return;
    }

    node.hidden = false;
    node.innerHTML = `Hľadanie: <strong>${esc(label)}</strong>`;
  }

  function renderProducts(products) {
    ensureCatalogImageFitStyles();
    const list = document.querySelector("[data-catalog-grid]");
    const status = document.querySelector("[data-catalog-status]");

    if (!list) return;

    list.innerHTML = "";

    if (!products.length) {
      status.textContent = "Nenašli sa žiadne produkty.";
      return;
    }

    const sortedProducts = sortProducts(products);
    status.textContent = `Načítané produkty: ${sortedProducts.length}`;

    const groupCounts = mobileGroupCounts(sortedProducts);
    let previousMobileGroup = "";

    sortedProducts.forEach((product) => {
      const type = typeData(product);
      const mobileGroupKey = type.key || "product";

      if (mobileGroupKey !== previousMobileGroup) {
        previousMobileGroup = mobileGroupKey;
        const group = mobileGroupInfo(mobileGroupKey, groupCounts[mobileGroupKey] || 0);
        const heading = document.createElement("h2");
        heading.className = `tm-mobile-product-group tm-mobile-product-group--${group.key}`;
        heading.textContent = group.title;
        list.appendChild(heading);
      }

      const printers = getPrinters(product);
      const row = document.createElement("article");
      row.className = `tm-product-row tm-product-row--${type.key}`;

      row.innerHTML = `
        <div class="tm-row-accent" aria-hidden="true"></div>

        <div class="tm-row-type">
          <div class="tm-row-symbol" aria-hidden="true">
            ${type.iconImage ? `<img src="${esc(type.iconImage)}" alt="">` : `<span>•</span>`}
          </div>
          <div class="tm-row-type-copy">
            <span class="tm-type-badge">${esc(type.label)}</span>
            <p>${type.note}</p>
          </div>
        </div>

        <a href="${esc(product.detail_url)}" class="tm-row-photo" aria-label="Otvoriť produkt">
          ${`<img src="${esc(productImageSrc(product.image, product))}" alt="${esc(product.name)}" loading="lazy" class="tm-product-fit-image">`}
        </a>

        <div class="tm-row-main">
          <h2><a href="${esc(product.detail_url)}">${esc(product.name)}</a></h2>
          <p class="tm-row-printers">${esc(compatibilityPreview(product))}</p>
          <div class="tm-row-info-line">
            <div class="tm-row-meta">${productParams(product)}</div>
            <div class="tm-row-compat">
              <button type="button" data-open-printers>Vhodné pre ${printers.length || 0} tlačiarní</button>
              <span class="tm-dispatch">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><path d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
                ${esc(dispatchText(product))}
              </span>
            </div>
          </div>
        </div>

        <div class="tm-row-buy">
          <span class="tm-stock-dot ${stockClass(product)}">${esc(stockText(product))}</span>
          <strong>${money(product.price)}</strong>
          <small>s DPH</small>
          <button type="button" class="${isProductInStock(product) ? "" : "tm-availability-btn"}" aria-label="${isProductInStock(product) ? `Pridať do košíka ${esc(product.name)}` : `Overiť dostupnosť ${esc(product.name)}`}">
            ${isProductInStock(product) ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h16l-2 8H7zM5 6 4 3H2M8 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>Do košíka` : `Overiť dostupnosť`}
          </button>
        </div>
      `;

      row.querySelector("[data-open-printers]").addEventListener("click", () => openPrinterModal(product));

      row.querySelectorAll("a[href]").forEach((link) => {
        link.addEventListener("mouseenter", () => writeProductDetailCache(product), { once: true });
        link.addEventListener("mousedown", () => writeProductDetailCache(product));
        link.addEventListener("click", () => writeProductDetailCache(product));
      });

      row.querySelector(".tm-row-buy button").addEventListener("click", () => {
        const btn = row.querySelector(".tm-row-buy button");

        if (!isProductInStock(product)) {
          openAvailabilityModal(product);
          return;
        }

        addToCart(product);
        btn.classList.add("added");
        btn.textContent = "Pridané ✓";
        setTimeout(() => {
          btn.classList.remove("added");
          btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h16l-2 8H7zM5 6 4 3H2M8 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>Do košíka`;
        }, 900);
      });

      list.appendChild(row);
    });
  }

  function updatePagination() {
    document.querySelector("[data-page-info]").textContent = `Strana ${currentPage} / ${totalPages}`;
    document.querySelector("[data-prev-page]").disabled = currentPage <= 1;
    document.querySelector("[data-next-page]").disabled = currentPage >= totalPages;
  }

  async function loadProducts(options = {}) {
    updateMobileQuery();
    updateFilterButtons();
    setUrlState();
    const status = document.querySelector("[data-catalog-status]");
    const list = document.querySelector("[data-catalog-grid]");
    const cached = readCatalogCache();
    const hasCachedProducts = cached?.ok && Array.isArray(cached.products) && cached.products.length > 0;

    if (hasCachedProducts) {
      totalPages = Math.max(1, Number(cached.total_pages || 1));
      renderProducts(cached.products);
      updatePagination();
      status.textContent = "Produkty načítané z rýchlej cache. Aktualizujem...";
    } else if (!options.silent) {
      status.textContent = "Načítavam produkty...";
      list.innerHTML = `
        <article class="tm-product-row tm-product-row--skeleton"></article>
        <article class="tm-product-row tm-product-row--skeleton"></article>
        <article class="tm-product-row tm-product-row--skeleton"></article>
      `;
    }

    try {
      const params = new URLSearchParams({
        per_page: "12",
        page: String(currentPage),
      });

      if (currentSearch) params.set("search", currentSearch);
      if (currentPrinter) params.set("printer", currentPrinter);
      if (currentBrand) params.set("brand", currentBrand);
      if (currentCategory) params.set("category", currentCategory);
      if (currentType) params.set("type", currentType);
      if (currentColor) params.set("color", currentColor);
      if (currentStock) params.set("stock", currentStock);

      const response = await fetch(`/api/products?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error?.message || data.error || "Nepodarilo sa načítať produkty.");
      }

      totalPages = Math.max(1, Number(data.total_pages || 1));
      data.products = sortProducts(data.products || []);
      writeCatalogCache(data);
      renderProducts(data.products);
      updatePagination();
    } catch (error) {
      if (!hasCachedProducts) {
        status.textContent = error.message || "Chyba načítania produktov.";
        totalPages = 1;
        updatePagination();
      } else {
        status.textContent = "Zobrazené produkty z cache. Aktualizácia sa nepodarila.";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateCartBadge();

    const url = new URL(window.location.href);
    currentSearch = (url.searchParams.get("s") || url.searchParams.get("search") || url.searchParams.get("q") || "").trim();
    currentPrinter = (url.searchParams.get("printer") || "").trim();
    currentBrand = (url.searchParams.get("brand") || "").trim();
    currentCategory = (url.searchParams.get("category") || "").trim();
    currentType = (url.searchParams.get("type") || "").trim();
    currentColor = (url.searchParams.get("color") || "").trim();
    currentStock = (url.searchParams.get("stock") || "").trim();

    if (currentBrand && !["HP", "Canon", "Brother"].includes(currentBrand)) {
      const moreBrands = document.querySelector("[data-more-brands]");
      if (moreBrands) moreBrands.hidden = false;
      const toggle = document.querySelector("[data-toggle-more-brands]");
      if (toggle) toggle.textContent = "− skryť ostatné značky";
    }

    const searchInput = document.querySelector("[data-catalog-search]");
    if (searchInput && currentSearch) searchInput.value = currentSearch;
    const bottomSearchInput = document.querySelector("[data-catalog-bottom-search-input]");
    if (bottomSearchInput && currentSearch) bottomSearchInput.value = currentSearch;

    let usedInitialCatalog = false;
    const initialDataNode = document.getElementById("tm-catalog-initial-data");
    if (initialDataNode?.textContent) {
      try {
        const initialData = JSON.parse(initialDataNode.textContent);
        if (initialData?.ok && Array.isArray(initialData.products)) {
          currentPage = Math.max(1, Number(initialData.page || 1));
          totalPages = Math.max(1, Number(initialData.total_pages || 1));
          renderProducts(initialData.products);
          updatePagination();
          updateMobileQuery();
          updateFilterButtons();
          writeCatalogCache(initialData);
          usedInitialCatalog = true;
        }
      } catch {
        // Pri neplatných počiatočných dátach zostáva pôvodné API načítanie.
      }
    }

    if (!usedInitialCatalog) loadProducts();

    document.querySelector("[data-catalog-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      currentPage = 1;
      currentSearch = document.querySelector("[data-catalog-search]").value.trim();
      currentPrinter = "";
      loadProducts();
    });

    document.querySelector("[data-active-filters]")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-clear-filter]");
      if (!button) return;
      clearFilter(button.dataset.clearFilter || "");
    });

    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.filter;
        const value = button.dataset.filterValue || "";

        if (kind === "brand") currentBrand = value;
        if (kind === "category") currentCategory = value;
        if (kind === "type") currentType = value;
        if (kind === "color") currentColor = value;
        if (kind === "stock") currentStock = value;

        currentPage = 1;
        loadProducts();
      });
    });

    document.querySelector("[data-toggle-more-brands]")?.addEventListener("click", () => {
      const box = document.querySelector("[data-more-brands]");
      if (!box) return;
      box.hidden = !box.hidden;
      document.querySelector("[data-toggle-more-brands]").textContent = box.hidden ? "+ ostatné značky" : "− skryť ostatné značky";
    });

    document.querySelector("[data-prev-page]")?.addEventListener("click", () => {
      if (currentPage <= 1) return;
      currentPage -= 1;
      loadProducts();
    });

    document.querySelector("[data-next-page]")?.addEventListener("click", () => {
      if (currentPage >= totalPages) return;
      currentPage += 1;
      loadProducts();
    });
  });
})();
