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
    return product.stock_status === "instock" ? "Expedujeme dnes pri objednávke do 14:00" : "Termín dodania overíme";
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

  function addToCart(product, qty) {
    const cart = readCart();
    const id = String(product.id || product.sku || product.name);
    const existing = cart.find((item) => String(item.id) === id);
    const quantity = Math.max(1, Math.min(99, Number(qty || 1)));

    if (existing) existing.qty = Number(existing.qty || 1) + quantity;
    else {
      cart.push({
        id,
        sku: product.sku || "",
        name: product.name,
        price: Number(product.price || 0),
        image: product.image || "",
        url: product.detail_url || window.location.pathname,
        qty: quantity,
        product_type_key: product.product_type_key || "",
        product_type_label: product.product_type_label || product.product_type_detail_label || "",
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
          <input type="tel" name="phone" placeholder="+421 ...">
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
    return product.yield || product.page_yield || "Neuvedené";
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
    return product?.detail_url || (product?.slug ? `/produkt/${product.slug}` : "#");
  }

  function productTypeLabel(typeKey) {
    if (typeKey === "original") return "ORIGINÁL";
    if (typeKey === "renovated") return "RENOVOVANÝ";
    if (typeKey === "compatible") return "KOMPATIBILNÝ";
    return "PRODUKT";
  }

  function realProductCardHtml(product, className = "mini-product") {
    const typeKey = product.product_type_key || "product";
    const image = product.image || product.images?.[0] || "";
    return `
      <article class="${className} ${esc(typeKey)}" data-related-id="${esc(product.id || product.sku || product.slug)}">
        <a class="mini-img" href="${esc(getProductUrl(product))}">${image ? `<img src="${esc(image)}" alt="${esc(product.name)}">` : `<span>TM</span>`}</a>
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
    const url = new URL("/api/products", window.location.origin);
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
    const root = document.querySelector("[data-product-root]");
    if (!root) return;

    const images = product.images?.length ? product.images : product.image ? [product.image] : [];
    const theme = productTheme(product);
    const productColor = product.color || "Neuvedené";
    const productYield = normalizeYield(product);
    const stats = productStats(product);
    const priceWithoutVat = Number(product.price || 0) / 1.23;
    const printers = getPrinters(product);

    root.className = `tm-detail product-theme-${theme.key}`;

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
            ${images[0] ? `<img src="${esc(images[0])}" alt="${esc(product.name)}">` : `<span>TM</span>`}
            <button type="button" class="zoom-button" aria-label="Zväčšiť obrázok">
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
            <span class="chip">🛡️ 24 mes. záruka</span>
          </div>

          <div class="stock-line ${isProductInStock(product) ? "is-available" : "is-unavailable"}">
            <strong>${esc(stockText(product))}</strong>
            <span>${esc(dispatchText(product))}</span>
          </div>

          ${bulkDiscountNoticeHtml(product)}
        </div>

        <aside class="purchase-panel">
          <span class="vat-label">Cena s DPH</span>
          <div class="price-row"><strong>${money(product.price)}</strong><span>s DPH</span></div>
          <small class="no-vat">bez DPH ${moneyPlain(priceWithoutVat)} €</small>

          <div class="purchase-status ${isProductInStock(product) ? "is-available" : "is-unavailable"}">
            <strong>● ${esc(stockText(product))}</strong>
            <span>${esc(dispatchText(product))}</span>
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

      <section class="compat-section" id="compatible-printers">
        <div class="section-head">
          <h2>Kompatibilné tlačiarne</h2>
          <p>${printers.length ? `Produkt je vhodný pre ${printers.length} modelov tlačiarní.` : "Kompatibilita bude doplnená."}</p>
        </div>
        <div class="compat-pills">${printersInlineHtml(product)}</div>
      </section>

      <section class="info-grid">
        <article class="params-card">
          <h2>Parametre produktu</h2>
          <dl>
            <div><dt>Typ produktu</dt><dd>${esc(product.product_type_detail_label || product.product_type_label || theme.label)}</dd></div>
            <div><dt>Farba</dt><dd>${esc(productColor)}</dd></div>
            <div><dt>Výťažnosť</dt><dd>${esc(productYield)}</dd></div>
            <div><dt>Záruka</dt><dd>24 mesiacov</dd></div>
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

      <section class="related-section">
        <div class="related-column">
          <h2>Často kupované spolu</h2>
          <div class="accessory-grid" data-accessories>
            <p class="related-loading">Načítavam doplnkové produkty…</p>
          </div>
        </div>

        <div class="related-column">
          <h2>Alternatívy k produktu</h2>
          <div class="alternative-grid" data-alternatives>
            <p class="related-loading">Načítavam skutočné alternatívy…</p>
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
    `;

    root.querySelectorAll("[data-image]").forEach((button) => {
      button.addEventListener("click", () => {
        const image = button.dataset.image || "";
        const mainImage = root.querySelector(".main-image");
        if (!mainImage) return;
        mainImage.innerHTML = `
          <img src="${esc(image)}" alt="${esc(product.name)}">
          <button type="button" class="zoom-button" aria-label="Zväčšiť obrázok">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          </button>
        `;
        root.querySelectorAll("[data-image]").forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
      });
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

    root.querySelector("[data-buy-now]")?.addEventListener("click", () => {
      if (!isProductInStock(product)) {
        openAvailabilityModal(product);
        return;
      }
      addToCart(product, qtyInput.value);
      window.location.href = "/pokladna";
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
      const response = await fetch(`/api/product?slug=${encodeURIComponent(slug)}`, {
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
      root.innerHTML = `
        <h1>Produkt sa nepodarilo načítať</h1>
        <p>${esc(error.message || "Skúste to prosím znova.")}</p>
        <a href="/produkty">Späť na produkty</a>
      `;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateCartBadge();
    loadProduct();
  });
})();
