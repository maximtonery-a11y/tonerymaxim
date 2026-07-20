import { getDispatchMessage, refreshDispatchMessages } from "./dispatch-message.js";

(() => {
  const TM_PRODUCT_PLACEHOLDER_IMAGE = "/novy/images/tm-product-placeholder-box.jpg";
  const TM_INK_PLACEHOLDER_IMAGE = "/novy/images/tm-ink-placeholder-box.jpg";

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


  function ensureProductImageFitStyles() {
    if (document.getElementById("tm-product-image-fit-styles")) return;
    const style = document.createElement("style");
    style.id = "tm-product-image-fit-styles";
    style.textContent = `
      .tm-row-photo {
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .tm-row-photo img,
      .main-image img {
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        object-position: center;
        display: block;
      }
      .tm-row-photo img {
        max-height: 124px;
      }
      .main-image {
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .image-zoom-modal[hidden] {
        display: none !important;
      }
      .image-zoom-modal:not([hidden]) {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .image-zoom-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(13, 28, 51, 0.72);
      }
      .image-zoom-card {
        position: relative;
        z-index: 1;
        width: min(920px, calc(100vw - 48px));
        height: min(720px, calc(100vh - 48px));
        background: #fff;
        border-radius: 24px;
        padding: 42px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        box-shadow: 0 24px 80px rgba(13, 28, 51, 0.28);
      }
      .image-zoom-card img {
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        object-position: center;
        display: block;
      }
      .image-zoom-close {
        position: absolute;
        top: 16px;
        right: 16px;
        z-index: 2;
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

  const DETAIL_CACHE_TTL = 24 * 60 * 60 * 1000;

  function productDetailCacheKey(slug) {
    return `tm_product_detail_v2:${String(slug || "")}`;
  }

  function readCachedProduct(slug) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(productDetailCacheKey(slug)) || "null");
      if (!cached || !cached.product || !cached.time) return null;
      if (Date.now() - cached.time > DETAIL_CACHE_TTL) return null;
      return cached.product;
    } catch {
      return null;
    }
  }

  function writeCachedProduct(slug, product) {
    try {
      if (!slug || !product) return;
      sessionStorage.setItem(productDetailCacheKey(slug), JSON.stringify({
        time: Date.now(),
        product,
      }));
    } catch {
      // Detail funguje aj bez sessionStorage cache.
    }
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>\"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    }[char]));
  }

  function money(value) {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function moneyPlain(value) {
    return new Intl.NumberFormat("sk-SK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function hashNumber(seed, min, max) {
    const text = String(seed || "produkt");
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    const normalized = Math.abs(hash);
    return min + (normalized % (max - min + 1));
  }

  function productStats(product) {
    const seed = product.sku || product.slug || product.name || product.id;
    const sold = hashNumber(seed, 67, 638);
    const ratingOptions = [5, 5, 5, 4.5, 4.5, 4];
    const rating = ratingOptions[hashNumber(seed, 0, ratingOptions.length - 1)];
    return { sold, rating };
  }

  function starsHtml(rating) {
    const full = Math.floor(Number(rating || 5));
    const half = Number(rating || 5) % 1 !== 0;
    let stars = "★".repeat(full);
    if (half) stars += "½";
    return `<span class="product-stars" aria-label="Hodnotenie ${esc(rating)} z 5">${stars}</span>`;
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

  function dispatchText(product) {
    return product.stock_status === "instock" ? getDispatchMessage() : "Termín dodania overíme";
  }


  function isProductInStock(product) {
    return product?.stock_status === "instock" && Number(product?.stock_quantity ?? 0) > 0;
  }

  function deliveryMissing(product) {
    const price = Number(product.price || 0);
    const missing = Math.max(0, 29 - price);
    return missing > 0 ? `Do dopravy zdarma chýba ${moneyPlain(missing)} €` : "Na tento produkt platí doprava zdarma";
  }

  function hasCompatibleBulkDiscount(product) {
    const type = String(product?.product_type_key || "").toLowerCase();
    const detail = String(product?.product_type_detail_label || product?.product_type_label || product?.name || "").toLowerCase();
    return type === "compatible" || detail.includes("kompatibil");
  }

  function bulkDiscountNoticeHtml(product) {
    if (!hasCompatibleBulkDiscount(product)) return "";
    return `
      <div class="bulk-discount-strip">
        <span class="bulk-discount-icon">%</span>
        <p><strong>Pri nákupe od 2 ks zľava 10 %, od 4 ks zľava 25 %.</strong><br><small>Zľava sa uplatní automaticky v košíku aj pokladni.</small></p>
      </div>
    `;
  }



  function colorKey(value) {
    const c = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (c.includes("cier") || c.includes("black") || c === "k") return "black";
    if (c.includes("cyan") || c.includes("azur") || c.includes("modr")) return "cyan";
    if (c.includes("purp") || c.includes("magenta") || c.includes("cerv") || c.includes("ruž") || c.includes("ruz")) return "magenta";
    if (c.includes("yellow") || c.includes("zlt") || c.includes("žlt")) return "yellow";
    return "";
  }

  function colorLabelByKey(key) {
    return {
      black: "Black",
      cyan: "Cyan",
      magenta: "Purpurová",
      yellow: "Yellow",
    }[key] || "Farba";
  }

  function colorKeyFromCode(code) {
    const clean = normalizeSeriesCode(code);
    if (!clean) return "";

    let match = clean.match(/^W\d{3}([0-3])A?$/);
    if (match) return { "0": "black", "1": "cyan", "2": "yellow", "3": "magenta" }[match[1]] || "";

    match = clean.match(/^(?:CF|CE|CB)\d{2}([0-3])(?:A|X|XC|YC|AC)?$/);
    if (match) return { "0": "black", "1": "cyan", "2": "yellow", "3": "magenta" }[match[1]] || "";

    match = clean.match(/(?:BK|BLACK|K)$/);
    if (match) return "black";
    match = clean.match(/(?:C|CYAN)$/);
    if (match) return "cyan";
    match = clean.match(/(?:M|MAGENTA)$/);
    if (match) return "magenta";
    match = clean.match(/(?:Y|YELLOW)$/);
    if (match) return "yellow";

    return "";
  }

  function productColorKey(product) {
    const direct = colorKey(product?.color || product?.colour || product?.farba || "");
    if (direct) return direct;
    for (const code of extractProductCodes(product)) {
      const fromCode = colorKeyFromCode(code);
      if (fromCode) return fromCode;
    }
    return colorKey(product?.name || "");
  }

  function extractProductCodes(product) {
    const text = `${product?.sku || ""} ${product?.name || ""}`.toUpperCase();
    const codes = [];
    const patterns = [
      /\bW\d{4}[A-Z]?\b/g,
      /\b(?:CF|CE|CB|Q)\d{3}[A-Z]{0,2}\b/g,
      /\bCRG[-\s]?\d{3,4}[A-Z]{0,3}\b/g,
      /\b(?:PGI|CLI|PG|CL)\d{2,4}[A-Z]{0,3}\b/g,
      /\bT\d{3,5}[A-Z]{0,4}\b/g,
      /\b[A-Z]{2,5}[-\s]?\d{2,5}[A-Z]{0,4}\b/g,
    ];

    patterns.forEach((pattern) => {
      for (const match of text.matchAll(pattern)) {
        const code = match[0].replace(/\s+/g, "").replace(/CRG(\d)/, "CRG-$1").toUpperCase();
        if (!codes.includes(code)) codes.push(code);
      }
    });

    return codes;
  }

  function productDisplayCode(product) {
    return extractProductCodes(product)[0] || String(product?.sku || "").toUpperCase() || String(product?.name || "").split(/\s+/).slice(0, 2).join(" ");
  }

  function normalizeSeriesCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function seriesSearchKeyFromCode(code) {
    const clean = normalizeSeriesCode(code);
    if (!clean) return "";

    let match = clean.match(/^W(\d{3})[0-3]A?$/);
    if (match) return `W${match[1]}`;

    match = clean.match(/^(CF|CE|CB)(\d{2})[0-3](?:A|X|XC|YC|AC)?$/);
    if (match) return `${match[1]}${match[2]}`;

    match = clean.match(/^(CRG)(\d{3,4})(BK|BLACK|C|M|Y|K)$/);
    if (match) return `${match[1]}${match[2]}`;

    match = clean.match(/^(TN|LC|BU|WT|PGI|CLI|PG|CL|T)(\d{2,5})(BK|BLACK|C|M|Y|K)$/);
    if (match) return `${match[1]}${match[2]}`;

    match = clean.match(/^(CRG)(\d{3,4})[A-Z]{1,3}$/);
    if (match) return `${match[1]}${match[2]}`;

    match = clean.match(/^(PGI|CLI|PG|CL)(\d{2,4})[A-Z]{1,3}$/);
    if (match) return `${match[1]}${match[2]}`;

    match = clean.match(/^(T\d{3,4})[A-Z]{1,4}$/);
    if (match) return match[1];

    match = clean.match(/^(TN|LC|BU|WT)(\d{2,5})[A-Z]{0,4}$/);
    if (match) return `${match[1]}${match[2]}`;

    return "";
  }

  function seriesSearchKey(product) {
    const codes = extractProductCodes(product);
    for (const code of codes) {
      const key = seriesSearchKeyFromCode(code);
      if (key) return key;
    }
    return "";
  }

  function sameSeries(product, candidate, key) {
    const cleanKey = normalizeSeriesCode(key);
    if (!cleanKey) return false;
    const candidateCodes = extractProductCodes(candidate).map(normalizeSeriesCode);
    if (candidateCodes.some((code) => code.startsWith(cleanKey))) return true;
    const text = `${candidate?.sku || ""} ${candidate?.name || ""}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return text.includes(cleanKey);
  }

  function buildSeriesColorItem(product) {
    const key = productColorKey(product);
    if (!key) return null;
    return {
      id: String(product?.id || product?.sku || product?.slug || product?.name || ""),
      code: productDisplayCode(product),
      label: colorLabelByKey(key),
      dot: key,
      url: product?.detail_url || `/novy/produkt/${product?.slug || product?.id || ""}`,
    };
  }

  function seriesColorsHtml(items) {
    if (!items.length) return "";
    return `
      <div class="series-colors-strip" aria-label="Ďalšie farby série">
        <strong>Ďalšie farby:</strong>
        <div class="series-color-pills">
          ${items.map((item) => `
            <a class="series-color-pill series-color-pill--${item.dot}" href="${esc(item.url)}" title="${esc(item.code)} ${esc(item.label)}">
              <span aria-hidden="true"></span>${esc(item.label)}
            </a>
          `).join("")}
        </div>
      </div>
    `;
  }

  async function hydrateSeriesColors(product) {
    const holder = document.querySelector("[data-series-colors]");
    if (!holder) return;

    const key = seriesSearchKey(product);
    if (!key) return;

    try {
      const currentId = String(product?.id || product?.sku || product?.slug || "");
      const currentColor = productColorKey(product);
      const products = await fetchProductsBySearch(key, 96);
      const sameType = String(product?.product_type_key || "");
      const pickedByColor = new Map();

      products
        .filter((item) => String(item?.id || item?.sku || item?.slug || "") !== currentId)
        .filter((item) => !sameType || item.product_type_key === sameType)
        .filter((item) => sameSeries(product, item, key))
        .forEach((item) => {
          const itemColor = productColorKey(item);
          if (!itemColor || itemColor === currentColor || pickedByColor.has(itemColor)) return;
          const built = buildSeriesColorItem(item);
          if (built) pickedByColor.set(itemColor, built);
        });

      const order = ["black", "cyan", "magenta", "yellow"];
      const items = order.map((itemColor) => pickedByColor.get(itemColor)).filter(Boolean);
      if (items.length < 1) return;
      holder.innerHTML = seriesColorsHtml(items);
      holder.closest("[data-series-wide-section]")?.removeAttribute("hidden");
    } catch {
      holder.innerHTML = "";
    }
  }

  function isSetColorAvailable(product) {
    return product && Number(product.price || 0) > 0 && product.stock_status === "instock";
  }

  function seriesPackName(key) {
    const clean = String(key || "").toUpperCase();
    return clean ? `${clean} CMYK sada` : "CMYK sada";
  }

  function buildSeriesPackHtml(pack) {
    if (!pack || !pack.items?.length) return "";
    return `
      <div class="series-pack-card" data-series-pack-card>
        <div class="series-pack-head">
          <span class="series-pack-icon">CMYK</span>
          <div>
            <strong>Výhodná sada ${esc(pack.keyLabel)}</strong>
            <small>4 farby v jednej sade so zľavou 5 % oproti nákupu po kusoch.</small>
          </div>
        </div>

        <div class="series-pack-items">
          ${pack.items.map((item) => `
            <a class="series-pack-item series-pack-item--${item.colorKey}" href="${esc(getProductUrl(item))}" title="${esc(item.name)}">
              <span aria-hidden="true"></span>
              <strong>${esc(item.code)}</strong>
              <small>${esc(colorLabelByKey(item.colorKey))}</small>
            </a>
          `).join("")}
        </div>

        <div class="series-pack-price">
          <span>
            <small>Samostatne ${money(pack.originalTotal)}</small>
            <strong>Sada ${money(pack.discountedTotal)}</strong>
          </span>
          <em>Ušetríte ${money(pack.saving)}</em>
          <button type="button" data-add-series-pack>Pridať sadu do košíka</button>
        </div>
      </div>
    `;
  }

  function makeSeriesPackItem(product, itemColor) {
    return {
      ...product,
      colorKey: itemColor,
      code: productDisplayCode(product),
      price: Number(product.price || 0),
      detail_url: product.detail_url || `/novy/produkt/${product.slug || product.id || ""}`,
    };
  }

  function buildSeriesPack(product, candidates, key) {
    const sameType = String(product?.product_type_key || "");
    const byColor = new Map();
    const currentColor = productColorKey(product);

    if (currentColor && isSetColorAvailable(product)) {
      byColor.set(currentColor, makeSeriesPackItem(product, currentColor));
    }

    const sorted = [...candidates]
      .filter((item) => !sameType || item.product_type_key === sameType)
      .filter((item) => sameSeries(product, item, key))
      .filter(isSetColorAvailable)
      .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));

    sorted.forEach((item) => {
      const itemColor = productColorKey(item);
      if (!itemColor || byColor.has(itemColor)) return;
      byColor.set(itemColor, makeSeriesPackItem(item, itemColor));
    });

    const order = ["black", "cyan", "magenta", "yellow"];
    const items = order.map((itemColor) => byColor.get(itemColor)).filter(Boolean);
    if (items.length !== 4) return null;

    const originalTotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
    if (originalTotal <= 0) return null;

    const discountedTotal = Math.round(originalTotal * 0.95 * 100) / 100;
    return {
      key,
      keyLabel: seriesPackName(key),
      items,
      originalTotal,
      discountedTotal,
      saving: Math.round((originalTotal - discountedTotal) * 100) / 100,
    };
  }

  function addSeriesPackToCart(pack) {
    if (!pack?.items?.length) return;

    pack.items.forEach((item) => {
      addToCart({
        ...item,
        id: item.id || item.sku || item.code,
        sku: item.sku || item.code || String(item.id || ""),
        name: item.name,
        price: Number(item.price || 0),
        qty: 1,
        product_type_key: item.product_type_key || "compatible",
        product_type_label: item.product_type_label || "Kompatibilný",
        series_pack_key: pack.key,
        series_pack_label: pack.keyLabel,
        series_pack_discount_rate: 0.05,
      }, 1);
    });
  }

  async function hydrateSeriesPack(product) {
    const holder = document.querySelector("[data-series-pack]");
    if (!holder) return;

    const key = seriesSearchKey(product);
    if (!key) return;

    try {
      const products = await fetchProductsBySearch(key, 96);
      const pack = buildSeriesPack(product, products, key);
      if (!pack) {
        holder.innerHTML = "";
        return;
      }

      holder.innerHTML = buildSeriesPackHtml(pack);
      holder.closest("[data-series-wide-section]")?.removeAttribute("hidden");
      holder.querySelector("[data-add-series-pack]")?.addEventListener("click", (event) => {
        addSeriesPackToCart(pack);
        const button = event.currentTarget;
        const original = button.textContent;
        button.textContent = "Sada pridaná ✓";
        button.disabled = true;
        setTimeout(() => {
          button.textContent = original;
          button.disabled = false;
        }, 1400);
      });
    } catch {
      holder.innerHTML = "";
    }
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

    if (direct && direct !== "#") {
      if (direct.startsWith("/novy/")) return direct;
      if (direct.startsWith("/produkt/")) return `/novy${direct}`;
      if (direct.startsWith("produkt/")) return `/novy/${direct}`;

      try {
        const parsed = new URL(direct, window.location.origin);
        if (parsed.origin === window.location.origin && parsed.pathname.startsWith("/produkt/")) {
          return `/novy${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {
        // Neplatná URL sa nahradí cestou vytvorenou zo slugu.
      }

      return direct;
    }

    const slug = String(product?.slug || "").trim();
    if (slug) return `/novy/produkt/${encodeURIComponent(slug)}`;
    return "/novy/produkty";
  }

  function addToCart(product, qty) {
    const quantity = Math.max(1, Math.min(99, Number(qty || 1)));

    if (window.ToneryMaximCart && typeof window.ToneryMaximCart.addToCart === "function") {
      const cartProduct = { ...product, qty: quantity };
      window.ToneryMaximCart.addToCart(cartProduct);
      if (typeof window.ToneryMaximCart.showAddCartDrawer === "function") window.ToneryMaximCart.showAddCartDrawer(cartProduct);
      return;
    }

    const cart = readCart();
    const id = String(product.id || product.sku || product.name);
    const existing = cart.find((item) => String(item.id) === id);

    if (existing) {
      existing.qty = Number(existing.qty || 1) + quantity;
      existing.url = existing.url && existing.url !== "#" ? existing.url : cartProductUrl({ ...product, url: product.detail_url || window.location.pathname });
      existing.slug = existing.slug || product.slug || "";
      existing.color = existing.color || product.color || "";
      existing.capacity = existing.capacity || cartProductCapacity(product);
      existing.yield = existing.yield || product.yield || "";
      existing.page_yield = existing.page_yield || product.page_yield || "";
      existing.warranty = existing.warranty || product.warranty || "";
      existing.stock_status = product.stock_status || existing.stock_status || "";
      existing.stock_quantity = product.stock_quantity ?? existing.stock_quantity ?? null;
      existing.stock_text = existing.stock_text || (typeof stockText === "function" ? stockText(product) : "");
    }
    else {
      cart.push({
        id,
        sku: product.sku || "",
        name: product.name,
        price: Number(product.price || 0),
        image: product.image || "",
        url: cartProductUrl({ ...product, url: product.detail_url || window.location.pathname }),
        slug: product.slug || "",
        qty: quantity,
        product_type_key: product.product_type_key || "",
        product_type_label: product.product_type_label || product.product_type_detail_label || "",
        series_pack_key: product.series_pack_key || "",
        series_pack_label: product.series_pack_label || "",
        series_pack_discount_rate: Number(product.series_pack_discount_rate || 0),
        color: product.color || "",
        capacity: cartProductCapacity(product),
        yield: product.yield || "",
        page_yield: product.page_yield || "",
        warranty: product.warranty || "",
        stock_status: product.stock_status || "",
        stock_quantity: product.stock_quantity ?? null,
        stock_text: stockText(product),
      });
    }

    saveCart(cart);
  }

  function ensureAvailabilityModal() {
    let modal = document.querySelector(".pd-availability-modal");
    if (modal) return modal;

    modal = document.createElement("dialog");
    modal.className = "pd-availability-modal";
    modal.innerHTML = `
      <form class="pd-availability-card" method="dialog" data-pd-availability-form>
        <button class="pd-modal-close" type="button" data-pd-availability-close aria-label="Zavrieť">×</button>
        <p class="pd-availability-eyebrow">Overenie dostupnosti</p>
        <h2>Opýtať sa na produkt</h2>
        <label>
          Produkt
          <input type="text" name="product" data-pd-availability-product readonly>
        </label>
        <label>
          Otázka
          <textarea name="message" rows="4" data-pd-availability-message>Poprosím o overenie dostupnosti daného produktu.</textarea>
        </label>
        <div class="pd-availability-grid">
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
        <button class="pd-availability-submit" type="submit">Odoslať otázku</button>
        <p class="pd-availability-note">Formulár otvorí pripravený e-mail pre zákaznícku podporu.</p>
      </form>
    `;
    document.body.appendChild(modal);

    modal.querySelector("[data-pd-availability-close]").addEventListener("click", () => modal.close());
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.close();
    });
    modal.querySelector("[data-pd-availability-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const productName = String(data.get("product") || "");
      const message = String(data.get("message") || "");
      const name = String(data.get("name") || "");
      const email = String(data.get("email") || "");
      const phone = String(data.get("phone") || "");
      const body = [
        message,
        "",
        `Produkt: ${productName}`,
        `Meno: ${name}`,
        `E-mail: ${email}`,
        phone ? `Mobil: ${phone}` : "Mobil: neuvedený",
      ].join("\n");
      window.location.href = `mailto:info@tonerymaxim.sk?subject=${encodeURIComponent(`Overenie dostupnosti: ${productName}`)}&body=${encodeURIComponent(body)}`;
      modal.close();
    });

    return modal;
  }

  function openAvailabilityModal(product) {
    const modal = ensureAvailabilityModal();
    modal.querySelector("[data-pd-availability-product]").value = product?.name || "";
    modal.querySelector("[data-pd-availability-message]").value = "Poprosím o overenie dostupnosti daného produktu.";
    if (modal instanceof HTMLDialogElement) modal.showModal();
  }

  function productTheme(product) {
    const key = product.product_type_key || "product";
    if (key === "original") {
      return { key, label: "ORIGINÁL", note: "Originálna kvalita výrobcu", icon: "🏅" };
    }
    if (key === "compatible") {
      return { key, label: "KOMPATIBILNÝ", note: "Výhodná alternatíva", icon: "⭐" };
    }
    if (key === "renovated") {
      return { key, label: "RENOVOVANÝ", note: "Ekologická voľba", icon: "♻️" };
    }
    return { key: "other", label: product.product_type_label || "PRODUKT", note: "Spotrebný materiál", icon: "✓" };
  }

  function colorEmoji(color) {
    const c = String(color || "").toLowerCase();
    if (c.includes("žlt") || c.includes("zlt") || c.includes("yellow")) return "🟡";
    if (c.includes("azú") || c.includes("azur") || c.includes("cyan")) return "🔵";
    if (c.includes("purp") || c.includes("magenta")) return "🟣";
    if (c.includes("čier") || c.includes("cier") || c.includes("black")) return "⚫";
    if (c.includes("cmyk") || c.includes("multi")) return "🌈";
    return "●";
  }

  function normalizeYield(product) {
    return product.yield || product.page_yield || product.capacity || product.kapacita || "Neuvedené";
  }

  function productWarranty(product) {
    const value = product.warranty || product.zaruka || product.guarantee || "";
    return isMissingValue(value) ? "24 mesiacov" : value;
  }


  function applyMobileParameterVisibility(root) {
    if (!root) return;

    const hiddenLabels = new Set([
      "vyrobca tlaciarne",
      "vyrobca tlaciarni",
      "seria tlaciarne",
      "seria tlaciarni",
      "model tlaciarne",
      "model tlaciarni",
    ]);

    const isMobile = window.matchMedia("(max-width: 820px)").matches;

    root.querySelectorAll(".params-card dl > div").forEach((row) => {
      const label = String(row.querySelector("dt")?.textContent || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      row.hidden = isMobile && hiddenLabels.has(label);
    });
  }

  function productAttributeRows(product) {
    const attrs = Array.isArray(product.attributes_all) ? product.attributes_all : Array.isArray(product.attributes) ? product.attributes : [];
    const skip = new Set(["farba", "color", "colour", "barva", "kapacita", "vytaznost", "vyťažnosť", "pocetstran", "početstrán", "pageyield", "yield", "pages", "zaruka", "záruka", "warranty", "vyrobcatlaciarne", "vyrobcatlaciarni", "manufacturer", "printermanufacturer", "seriatlaciarne", "seriatlaciarni", "printerseries", "series", "modeltlaciarne", "modeltlaciarni", "printermodel", "printermodels", "models"]);
    return attrs
      .map((attribute) => ({
        name: String(attribute?.name || "").trim(),
        value: String(attribute?.value || (Array.isArray(attribute?.values) ? attribute.values.join(", ") : "")).trim(),
        key: String(attribute?.slug || attribute?.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""),
      }))
      .filter((attribute) => attribute.name && attribute.value && !skip.has(attribute.key));
  }

  function productAttributeRowsHtml(product) {
    return productAttributeRows(product)
      .map((attribute) => `<div><dt>${esc(attribute.name)}</dt><dd>${esc(attribute.value)}</dd></div>`)
      .join("");
  }
  function normalizedAttributeKey(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  }

  function rawProductAttributes(product) {
    return Array.isArray(product.attributes_all) ? product.attributes_all : Array.isArray(product.attributes) ? product.attributes : [];
  }

  function productAttributeValue(product, acceptedKeys) {
    const wanted = new Set(acceptedKeys.map(normalizedAttributeKey));
    for (const attribute of rawProductAttributes(product)) {
      const key = normalizedAttributeKey(attribute?.slug || attribute?.name || "");
      if (!wanted.has(key)) continue;
      const value = String(attribute?.value || (Array.isArray(attribute?.values) ? attribute.values.join(", ") : "")).trim();
      if (value) return value;
    }
    return "";
  }

  function printerManufacturer(product) {
    const direct = productAttributeValue(product, ["Výrobca tlačiarne", "Výrobca tlačiarní", "Printer manufacturer", "Manufacturer"]);
    if (direct) return direct.split(/[,;|]/)[0].trim();
    const first = getPrinters(product)[0] || "";
    const known = first.match(/^(HP|Brother|Canon|Epson|Xerox|Samsung|Lexmark|Dell|Kyocera|OKI|Ricoh|Konica Minolta|Konica|Minolta|Utax|Panasonic|Toshiba)\b/i);
    return known ? known[0] : "";
  }

  function printerSeries(product) {
    const direct = productAttributeValue(product, ["Séria tlačiarne", "Séria tlačiarní", "Printer series", "Series"]);
    if (!direct) return [];
    const seen = new Set();
    return direct.split(/[,;|\n]/).map((value) => value.trim()).filter(Boolean).filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function compatibilityLink(value) {
    return printerProductsUrl(value);
  }

  function compatibilityNavigationHtml(product) {
    const manufacturer = printerManufacturer(product);
    const series = printerSeries(product);
    const printers = getPrinters(product);
    const visiblePrinters = printers.slice(0, 8);

    return `
      <div class="compat-navigation">
        <div class="compat-nav-group compat-nav-manufacturer">
          <span class="compat-nav-label">Výrobca tlačiarne</span>
          ${manufacturer ? `<a class="manufacturer-card" href="${compatibilityLink(manufacturer)}"><span class="manufacturer-mark">${esc(manufacturer.slice(0, 2).toUpperCase())}</span><span><strong>${esc(manufacturer)}</strong><small>Zobraziť všetky náplne výrobcu</small></span><b aria-hidden="true">→</b></a>` : `<p class="compat-empty">Výrobca nie je uvedený.</p>`}
        </div>

        <div class="compat-nav-group">
          <span class="compat-nav-label">Séria tlačiarne</span>
          <div class="series-links">
            ${series.length ? series.map((item) => `<a href="${compatibilityLink(item)}">${esc(item)}<span aria-hidden="true">→</span></a>`).join("") : `<span class="compat-empty">Séria nie je uvedená.</span>`}
          </div>
        </div>

        <div class="compat-nav-group compat-nav-models">
          <div class="compat-model-head"><span class="compat-nav-label">Modely tlačiarní</span><small>${printers.length ? `${printers.length} kompatibilných modelov` : "Kompatibilita bude doplnená"}</small></div>
          <div class="model-links">
            ${visiblePrinters.map((printer) => `<a href="${compatibilityLink(printer)}">${esc(printer)}<span aria-hidden="true">→</span></a>`).join("")}
            ${printers.length > visiblePrinters.length ? `<button type="button" data-show-compatible>+ Zobraziť všetkých ${printers.length} modelov</button>` : ""}
          </div>
        </div>
      </div>
    `;
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
        item.forEach((x) => values.push(typeof x === "string" ? x : x?.name || x?.title || x?.model));
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

  function printerProductsUrl(printer) {
    const url = new URL("/novy/produkty", window.location.origin);
    url.searchParams.set("printer", printer);
    return `${url.pathname}?${url.searchParams.toString()}`;
  }

  function compatibilitySummary(product) {
    const printers = getPrinters(product);
    if (!printers.length) return "Kompatibilné modely tlačiarní doplníme.";
    const shown = printers.slice(0, 4).join(", ");
    const rest = printers.length - 4;
    return rest > 0 ? `${shown} a ďalších ${rest} modelov` : shown;
  }

  function printersInlineHtml(product) {
    const printers = getPrinters(product);
    if (!printers.length) return `<p>Kompatibilita bude doplnená.</p>`;
    const visible = printers.slice(0, 6).map((printer) => `<a href="${printerProductsUrl(printer)}">${esc(printer)}</a>`).join("");
    const rest = Math.max(0, printers.length - 6);
    return `${visible}${rest ? `<button type="button" data-show-compatible>+ Zobraziť všetky (${printers.length})</button>` : ""}`;
  }

  function printersListHtml(product) {
    const printers = getPrinters(product);
    if (!printers.length) return `<p>Kompatibilita bude doplnená.</p>`;
    return `<div class="compat-grid">${printers.map((printer) => `<a href="${printerProductsUrl(printer)}">${esc(printer)}</a>`).join("")}</div>`;
  }

  function descriptionHtml(product) {
    const html = product.description_html || product.short_description_html || "";
    if (html && String(html).trim()) return html;
    return `<p>${esc(product.name)} je spotrebný materiál pre vašu tlačiareň. Pred nákupom odporúčame overiť kompatibilitu s modelom tlačiarne.</p>`;
  }

  function plainTextFromHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = String(html || "");
    return div.textContent.replace(/\s+/g, " ").trim();
  }

  function descriptionPreviewHtml(product) {
    const full = descriptionHtml(product);
    const plain = plainTextFromHtml(full);
    const short = plain.length > 310 ? `${plain.slice(0, 310).trim()}…` : plain;
    return `
      <p>${esc(short)}</p>
      ${plain.length > 310 ? `<button type="button" class="desc-more" data-show-description>Zobraziť celý popis produktu</button>` : ""}
    `;
  }

  function getProductUrl(product) {
    const direct = String(product?.detail_url || product?.url || "").trim();
    if (direct.startsWith("/novy/")) return direct;
    if (direct.startsWith("/produkt/")) return `/novy${direct}`;
    if (direct.startsWith("produkt/")) return `/novy/${direct}`;
    if (direct && direct !== "#") return direct;
    const slug = String(product?.slug || product?.id || "").trim();
    return slug ? `/novy/produkt/${encodeURIComponent(slug)}` : "#";
  }

  function productTypeLabel(typeKey) {
    if (typeKey === "original") return "ORIGINÁL";
    if (typeKey === "renovated") return "RENOVOVANÝ";
    if (typeKey === "compatible") return "KOMPATIBILNÝ";
    return "PRODUKT";
  }

  function realProductCardHtml(product, className = "mini-product") {
    const typeKey = product.product_type_key || "product";
    const image = productImageSrc(product.image || product.images?.[0] || "", product);
    return `
      <article class="${className} ${esc(typeKey)}" data-related-id="${esc(product.id || product.sku || product.slug)}">
        <a class="mini-img" href="${esc(getProductUrl(product))}">${image ? `<img src="${esc(image)}" alt="${esc(product.name)}" class="tm-product-fit-image">` : `<img src="${TM_PRODUCT_PLACEHOLDER_IMAGE}" alt="${esc(product.name)}">`}</a>
        <div>
          <span class="mini-badge">${esc(productTypeLabel(typeKey))}</span>
          <a class="mini-title" href="${esc(getProductUrl(product))}">${esc(product.name)}</a>
          <small>★★★★★ ${esc(String(productStats(product).rating).replace(".", ","))}/5</small>
          <strong>${money(product.price)}</strong>
        </div>
        <button type="button" data-related-add aria-label="Pridať do košíka">🛒</button>
      </article>
    `;
  }

  function accessoryIcon(title) {
    const text = String(title || "").toLowerCase();
    if (text.includes("papier")) return "📄";
    if (text.includes("šanón") || text.includes("sanon")) return "📁";
    if (text.includes("roller") || text.includes("pero") || text.includes("pilot")) return "✒️";
    return "TM";
  }

  function accessoryDisplayTitle(product) {
    if (product.tm_accessory_title) return product.tm_accessory_title;
    const text = String(product.name || "").toLowerCase();
    if (text.includes("papier")) return "Kancelársky papier";
    if (text.includes("šanón") || text.includes("sanon")) return "Pákový šanón";
    if (text.includes("roller") || text.includes("pilot")) return "Roller";
    return product.name || "Doplnkový produkt";
  }

  function accessoryCardHtml(product) {
    const title = accessoryDisplayTitle(product);
    const originalName = product.name && product.name !== title ? product.name : "";
    return `
      <article class="mini-product accessory-mini product" data-related-id="${esc(product.id || product.sku || product.slug)}">
        <div class="mini-copy">
          <span class="mini-badge">DOPLNKOVÝ PRODUKT</span>
          <a class="mini-title" href="${esc(getProductUrl(product))}">${esc(title)}</a>
          ${originalName ? `<small title="${esc(originalName)}">${esc(originalName)}</small>` : `<small>Praktický doplnok k objednávke</small>`}
          <strong>${money(product.price)}</strong>
        </div>
        <button type="button" data-related-add aria-label="Pridať do košíka">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h15l-2 9H8L6 6z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>
        </button>
      </article>
    `;
  }

  function extractSearchCodes(product) {
    const text = `${product.sku || ""} ${product.name || ""}`;
    const codes = [];
    const patterns = [
      /(?:TN|DR|LC|DK|BU|WT|CF|CE|CB|Q|W|CRG|PGI|CLI|PG|CL|T)\s*[-]?\s*\d{2,5}[A-Z0-9]*/gi,
      /[A-Z]{2,5}\s*[-]?\s*\d{2,5}[A-Z0-9]*/g,
    ];
    patterns.forEach((pattern) => {
      for (const match of text.matchAll(pattern)) {
        const clean = match[0].replace(/\s+/g, "").replace(/([A-Z]+)(\d)/i, "$1-$2").toUpperCase();
        if (!codes.includes(clean)) codes.push(clean);
      }
    });
    if (product.sku && !codes.includes(String(product.sku).toUpperCase())) codes.push(String(product.sku).toUpperCase());
    return codes.slice(0, 4);
  }

  async function fetchProductsBySearch(search, perPage = 24) {
    const url = new URL("/novy/api/products", window.location.origin);
    url.searchParams.set("s", search);
    url.searchParams.set("per_page", String(perPage));
    const response = await fetch(`${url.pathname}?${url.searchParams.toString()}`, { headers: { Accept: "application/json" } });
    const data = await response.json();
    return response.ok && data.ok && Array.isArray(data.products) ? data.products : [];
  }

  function uniquePushProduct(list, item, currentId = "") {
    const itemId = String(item?.id || item?.sku || item?.slug || "");
    if (!item || !itemId || itemId === currentId) return;
    if (list.some((existing) => String(existing.id || existing.sku || existing.slug) === itemId)) return;
    list.push(item);
  }

  function pickAlternativesByType(products, limit = 3) {
    const result = [];
    const groups = {
      compatible: products.filter((item) => item.product_type_key === "compatible"),
      original: products.filter((item) => item.product_type_key === "original"),
      renovated: products.filter((item) => item.product_type_key === "renovated"),
      other: products.filter((item) => !["compatible", "original", "renovated"].includes(item.product_type_key)),
    };

    ["compatible", "original", "renovated"].forEach((type) => {
      if (groups[type][0]) uniquePushProduct(result, groups[type][0]);
    });

    ["compatible", "original", "renovated", "other"].forEach((type) => {
      groups[type].forEach((item) => {
        if (result.length < limit) uniquePushProduct(result, item);
      });
    });

    return result.slice(0, limit);
  }

  async function findAlternatives(product) {
    const codes = extractSearchCodes(product);
    const currentId = String(product.id || product.sku || product.slug || "");
    const all = [];

    for (const code of codes) {
      const products = await fetchProductsBySearch(code, 96);
      products.forEach((item) => uniquePushProduct(all, item, currentId));
    }

    if (all.length < 3) {
      const printers = getPrinters(product).slice(0, 2);
      for (const printer of printers) {
        const products = await fetchProductsBySearch(printer, 36);
        products.forEach((item) => uniquePushProduct(all, item, currentId));
      }
    }

    if (all.length < 3) {
      const fallbackTerms = String(product.name || "")
        .replace(/kompatibiln[ýáéy]|origináln[ýáéy]|renovovan[ýáéy]|toner|kazeta|náplň|optický|valec/gi, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 4)
        .slice(0, 3)
        .join(" ");
      if (fallbackTerms) {
        const products = await fetchProductsBySearch(fallbackTerms, 36);
        products.forEach((item) => uniquePushProduct(all, item, currentId));
      }
    }

    return pickAlternativesByType(all, 3);
  }

  async function findAccessories() {
    const queries = [
      { search: "Kancelársky papier A4 80g 500", title: "Kancelársky papier" },
      { search: "pákový šanón", title: "Pákový šanón" },
      { search: "roller", title: "Roller" },
    ];
    const out = [];
    for (const query of queries) {
      const products = await fetchProductsBySearch(query.search, 18);
      const picked = products.find((item) => Number(item.price || 0) > 0) || products[0];
      if (picked && !out.some((existing) => String(existing.id) === String(picked.id))) {
        out.push({ ...picked, tm_accessory_title: query.title });
      }
    }
    return out;
  }

  function bindRelatedAddButtons(root, products) {
    const byId = new Map(products.map((item) => [String(item.id || item.sku || item.slug), item]));
    root.querySelectorAll("[data-related-add]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const card = event.currentTarget.closest("[data-related-id]");
        const product = byId.get(String(card?.dataset.relatedId || ""));
        if (!product) return;
        addToCart(product, 1);
        const original = event.currentTarget.textContent;
        event.currentTarget.textContent = "✓";
        setTimeout(() => { event.currentTarget.textContent = original || "🛒"; }, 900);
      });
    });
  }

  async function hydrateExtraProducts(currentProduct) {
    const root = document.querySelector("[data-product-root]");
    if (!root) return;

    const [accessories, alternatives] = await Promise.all([
      findAccessories(),
      findAlternatives(currentProduct),
    ]);

    const accessoriesRoot = root.querySelector("[data-accessories]");
    if (accessoriesRoot) {
      accessoriesRoot.innerHTML = accessories.length
        ? accessories.map(accessoryCardHtml).join("")
        : `<p class="related-empty">Doplnkové produkty sa nepodarilo načítať.</p>`;
      bindRelatedAddButtons(root, accessories);
    }

    const alternativesRoot = root.querySelector("[data-alternatives]");
    if (alternativesRoot) {
      alternativesRoot.innerHTML = alternatives.length
        ? alternatives.map((item) => realProductCardHtml(item)).join("")
        : `<p class="related-empty">Alternatívy sa nepodarilo načítať.</p>`;
      bindRelatedAddButtons(root, alternatives);
    }
  }

  function render(product) {
    ensureProductImageFitStyles();
    const root = document.querySelector("[data-product-root]");
    if (!root) return;

    const rawImages = product.images?.length ? product.images : product.image ? [product.image] : [];
    const images = Array.from(new Set((rawImages.length ? rawImages : [TM_PRODUCT_PLACEHOLDER_IMAGE]) .map((image) => productImageSrc(image, product)).filter(Boolean)));
    const theme = productTheme(product);
    const productColor = product.color || "Neuvedené";
    const productYield = normalizeYield(product);
    const productWarrantyValue = productWarranty(product);
    const stats = productStats(product);
    const priceWithoutVat = Number(product.price || 0) / 1.23;
    const printers = getPrinters(product);

    root.className = `tm-detail product-theme-${theme.key}`;
    root.setAttribute("aria-busy", "false");

    root.innerHTML = `
      <section class="detail-hero-card">
        <div class="product-gallery">
          <div class="thumbs" aria-label="Galéria produktu">
            ${images.slice(0, 4).map((image, index) => `
              <button type="button" data-image="${esc(image)}" class="${index === 0 ? "active" : ""}">
                <img src="${esc(image)}" alt="">
              </button>
            `).join("")}
          </div>

          <div class="main-image">
            <img src="${esc(images[0] || TM_PRODUCT_PLACEHOLDER_IMAGE)}" alt="${esc(product.name)}" class="tm-product-fit-image">
            <button type="button" class="zoom-button" data-zoom-image aria-label="Zväčšiť obrázok">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            </button>
          </div>
        </div>

        <div class="product-info">
          <div class="badge-row">
            <span class="type-badge">${esc(theme.label)}</span>
            <span class="type-note">${theme.icon} ${esc(theme.note)}</span>
          </div>

          <h1>${esc(product.name)}</h1>

          <div class="rating-row">
            ${starsHtml(stats.rating)}
            <strong>${String(stats.rating).replace(".", ",")}/5</strong>
            <span>Predaných viac ako ${stats.sold} ks</span>
          </div>

          <p class="summary-subtitle">${esc(product.product_type_detail_label || product.description || "Spotrebný materiál pre vašu tlačiareň.")}</p>

          <div class="compat-preview">
            <span>Kompatibilné s</span>
            <strong>${esc(compatibilitySummary(product))}</strong>
            ${printers.length ? `<button type="button" data-show-compatible>Zobraziť všetky kompatibilné modely ›</button>` : ""}
          </div>

          <div class="chips chips-inline">
            <span class="chip chip-color">${colorEmoji(productColor)} ${esc(productColor)}</span>
            <span class="chip">📄 ${esc(productYield)}</span>
            <span class="chip">🛡️ ${esc(productWarrantyValue)}</span>
          </div>

          <div class="stock-line ${isProductInStock(product) ? "is-available" : "is-unavailable"}">
            <strong>${esc(stockText(product))}</strong>
            <span data-tm-dispatch-message>${esc(dispatchText(product))}</span>
          </div>

          ${bulkDiscountNoticeHtml(product)}
        </div>

        <aside class="purchase-panel">
          <span class="vat-label">Cena s DPH</span>
          <div class="price-row"><strong>${money(product.price)}</strong><span>s DPH</span></div>
          <small class="no-vat">bez DPH ${moneyPlain(priceWithoutVat)} €</small>

          <div class="purchase-status ${isProductInStock(product) ? "is-available" : "is-unavailable"}">
            <strong>● ${esc(stockText(product))}</strong>
            <span data-tm-dispatch-message>${esc(dispatchText(product))}</span>
          </div>

          <div class="delivery-box">
            <strong>🚚 Doručenie od 2,90 €</strong>
            <strong>🎁 Nad 29 € doprava zdarma</strong>
            <span>${esc(deliveryMissing(product))}</span>
          </div>

          <a class="heureka-mini" href="https://obchody.heureka.sk/tonerymaxim-sk/recenze/?e=reviews&p=left" target="_blank" rel="noopener noreferrer">
            <span>★★★★★</span>
            <strong>5,0/5</strong>
            <small>1 323 recenzií</small>
          </a>

          <label>Množstvo</label>
          <div class="qty-row">
            <button type="button" data-qty-minus>-</button>
            <input type="number" data-qty value="1" min="1" max="99">
            <button type="button" data-qty-plus>+</button>
          </div>

          <button type="button" class="add-main ${isProductInStock(product) ? "" : "availability-main"}" data-add-main>
            ${isProductInStock(product) ? `<svg viewBox="0 0 24 24"><path d="M6 6h15l-2 9H8L6 6z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>Pridať do košíka` : `Overiť dostupnosť`}
          </button>

          ${isProductInStock(product) ? `<button type="button" class="buy-now" data-buy-now>Kúpiť ihneď</button>` : ""}

          <div class="purchase-note">
            <span>✓ Bezpečný nákup</span>
            <span>✓ Pomoc s výberom</span>
          </div>
        </aside>
      </section>

      <section class="series-wide-section" data-series-wide-section hidden>
        <div class="section-head">
          <h2>Farby a sada tejto série</h2>
          <p>Ak má séria viac farieb, zobrazíme ich tu na rýchly preklik alebo nákup celej CMYK sady.</p>
        </div>
        <div data-series-colors></div>
        <div data-series-pack></div>
      </section>

      <section class="info-grid">
        <article class="params-card">
          <h2>Parametre produktu</h2>
          <dl>
            <div><dt>Typ produktu</dt><dd>${esc(product.product_type_detail_label || product.product_type_label || theme.label)}</dd></div>
            <div><dt>Farba</dt><dd>${esc(productColor)}</dd></div>
            <div><dt>Výťažnosť</dt><dd>${esc(productYield)}</dd></div>
            <div><dt>Záruka</dt><dd>${esc(productWarrantyValue)}</dd></div>
            ${productAttributeRowsHtml(product)}
            <div><dt>Dostupnosť</dt><dd>${esc(stockText(product))}</dd></div>
            <div><dt>Kód produktu</dt><dd>${esc(product.sku || "bez SKU")}</dd></div>
          </dl>
        </article>

        <article class="description-card">
          <h2>Popis produktu</h2>
          <div class="product-description product-description-preview">${descriptionPreviewHtml(product)}</div>
          <div class="micro-benefits">
            <div><span>🛡️</span><strong>Overená kompatibilita</strong><small>Vhodné pre uvedené modely.</small></div>
            <div><span>🚚</span><strong>Rýchle doručenie</strong><small>Skladom expedujeme čo najskôr.</small></div>
            <div><span>♻️</span><strong>Šetrné riešenie</strong><small>Rozumná voľba pre kanceláriu.</small></div>
            <div><span>☎</span><strong>Pomoc s výberom</strong><small>Poradíme pred nákupom.</small></div>
          </div>
        </article>
      </section>

      <section class="compat-section compat-section-modern" id="compatible-printers">
        <div class="section-head compat-section-head">
          <div>
            <span class="section-eyebrow">Jednoduchý výber podľa tlačiarne</span>
            <h2>Kompatibilné tlačiarne</h2>
          </div>
          <p>${printers.length ? `Produkt je vhodný pre ${printers.length} modelov tlačiarní.` : "Kompatibilita bude doplnená."}</p>
        </div>
        ${compatibilityNavigationHtml(product)}
      </section>

      <section class="related-section related-section-stacked">
        <div class="related-column related-column-alternatives">
          <div class="related-title-row"><h2>Alternatívy k produktu</h2><span>Porovnajte dostupné varianty</span></div>
          <div class="alternative-grid" data-alternatives>
            <p class="related-loading">Načítavam skutočné alternatívy…</p>
          </div>
        </div>

        <div class="related-column related-column-accessories">
          <div class="related-title-row"><h2>Často kupované spolu</h2><span>Praktické doplnky k objednávke</span></div>
          <div class="accessory-grid" data-accessories>
            <p class="related-loading">Načítavam doplnkové produkty…</p>
          </div>
        </div>
      </section>

      <div class="compat-modal" data-compat-modal hidden>
        <div class="compat-modal-card">
          <button type="button" class="modal-close" data-close-compatible>×</button>
          <h2>Všetky kompatibilné modely tlačiarní</h2>
          <p>Kliknutím na model otvoríte výpis produktov pre danú tlačiareň.</p>
          ${printersListHtml(product)}
        </div>
      </div>

      <div class="description-modal" data-description-modal hidden>
        <div class="description-modal-card">
          <button type="button" class="modal-close" data-close-description>×</button>
          <h2>Popis produktu</h2>
          <div class="description-modal-content">${descriptionHtml(product)}</div>
        </div>
      </div>

      <div class="image-zoom-modal" data-image-zoom-modal hidden>
        <div class="image-zoom-backdrop" data-close-zoom></div>
        <div class="image-zoom-card" role="dialog" aria-modal="true" aria-label="Zväčšený obrázok produktu">
          <button type="button" class="image-zoom-close" data-close-zoom aria-label="Zavrieť zväčšený obrázok">×</button>
          <img src="${esc(images[0] || TM_PRODUCT_PLACEHOLDER_IMAGE)}" alt="${esc(product.name)}" data-zoom-modal-image class="tm-product-fit-image">
        </div>
      </div>

      <div class="product-mobile-sticky-cart" data-mobile-sticky-cart aria-hidden="true">
        <div>
          <span>${esc(stockText(product))}</span>
          <strong>${money(product.price)}</strong>
        </div>
        <button type="button" class="${isProductInStock(product) ? "" : "availability-main"}" data-mobile-sticky-add>
          ${isProductInStock(product) ? "Pridať do košíka" : "Overiť dostupnosť"}
        </button>
      </div>
    `;

    root.querySelectorAll("[data-image]").forEach((button) => {
      button.addEventListener("click", () => {
        const image = button.dataset.image || "";
        const mainImage = root.querySelector(".main-image");
        if (!mainImage) return;
        mainImage.innerHTML = `
          <img src="${esc(image)}" alt="${esc(product.name)}" class="tm-product-fit-image">
          <button type="button" class="zoom-button" data-zoom-image aria-label="Zväčšiť obrázok">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          </button>
        `;
        root.querySelectorAll("[data-image]").forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
      });
    });

    function openZoomModal() {
      const modal = root.querySelector("[data-image-zoom-modal]");
      const modalImage = root.querySelector("[data-zoom-modal-image]");
      const mainImage = root.querySelector(".main-image img");
      if (!modal || !modalImage || !mainImage) return;
      modalImage.src = mainImage.getAttribute("src") || TM_PRODUCT_PLACEHOLDER_IMAGE;
      modalImage.alt = product.name || "Produkt";
      modal.hidden = false;
      document.body.classList.add("image-zoom-open");
    }

    function closeZoomModal() {
      const modal = root.querySelector("[data-image-zoom-modal]");
      if (!modal) return;
      modal.hidden = true;
      document.body.classList.remove("image-zoom-open");
    }

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (target?.closest?.("[data-zoom-image]")) openZoomModal();
      if (target?.closest?.("[data-close-zoom]")) closeZoomModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeZoomModal();
    });

    const qtyInput = root.querySelector("[data-qty]");

    root.querySelector("[data-qty-minus]")?.addEventListener("click", () => {
      qtyInput.value = String(Math.max(1, Number(qtyInput.value || 1) - 1));
    });

    root.querySelector("[data-qty-plus]")?.addEventListener("click", () => {
      qtyInput.value = String(Math.min(99, Number(qtyInput.value || 1) + 1));
    });

    function addCurrentProductAndConfirm(button) {
      if (!isProductInStock(product)) {
        openAvailabilityModal(product);
        return;
      }
      addToCart(product, qtyInput.value);
      if (!button) return;
      const original = button.innerHTML;
      button.textContent = "Pridané do košíka ✓";
      setTimeout(() => {
        button.innerHTML = original;
      }, 1200);
    }

    root.querySelector("[data-add-main]")?.addEventListener("click", (event) => {
      addCurrentProductAndConfirm(event.currentTarget);
    });

    root.querySelector("[data-mobile-sticky-add]")?.addEventListener("click", (event) => {
      addCurrentProductAndConfirm(event.currentTarget);
    });

    const stickyCart = root.querySelector("[data-mobile-sticky-cart]");
    const mainAddButton = root.querySelector("[data-add-main]");
    if (stickyCart && mainAddButton) {
      const setStickyVisible = (visible) => {
        stickyCart.classList.toggle("is-visible", Boolean(visible));
        stickyCart.setAttribute("aria-hidden", String(!visible));
      };

      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries) => {
          const entry = entries[0];
          setStickyVisible(!entry.isIntersecting);
        }, { threshold: 0.15 });
        observer.observe(mainAddButton);
      } else {
        const onScroll = () => setStickyVisible(window.scrollY > 520);
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
      }
    }

    root.querySelector("[data-buy-now]")?.addEventListener("click", () => {
      if (!isProductInStock(product)) {
        openAvailabilityModal(product);
        return;
      }
      addToCart(product, qtyInput.value);
      window.location.href = "/novy/pokladna";
    });

    root.querySelector("[data-show-description]")?.addEventListener("click", () => {
      const modal = root.querySelector("[data-description-modal]");
      if (!modal) return;
      modal.hidden = false;
      document.body.classList.add("tm-modal-open");
    });

    root.querySelector("[data-close-description]")?.addEventListener("click", () => {
      const modal = root.querySelector("[data-description-modal]");
      if (!modal) return;
      modal.hidden = true;
      document.body.classList.remove("tm-modal-open");
    });

    root.querySelector("[data-description-modal]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        event.currentTarget.hidden = true;
        document.body.classList.remove("tm-modal-open");
      }
    });


    applyMobileParameterVisibility(root);

    const mobileParameterMedia = window.matchMedia("(max-width: 820px)");
    const refreshMobileParameterVisibility = () => applyMobileParameterVisibility(root);
    if (typeof mobileParameterMedia.addEventListener === "function") {
      mobileParameterMedia.addEventListener("change", refreshMobileParameterVisibility, { once: true });
    } else if (typeof mobileParameterMedia.addListener === "function") {
      mobileParameterMedia.addListener(refreshMobileParameterVisibility);
    }

    hydrateSeriesColors(product);
    hydrateSeriesPack(product);
    hydrateExtraProducts(product);

    root.querySelectorAll("[data-show-compatible]").forEach((button) => {
      button.addEventListener("click", () => {
        const modal = root.querySelector("[data-compat-modal]");
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add("tm-modal-open");
      });
    });

    root.querySelector("[data-close-compatible]")?.addEventListener("click", () => {
      const modal = root.querySelector("[data-compat-modal]");
      if (!modal) return;
      modal.hidden = true;
      document.body.classList.remove("tm-modal-open");
    });

    root.querySelector("[data-compat-modal]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        event.currentTarget.hidden = true;
        document.body.classList.remove("tm-modal-open");
      }
    });
  }

  async function loadProduct() {
    const page = document.querySelector("[data-product-slug]");
    const slug = page?.dataset.productSlug || "";
    const root = document.querySelector("[data-product-root]");
    const cachedProduct = readCachedProduct(slug);

    if (cachedProduct) {
      render(cachedProduct);
    }

    try {
      const response = await fetch(`/novy/api/product?slug=${encodeURIComponent(slug)}`, {
        headers: { Accept: "application/json" },
        cache: "default",
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Produkt sa nepodarilo načítať.");
      }

      writeCachedProduct(slug, data.product);
      render(data.product);
    } catch (error) {
      if (cachedProduct) return;

      root.className = "product-detail-error";
      root.setAttribute("aria-busy", "false");
      root.innerHTML = `
        <h1>Produkt sa nepodarilo načítať</h1>
        <p>${esc(error.message || "Skúste to prosím znova.")}</p>
        <a href="/novy/produkty">Späť na produkty</a>
      `;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateCartBadge();
    loadProduct();
    refreshDispatchMessages(document);
    window.setInterval(() => refreshDispatchMessages(document), 60000);
    window.setTimeout(() => refreshDispatchMessages(document), 250);
  });
})();
