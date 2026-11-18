import { chipVariant } from "../lib/product-chip.ts";
import { bindPrinterCheck } from "./product-printer-check.js";
import { getDispatchMessage, refreshDispatchMessages } from "./dispatch-message.js";
import { isAvailableNow, ORDER_DELIVERY_LABEL, storefrontStockText } from "../lib/product-availability.ts";

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

  function lowestPriceHtml(product) {
    if (product?.lowest_price_30d_valid !== true || !(Number(product?.lowest_price_30d) > 0)) return "";
    return `<small class="tm-lowest-price-detail">Najnižšia cena za posledných 30 dní: <b>${money(product.lowest_price_30d)}</b></small>`;
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

  // Detail obsahuje cenu a sklad. Dlhá session cache by po dennom importe
  // mohla v otvorenom prehliadači držať včerajší údaj.
  const DETAIL_CACHE_TTL = 60 * 1000;

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

  function stockText(product) {
    return storefrontStockText(product);
  }

  function dispatchText(product) {
    return isAvailableNow(product) ? getDispatchMessage() : ORDER_DELIVERY_LABEL;
  }


  function isProductInStock(product) {
    return isAvailableNow(product);
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

  function purchaseDecisionHtml(product) {
    const type = String(product?.product_type_key || "");
    const warranty = esc(productWarranty(product));
    if (type === "compatible") return `<div class="purchase-decision"><strong>Prečo zvoliť tento variant</strong><span>Nižšia cena tlače než pri bežnom originálnom variante.</span><span>Určený pre modely uvedené v kompatibilite.</span><span>Záruka ${warranty}; pri neistote výber pred objednaním overíme.</span></div>`;
    if (type === "original") return `<div class="purchase-decision"><strong>Prečo zvoliť tento variant</strong><span>Originálny spotrebný materiál výrobcu zariadenia.</span><span>Voľba pre tlač, kde je prioritou predvídateľnosť výrobcu.</span><span>Pred objednaním skontrolujte celý OEM kód, farbu a kapacitu.</span></div>`;
    if (type === "renovated") return `<div class="purchase-decision"><strong>Prečo zvoliť tento variant</strong><span>Odborne obnovená kazeta s opätovne použitým telom.</span><span>Alternatíva medzi novým kompatibilným a originálnym produktom.</span><span>Záruka ${warranty}; kompatibilitu overte podľa presného modelu.</span></div>`;
    return `<div class="purchase-decision"><strong>Kontrola pred objednaním</strong><span>Porovnajte typ dielu, celý kód a presný model tlačiarne.</span><span>Ak si nie ste istí, výber vám bezplatne overíme.</span></div>`;
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

  function sameSeries(candidate, key) {
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
      url: product?.detail_url || `/produkt/${product?.slug || product?.id || ""}`,
    };
  }

  function isSeriesSetProduct(product) {
    const text = [
      product?.name,
      product?.color,
      product?.colour,
      product?.farba,
      product?.product_type_label,
      product?.product_type_detail_label,
    ].filter(Boolean).join(" ").toLowerCase();

    return /\b(?:cmyk|multipack|multi[\s-]?pack|sada|set)\b/.test(text);
  }

  function seriesColorsHtml(items) {
    if (!items.length) return "";
    return `
      <div class="series-colors-strip" aria-label="Ďalšie farby série">
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
      const currentColor = isSeriesSetProduct(product) ? "" : productColorKey(product);
      const products = await fetchProductsBySearch(key, 96);
      const sameType = String(product?.product_type_key || "");
      const pickedByColor = new Map();

      products
        .filter((item) => String(item?.id || item?.sku || item?.slug || "") !== currentId)
        .filter((item) => !sameType || item.product_type_key === sameType)
        .filter((item) => sameSeries(item, key))
        .filter((item) => !isSeriesSetProduct(item))
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
      if (direct.startsWith("/")) return direct;
      if (direct.startsWith("/produkt/")) return `${direct}`;
      if (direct.startsWith("produkt/")) return `/${direct}`;

      try {
        const parsed = new URL(direct, window.location.origin);
        if (parsed.origin === window.location.origin && parsed.pathname.startsWith("/produkt/")) {
          return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {
        // Neplatná URL sa nahradí cestou vytvorenou zo slugu.
      }

      return direct;
    }

    const slug = String(product?.slug || "").trim();
    if (slug) return `/produkt/${encodeURIComponent(slug)}`;
    return "/produkty";
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

  function numericPageYield(product) {
    for (const candidate of [product?.yield_pages, product?.page_yield]) {
      const raw = String(candidate ?? "").trim();
      if (!raw || /\b(ml|cl|dl|l|liter|litre|g|kg)\b/i.test(raw)) continue;
      if (!/^\d[\d\s.,]*$/.test(raw) && !/\b(stran|strán|pages?)\b/i.test(raw)) continue;
      const packText = `${product?.name || ""} ${product?.color || product?.farba || ""} ${raw}`;
      const mixedColorPack = /CMYK|CMY|C\/M\/Y|multipack|troj[ -]?pack|VAL(?:BP)?|RBWBP|\+/i.test(packText);
      if (mixedColorPack) continue;
      const multiplier = raw.match(/(\d[\d\s.,]*)\s*(?:x|×|\*)\s*(\d[\d\s.,]*)\s*(?:stran|strán|pages?)/i);
      if (multiplier) {
        const count = Number(multiplier[1].replace(/\s/g, "").replace(",", "."));
        const perItem = Number(multiplier[2].replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
        const productName = String(product?.name || "");
        const confirmedSameCartridgePack = count === 2 && (/(?:dual\s*pack|duopack|twin|\b2\s*ks\b|\(2\s*ks\)|2\s*x\s*(?:origináln|kompatibiln|renovovan).*toner)/i.test(productName) || /\b(?:CB|CE|CF|Q|W)\d{3,4}(?:A?D|XD)\b/i.test(productName));
        if (confirmedSameCartridgePack && Number.isFinite(perItem) && perItem > 0) return count * perItem;
        continue;
      }
      const match = raw.replace(/\s/g, "").match(/(\d[\d.,]*)/);
      if (!match) continue;
      const parsed = Number(match[1].replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function costPerPageHtml(product) {
    const pages = numericPageYield(product);
    const price = Number(product?.price || 0);
    if (!pages || !Number.isFinite(price) || price <= 0) return "";
    const euros = price / pages;
    const cents = euros * 100;
    const precision = cents < 1 ? 2 : 1;
    const euroValue = euros.toLocaleString("sk-SK", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const centValue = cents.toLocaleString("sk-SK", { minimumFractionDigits: precision, maximumFractionDigits: precision });
    return `<div class="cost-per-page"><strong>${esc(euroValue)} € / strana</strong><small>${esc(centValue)} centa. Orientačne: cena s DPH ÷ deklarovaná výťažnosť. Skutočná spotreba závisí od pokrytia tlače.</small></div>`;
  }

  function productWarranty(product) {
    const value = product.warranty || product.zaruka || product.guarantee || "";
    return isMissingValue(value) ? "24 mesiacov" : value;
  }


  function productSafetyHtml(product) {
    const rows = [
      ["Výrobca produktu", product?.manufacturer_name],
      ["Poštová adresa výrobcu", product?.manufacturer_address],
      ["Elektronický kontakt výrobcu", product?.manufacturer_contact],
      ["Zodpovedný hospodársky subjekt v EÚ", product?.eu_responsible_person],
      ["Bezpečnostné informácie a upozornenia", product?.safety_information],
    ].filter(([, value]) => String(value || "").trim());

    if (!rows.length) return "";
    return `
      <section class="product-safety-card" aria-labelledby="product-safety-title">
        <div>
          <span class="section-eyebrow">Bezpečnosť výrobku</span>
          <h2 id="product-safety-title">Výrobca a bezpečnostné informácie</h2>
        </div>
        <dl>
          ${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}
        </dl>
      </section>
    `;
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

  function compatibilitySeriesLink(value) {
    const url = new URL("/produkty", window.location.origin);
    url.searchParams.set("printer", String(value || "").trim());
    return `${url.pathname}?${url.searchParams.toString()}`;
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
            ${series.length ? series.map((item) => `<a href="${compatibilitySeriesLink(item)}">${esc(item)}<span aria-hidden="true">→</span></a>`).join("") : `<span class="compat-empty">Séria nie je uvedená.</span>`}
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

  function isPrinterRelatedProduct(product) {
    if (getPrinters(product).length) return true;
    const type = String(product?.product_type_key || "").toLowerCase();
    if (["compatible", "original", "renovated"].includes(type)) return true;
    const categories = Array.isArray(product?.categories)
      ? product.categories.map((category) => `${category?.name || ""} ${category?.slug || ""}`).join(" ")
      : "";
    const text = `${product?.name || ""} ${product?.slug || ""} ${product?.product_type_label || ""} ${product?.product_type_detail_label || ""} ${categories}`.toLowerCase();
    return /\b(toner|tonery|atrament|náplň|napln|kazeta|cartridge|optick[ýy]\s+valec|fotovalec|drum|fuser|zapekac)/i.test(text);
  }

  function printerProductsUrl(printer) {
    const clean = normalizePrinter(printer);
    const brands = [
      ["konica minolta", "konica-minolta"], ["hewlett packard", "hp"], ["kyocera", "kyocera"],
      ["brother", "brother"], ["samsung", "samsung"], ["lexmark", "lexmark"], ["panasonic", "panasonic"],
      ["toshiba", "toshiba"], ["philips", "philips"], ["pantum", "pantum"], ["xerox", "xerox"],
      ["canon", "canon"], ["epson", "epson"], ["ricoh", "ricoh"], ["sharp", "sharp"],
      ["utax", "utax"], ["dell", "dell"], ["oki", "oki"], ["ibm", "ibm"], ["hp", "hp"],
    ];
    const normalized = clean.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    const match = brands.find(([name]) => normalized === name || normalized.startsWith(`${name} `));
    if (match && /\d/.test(clean)) {
      const slug = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return `/tlaciarne/${match[1]}/${slug}`;
    }
    const url = new URL("/produkty", window.location.origin);
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

  function printersListHtml(product) {
    const printers = getPrinters(product);
    if (!printers.length) return `<p>Kompatibilita bude doplnená.</p>`;
    return `<div class="compat-grid">${printers.map((printer) => `<a href="${printerProductsUrl(printer)}">${esc(printer)}</a>`).join("")}</div>`;
  }

  function getProductUrl(product) {
    const direct = String(product?.detail_url || product?.url || "").trim();
    if (direct.startsWith("/")) return direct;
    if (direct.startsWith("/produkt/")) return `${direct}`;
    if (direct.startsWith("produkt/")) return `/${direct}`;
    if (direct && direct !== "#") return direct;
    const slug = String(product?.slug || product?.id || "").trim();
    return slug ? `/produkt/${encodeURIComponent(slug)}` : "#";
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
        <a class="mini-img accessory-product-image" href="${esc(getProductUrl(product))}">
          <img src="${esc(productImageSrc(product.image || product.images?.[0] || "", product))}" alt="${esc(title)}" loading="lazy" decoding="async">
        </a>
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

  async function fetchProductsBySearch(search, perPage = 24) {
    const url = new URL("/api/products", window.location.origin);
    url.searchParams.set("s", search);
    url.searchParams.set("per_page", String(perPage));
    const response = await fetch(`${url.pathname}?${url.searchParams.toString()}`, { headers: { Accept: "application/json" } });
    const data = await response.json();
    return response.ok && data.ok && Array.isArray(data.products) ? data.products : [];
  }

  async function fetchProductBySlug(slug) {
    const response = await fetch(`/api/product?slug=${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.ok && data.product ? data.product : null;
  }

  async function findAccessories(currentProduct) {
    const queries = [
      { slug: "kancelarsky-papier-a4-80g-500-harkov", search: "kancelársky papier", title: "Kancelársky papier", match: /kancel[aá]rsky\s+papier|papier\s+a4/i },
      { search: "pákový šanón", title: "Pákový šanón", match: /p[aá]kov[yý]\s+[sš]an[oó]n/i },
      { search: "roller", title: "Roller", match: /\broller\b|frixion/i },
    ];
    const out = [];
    const currentId = String(currentProduct?.id || currentProduct?.sku || currentProduct?.slug || "");
    for (const query of queries) {
      const exactProduct = query.slug ? await fetchProductBySlug(query.slug) : null;
      const products = exactProduct ? [exactProduct] : await fetchProductsBySearch(query.search, 18);
      const picked = products.find((item) => {
        const itemId = String(item?.id || item?.sku || item?.slug || "");
        return itemId !== currentId && Number(item.price || 0) > 0 && query.match.test(`${item.name || ""} ${item.slug || ""}`);
      });
      if (picked && !out.some((existing) => String(existing.id) === String(picked.id))) {
        out.push({ ...picked, tm_accessory_title: query.title });
      }
    }
    return out;
  }

  async function hydrateExtraProducts(currentProduct) {
    const section = document.querySelector("[data-alternatives-section]");
    section?.querySelectorAll("[data-alternative-cart]").forEach((button) => {
      const product = JSON.parse(button.dataset.alternativeCart);
      button.addEventListener("click", () => addToCart(product, 1));
    });
    const root = document.querySelector("[data-accessories]");
    if (!root) return;
    const accessories = await findAccessories(currentProduct).catch(() => []);
    if (!accessories.length) return;
    root.innerHTML = accessories.map(accessoryCardHtml).join("");
    root.closest("[data-accessories-section]").hidden = false;
    const byId = new Map(accessories.map(item => [String(item.id || item.sku || item.slug), item]));
    root.querySelectorAll("[data-related-add]").forEach(button => {
      const product = byId.get(button.closest("[data-related-id]")?.dataset.relatedId);
      if (product) button.addEventListener("click", () => addToCart(product, 1));
    });
  }

  function render(product) {
    ensureProductImageFitStyles();
    const root = document.querySelector("[data-product-root]");
    if (!root) return;

    const rawImages = product.images?.length ? product.images : product.image ? [product.image] : [];
    const images = Array.from(new Set((rawImages.length ? rawImages : [TM_PRODUCT_PLACEHOLDER_IMAGE]) .map((image) => productImageSrc(image, product)).filter(Boolean)));
    const theme = productTheme(product);
    const chip = chipVariant(product);
    const productColor = product.color || "Neuvedené";
    const productYield = normalizeYield(product);
    const productWarrantyValue = productWarranty(product);
    const priceWithoutVat = Number(product.price || 0) / 1.23;
    const printers = getPrinters(product);
    const printerRelated = isPrinterRelatedProduct(product);

    root.className = `tm-detail product-theme-${theme.key}`;
    root.setAttribute("aria-busy", "false");

    root.querySelector("[data-product-head]").innerHTML = `
      <section class="detail-hero-card">
        <div class="product-gallery">
          <div class="thumbs" role="group" aria-label="Galéria produktu">
            ${images.slice(0, 4).map((image, index) => `
              <button type="button" data-image="${esc(image)}" class="${index === 0 ? "active" : ""}" aria-label="Zobraziť obrázok produktu ${index + 1}" aria-pressed="${index === 0 ? "true" : "false"}">
                <img src="${esc(image)}" alt="" width="72" height="72" loading="lazy" decoding="async">
              </button>
            `).join("")}
          </div>

          <div class="main-image">
            <img src="${esc(images[0] || TM_PRODUCT_PLACEHOLDER_IMAGE)}" alt="${esc(product.name)}" class="tm-product-fit-image" width="640" height="640" loading="eager" decoding="async" fetchpriority="high">
            <button type="button" class="zoom-button" data-zoom-image aria-label="Zväčšiť obrázok">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            </button>
          </div>
        </div>

        <div class="product-info">
          <div class="badge-row">
            <span class="type-badge">${esc(theme.label)}</span>
            ${chip ? `<span class="chip-variant chip-variant--${esc(chip.key)}" title="${esc(chip.note)}">${esc(chip.label)}<small>${esc(chip.note)}</small></span>` : ""}
            <span class="type-note">${theme.icon} ${esc(theme.note)}</span>
          </div>

          <h1>${esc(product.name)}</h1>

          <p class="summary-subtitle">${esc(product.product_type_detail_label || product.description || "Spotrebný materiál pre vašu tlačiareň.")}</p>

          ${printerRelated ? `<div class="compat-preview">
            <span data-check-heading>Kompatibilné s</span>
            <strong data-check-summary>${esc(compatibilitySummary(product))}</strong>
            <div class="printer-check" id="overenie-tlaciarne" data-printer-check>
              <div class="printer-check-actions">
                <button type="button" data-check-toggle aria-expanded="false" aria-controls="printer-check-panel">Overiť moju tlačiareň</button>
                ${printers.length ? `<button type="button" data-show-compatible>Všetky modely (${printers.length})</button>` : ""}
              </div>
              <div id="printer-check-panel" data-check-panel hidden>
                <form>
                  <label for="printer-check-model">Model tlačiarne</label>
                  <div class="printer-check-input">
                    <input id="printer-check-model" name="model" type="search" maxlength="90" autocomplete="off" spellcheck="false" placeholder="Označenie zo štítku tlačiarne">
                    <button type="submit">Overiť</button>
                  </div>
                </form>
                <p role="status" tabindex="-1"></p>
                <div class="printer-check-options" data-check-options></div>
                <a data-check-catalog hidden>Vyhľadať tento model v katalógu →</a>
              </div>
            </div>
          </div>` : ""}

          <div class="chips chips-inline">
            <span class="chip chip-color">${colorEmoji(productColor)} ${esc(productColor)}</span>
            <span class="chip">📄 ${esc(productYield)}</span>
            <span class="chip">🛡️ ${esc(productWarrantyValue)}</span>
          </div>

          <div class="stock-line ${isProductInStock(product) ? "is-available" : "is-unavailable"}">
            <strong>${esc(stockText(product))}</strong>
            <span data-tm-dispatch-message${isProductInStock(product) ? "" : " data-tm-dispatch-static"}>${esc(dispatchText(product))}</span>
          </div>

          ${bulkDiscountNoticeHtml(product)}
          ${document.querySelector("[data-alternatives-section]") ? '<a class="jump-to-alternatives" href="#alternativy">Porovnať alternatívy ↓</a>' : ""}
          ${purchaseDecisionHtml(product)}
        </div>

        <aside class="purchase-panel">
          <span class="vat-label">Cena s DPH</span>
          <div class="price-row"><strong>${money(product.price)}</strong><span>s DPH</span></div>
          ${costPerPageHtml(product)}
          ${lowestPriceHtml(product)}
          <small class="no-vat">bez DPH ${moneyPlain(priceWithoutVat)} €</small>

          <div class="purchase-status ${isProductInStock(product) ? "is-available" : "is-unavailable"}">
            <strong>● ${esc(stockText(product))}</strong>
            <span data-tm-dispatch-message${isProductInStock(product) ? "" : " data-tm-dispatch-static"}>${esc(dispatchText(product))}</span>
          </div>

          <div class="delivery-box">
            <strong>🚚 Doručenie od 2,90 €</strong>
            <strong>🎁 Nad 29 € doprava zdarma</strong>
            <span>${esc(deliveryMissing(product))}</span>
          </div>

          <label for="tm-product-quantity">Množstvo</label>
          <div class="qty-row">
            <button type="button" data-qty-minus aria-label="Znížiť množstvo">-</button>
            <input id="tm-product-quantity" type="number" data-qty value="1" min="1" max="99" aria-label="Množstvo produktu">
            <button type="button" data-qty-plus aria-label="Zvýšiť množstvo">+</button>
          </div>

          <button type="button" class="add-main" data-add-main>
            <svg viewBox="0 0 24 24"><path d="M6 6h15l-2 9H8L6 6z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>Pridať do košíka
          </button>

          <button type="button" class="buy-now" data-buy-now>Kúpiť ihneď</button>

          <a class="heureka-mini purchase-heureka" href="https://obchody.heureka.sk/tonerymaxim-sk/recenze/" target="_blank" rel="noopener noreferrer" aria-label="Overené hodnotenie obchodu ToneryMaxim na Heureke">
            <span data-heureka-stars aria-hidden="true">★★★★★</span>
            <strong><span data-heureka-rating>4,9</span>/5</strong>
            <small><b data-heureka-count>1 326</b> overených recenzií obchodu na Heureke</small>
          </a>

          <div class="purchase-note">
            <span>✓ Pred nákupom overíme kompatibilitu</span>
            <span>✓ Pri probléme pomôžeme nájsť riešenie</span>
          </div>
        </aside>
      </section>

      <section class="series-wide-section" data-series-wide-section hidden>
        <div class="section-head">
          <h2>Farebné možnosti tejto série</h2>
        </div>
        <div data-series-colors></div>
      </section>

    `;

    root.querySelector("[data-product-tail]").innerHTML = `
      ${productSafetyHtml(product)}

      ${printerRelated ? `<section class="compat-section compat-section-modern" id="compatible-printers">
        <div class="section-head compat-section-head">
          <div>
            <span class="section-eyebrow">Jednoduchý výber podľa tlačiarne</span>
            <h2>Kompatibilné tlačiarne</h2>
          </div>
          <p>${printers.length ? `Produkt je vhodný pre ${printers.length} modelov tlačiarní.` : "Kompatibilita bude doplnená."}</p>
        </div>
        ${compatibilityNavigationHtml(product)}
        <a class="printer-check-jump" data-check-from-models href="#overenie-tlaciarne">Overiť moju tlačiareň</a>
      </section>` : ""}

      ${printerRelated ? `<div class="compat-modal" data-compat-modal hidden>
        <div class="compat-modal-card">
          <div class="compat-modal-head">
            <h2>Všetky kompatibilné modely tlačiarní</h2>
            <button type="button" class="modal-close" data-close-compatible aria-label="Zavrieť zoznam kompatibilných tlačiarní">×</button>
          </div>
          <p>Kliknutím na model otvoríte výpis produktov pre danú tlačiareň.</p>
          ${printersListHtml(product)}
        </div>
      </div>` : ""}

      <div class="image-zoom-modal" data-image-zoom-modal hidden>
        <div class="image-zoom-backdrop" data-close-zoom></div>
        <div class="image-zoom-card" role="dialog" aria-modal="true" aria-label="Zväčšený obrázok produktu">
          <button type="button" class="image-zoom-close" data-close-zoom aria-label="Zavrieť zväčšený obrázok">×</button>
          <img src="${esc(images[0] || TM_PRODUCT_PLACEHOLDER_IMAGE)}" alt="${esc(product.name)}" data-zoom-modal-image class="tm-product-fit-image">
        </div>
      </div>

      <div class="product-mobile-sticky-cart" data-mobile-sticky-cart inert aria-hidden="true">
        <div>
          <span>${esc(stockText(product))}</span>
          <strong>${money(product.price)}</strong>
        </div>
        <button type="button" data-mobile-sticky-add>
          Pridať do košíka
        </button>
      </div>
    `;

    root.querySelectorAll("[data-image]").forEach((button) => {
      button.addEventListener("click", () => {
        const image = button.dataset.image || "";
        const mainImage = root.querySelector(".main-image");
        if (!mainImage) return;
        mainImage.innerHTML = `
          <img src="${esc(image)}" alt="${esc(product.name)}" class="tm-product-fit-image" width="640" height="640" decoding="async">
          <button type="button" class="zoom-button" data-zoom-image aria-label="Zväčšiť obrázok">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          </button>
        `;
        root.querySelectorAll("[data-image]").forEach((btn) => btn.classList.remove("active"));
        root.querySelectorAll("[data-image]").forEach((btn) => btn.setAttribute("aria-pressed", "false"));
        button.classList.add("active");
        button.setAttribute("aria-pressed", "true");
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
      const setStickyVisible = (mainOffscreen, comparisonVisible) => {
        document.body.classList.toggle("viewing-product-alternatives", comparisonVisible);
        const visible = mainOffscreen && !comparisonVisible;
        stickyCart.inert = !visible;
        stickyCart.classList.toggle("is-visible", Boolean(visible));
        stickyCart.setAttribute("aria-hidden", String(!visible));
      };

      if ("IntersectionObserver" in window) {
        // The floating action buys the main product. Hide it while comparing other cartridges.
        const comparison = document.querySelector("[data-alternatives-section]");
        let mainVisible = true;
        let comparisonVisible = false;
        const observer = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (entry.target === mainAddButton) mainVisible = entry.isIntersecting;
            if (entry.target === comparison) comparisonVisible = entry.isIntersecting;
          }
          setStickyVisible(!mainVisible, comparisonVisible);
        });
        observer.observe(mainAddButton);
        if (comparison) observer.observe(comparison);
      } else {
        const onScroll = () => {
          const comparison = document.querySelector("[data-alternatives-section]")?.getBoundingClientRect();
          setStickyVisible(window.scrollY > 520, Boolean(comparison && comparison.bottom > 0 && comparison.top < window.innerHeight));
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
      }
    }

    root.querySelector("[data-buy-now]")?.addEventListener("click", () => {
      addToCart(product, qtyInput.value);
      window.location.href = "/pokladna";
    });

    if (window.location.hash === "#compatible-printers") {
      window.requestAnimationFrame(() => root.querySelector("#compatible-printers")?.scrollIntoView({ block: "start" }));
    }

    hydrateSeriesColors(product);
    hydrateExtraProducts(product);

    bindPrinterCheck(root, () => {
      const labels = product.compatible_printers?.length ? product.compatible_printers : product.printers;
      return getPrinters({ compatible_printers: labels });
    }, product, chip, printerProductsUrl);

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

  function bindProductDescription() {
    const dialog = document.getElementById("pd-info-dialog");
    if (!dialog || typeof dialog.showModal !== "function") return;
    const panel = dialog.closest(".pd-info-intro");
    const details = panel.querySelector(".pd-info-reading");
    const button = panel.querySelector(".pd-info-pop");
    const slot = details.querySelector(".pd-info-slot");
    const copy = slot.querySelector(".pd-info-copy");
    const body = dialog.querySelector(".pd-info-dialog-body");

    button.hidden = false;
    button.addEventListener("click", () => {
      if (dialog.open) return;
      if (details.open) slot.style.minHeight = slot.getBoundingClientRect().height + "px";
      body.append(copy);
      dialog.showModal();
      body.scrollTop = 0;
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (dialog.open) return;
      slot.append(copy);
      slot.style.minHeight = "";
      button.focus({ preventScroll: true });
    });
  }

  async function loadProduct() {
    const page = document.querySelector("[data-product-slug]");
    const slug = page?.dataset.productSlug || "";
    const root = document.querySelector("[data-product-root]");
    let embeddedProduct = null;
    const embeddedNode = document.getElementById("tm-product-initial-data");
    if (embeddedNode?.textContent) {
      try {
        embeddedProduct = JSON.parse(embeddedNode.textContent);
      } catch {
        embeddedProduct = null;
      }
    }
    const cachedProduct = embeddedProduct || readCachedProduct(slug);

    if (cachedProduct) {
      render(cachedProduct);
      writeCachedProduct(slug, cachedProduct);
      return;
    }

    try {
      const response = await fetch(`/api/product?slug=${encodeURIComponent(slug)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
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
        <a href="/produkty">Späť na produkty</a>
      `;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindProductDescription();
    updateCartBadge();
    loadProduct();
    refreshDispatchMessages(document);
    window.setInterval(() => refreshDispatchMessages(document), 60000);
    window.setTimeout(() => refreshDispatchMessages(document), 250);
  });
})();
