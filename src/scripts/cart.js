import { getDispatchMessage, refreshDispatchMessages } from "./dispatch-message.js";
import { collapsePaperRewardCart, isPaperRewardCartItem, syncPaperRewardCart } from "./paper-reward-cart.js";
import { cartProductUnavailable, markMissingCartProduct, mergeCurrentCartProduct } from "../lib/cart-product-refresh.ts";
import { isAvailableNow, orderFulfilmentText, ORDER_DELIVERY_LABEL } from "../lib/product-availability.ts";
import { resolveCartCoupon } from './cart-coupon.js';
import { cartGoodsTotals, discountedGrossLine, grossVatTotals, percentageCouponDiscount, redeemableLoyaltyDiscount } from '../lib/checkout-vat.ts';

(() => {
  const TM_PRODUCT_PLACEHOLDER_IMAGE = "/images/tm-product-placeholder-box.jpg";

  function isCalendarCartItem(item) {
    const source = String(item?.source || "").trim();
    const id = String(item?.id ?? item?.productId ?? item?.product_id ?? "").trim().toLowerCase();
    const url = String(item?.url || item?.href || "").trim();
    let calendarUrl = false;
    try {
      calendarUrl = new URL(url || "/", window.location.origin).pathname.startsWith("/kalendare/");
    } catch {
      calendarUrl = false;
    }
    return source === "kalendare-2027" || id.startsWith("calendar:") || calendarUrl;
  }

  let tmLoyalty = { ok: false, points: 0, discountValue: 0 };
  const TM_LOYALTY_MIN_DISCOUNT = 0.2;
  // Vernostná zľava je pre prihláseného zákazníka predvolene zapnutá.
  // Hodnota "0" vznikne iba po jeho vedomom odškrtnutí voľby.
  let tmLoyaltyApply = localStorage.getItem("tm_loyalty_apply") !== "0";
  function readSavedCoupon() {
    try { return JSON.parse(localStorage.getItem("tm_coupon_v1") || "null"); } catch { return null; }
  }
  let tmCoupon = readSavedCoupon();

  let loyaltyRequest;
  let customerSignedIn;
  let couponCartKey;
  let couponRevision = 0;
  let couponTimer;
  let benefitStatus = "pending";
  let enteredCartCoupon;

  async function loadLoyalty() {
    const response = await fetch("/api/account/loyalty", {
      credentials: "same-origin", cache: "no-store", signal: globalThis.AbortSignal?.timeout?.(8000),
    });
    if (!response.ok && response.status !== 401) throw new Error(`HTTP ${response.status}`);
    const data = response.status === 401 ? { ok: false } : await response.json();
    if (typeof data?.ok !== "boolean") throw new Error("Invalid loyalty response");
    customerSignedIn = data.ok;
    tmLoyalty = { ok: data.ok, points: Number(data.points || 0), discountValue: Number(data.discountValue || 0) };
    tmLoyaltyApply = data.ok && tmLoyalty.discountValue >= TM_LOYALTY_MIN_DISCOUNT && localStorage.getItem("tm_loyalty_apply") !== "0";
    const cart = readCart();
    const updated = syncPaperRewardCart(cart, data.paperReward);
    if (JSON.stringify(cart) !== JSON.stringify(updated)) saveCart(updated);
    return data.ok;
  }

  function getCartLoyalty() {
    if (!loyaltyRequest) {
      loyaltyRequest = loadLoyalty().catch((error) => {
        loyaltyRequest = undefined;
        throw error;
      });
    }
    return loyaltyRequest;
  }

  function loyaltyDiscountForTotal(total) {
    if (!tmLoyaltyApply || !tmLoyalty.ok) return 0;
    return redeemableLoyaltyDiscount(tmLoyalty.discountValue, tmLoyalty.discountValue, total);
  }


  function couponDiscountForTotal(total, cart = readCart()) {
    if (!tmCoupon || !tmCoupon.ok) return 0;

    const percent = Number(tmCoupon.percent || 0);
    const discount = Number.isFinite(percent) && percent > 0
      ? percentageCouponDiscount(cart, percent, tmCoupon.scope)
      : Number(tmCoupon.discount || 0);
    return Math.min(Math.max(0, Number.isFinite(discount) ? discount : 0), Math.max(0, total));
  }

  function validateCouponCode(code) {
    enteredCartCoupon = String(code || "").trim();
    couponCartKey = undefined;
    renderCartPage();
  }

  function couponFormMarkup() {
    return `
      <button class="coupon-toggle" type="button" data-coupon-toggle aria-expanded="false">
        <span data-coupon-toggle-label>Máte zľavový kupón?</span>
        <span class="coupon-toggle-icon" aria-hidden="true">+</span>
      </button>
      <div class="coupon-fields" data-coupon-fields hidden>
        <div class="coupon-inline">
          <input type="text" data-coupon-input placeholder="Zadajte kód kupónu" autocomplete="off">
          <button type="submit" data-coupon-apply>Použiť</button>
        </div>
        <small data-coupon-message></small>
      </div>
    `;
  }

  function setCouponBoxExpanded(box, expanded) {
    if (!box) return;
    box.dataset.couponExpanded = expanded ? "true" : "false";
    box.classList.toggle("is-open", expanded);
    const toggle = box.querySelector("[data-coupon-toggle]");
    const fields = box.querySelector("[data-coupon-fields]");
    const icon = box.querySelector(".coupon-toggle-icon");
    if (toggle) toggle.setAttribute("aria-expanded", String(expanded));
    if (fields) fields.hidden = !expanded;
    if (icon) icon.textContent = expanded ? "−" : "+";
  }

  function setCouponBoxesExpanded(expanded) {
    document.querySelectorAll("[data-cart-coupon-box]").forEach((box) => {
      if (!box.querySelector("[data-coupon-toggle]")) box.innerHTML = couponFormMarkup();
      setCouponBoxExpanded(box, expanded);
    });
  }

  function syncCouponBoxes(couponDiscount) {
    const couponApplied = Boolean(tmCoupon?.ok && couponDiscount > 0);
    const couponError = Boolean(tmCoupon && !tmCoupon.ok && tmCoupon.reason);

    document.querySelectorAll("[data-cart-coupon-box]").forEach((box) => {
      if (!box.querySelector("[data-coupon-toggle]")) box.innerHTML = couponFormMarkup();
      box.hidden = false;
      box.classList.toggle("has-active-coupon", couponApplied);

      const label = box.querySelector("[data-coupon-toggle-label]");
      if (label) {
        label.textContent = couponApplied
          ? `Kupón ${tmCoupon?.code || ""} je uplatnený`.trim()
          : "Máte zľavový kupón?";
      }

      const input = box.querySelector("[data-coupon-input]");
      if (input && document.activeElement !== input) input.value = tmCoupon?.code || "";

      const message = box.querySelector("[data-coupon-message]");
      if (message) {
        if (couponApplied) message.textContent = `${tmCoupon.label || "Kupón"}: -${formatMoney(couponDiscount)}`;
        else message.textContent = tmCoupon?.reason || "";
        message.className = couponApplied ? "is-success" : (couponError ? "is-error" : "");
      }

      const expanded = box.dataset.couponExpanded === "true" || couponError;
      setCouponBoxExpanded(box, expanded);
    });
  }


  function renderCartViews() {
    renderCartPage();
    if (document.body.classList.contains("has-add-cart-drawer")) {
      renderAddCartSummary(document.querySelector("[data-add-cart-drawer]"));
    }
  }

  // Only the cart page and an explicitly opened drawer request customer benefits.
  function ensureCartBenefits(cart) {
    const key = JSON.stringify(cart.filter(item => !isPaperRewardCartItem(item)).map(item =>
      [item.sku, item.price, item.qty, item.product_type_key || item.productTypeKey, item.product_type_label || item.productTypeLabel, item.name]
    ));
    if (key === couponCartKey) return;
    couponCartKey = key;
    const revision = ++couponRevision;
    window.clearTimeout(couponTimer);
    if (!cart.length || (customerSignedIn === false && !tmCoupon?.code && !enteredCartCoupon)) {
      benefitStatus = "ready";
      return;
    }
    benefitStatus = "pending";
    // Coalesce clicks on the quantity controls before asking Woo for the best eligible coupon.
    couponTimer = window.setTimeout(async () => {
      try {
        const signedIn = await getCartLoyalty();
        if (revision !== couponRevision) return;
        const coupon = await resolveCartCoupon(readCart(), tmCoupon, { automatic: signedIn, enteredCode: enteredCartCoupon });
        if (revision !== couponRevision) return;
        tmCoupon = coupon;
        if (coupon) localStorage.setItem("tm_coupon_v1", JSON.stringify(coupon));
        else localStorage.removeItem("tm_coupon_v1");
        if (enteredCartCoupon !== undefined) setCouponBoxesExpanded(Boolean(coupon && !coupon.ok));
        enteredCartCoupon = undefined;
        benefitStatus = "ready";
      } catch {
        if (revision !== couponRevision) return;
        benefitStatus = "error";
      }
      renderCartViews();
    }, 100);
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
      return collapsePaperRewardCart(Array.isArray(parsed) ? parsed : []);
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    refreshCartCounters();
    window.dispatchEvent(new CustomEvent("tm:cart-synced", {
      detail: { cart, count: cartCount(cart), source: "storefront" },
    }));
  }

  function cleanQty(value) {
    const number = parseInt(value, 10);
    if (!Number.isFinite(number) || number < 1) return 1;
    if (number > 99) return 99;
    return number;
  }

  function stockLimit(item) {
    const status = String(item?.stock_status || "instock").toLowerCase();
    if (status === "outofstock") return null;
    if (status !== "instock") return null;
    const raw = item?.stock_quantity;
    if (raw === null || raw === undefined || String(raw).trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  function showStockLimitNotice(item, limit, requested) {
    let notice = document.querySelector("[data-cart-stock-limit-notice]");
    if (!notice) {
      notice = document.createElement("div");
      notice.dataset.cartStockLimitNotice = "";
      notice.setAttribute("role", "alert");
      notice.setAttribute("aria-live", "assertive");
      Object.assign(notice.style, {
        position: "fixed", left: "50%", bottom: "24px", zIndex: "2147483640",
        transform: "translateX(-50%)", width: "min(520px, calc(100vw - 32px))",
        padding: "14px 18px", borderRadius: "14px", background: "#fff2f2",
        border: "1px solid #efb7b7", boxShadow: "0 14px 40px rgba(8,34,74,.22)",
        color: "#b42318", fontWeight: "800", textAlign: "center",
      });
      document.body.appendChild(notice);
    }
    const name = String(item?.name || "Tento produkt").trim();
    notice.textContent = limit > 0
      ? `${name}: ${limit} ks expedujeme zo skladu, zostávajúce ${Math.max(0, requested - limit)} ks dodáme do 3–10 pracovných dní.`
      : `${name}: objednávku dodáme do 3–10 pracovných dní.`;
    notice.hidden = false;
    window.clearTimeout(Number(notice.dataset.hideTimer || 0));
    notice.dataset.hideTimer = String(window.setTimeout(() => { notice.hidden = true; }, 6000));
  }

  function limitedQty(item, value, notify = false) {
    const requested = cleanQty(value);
    const limit = stockLimit(item);
    if (limit === null || requested <= limit) return requested;
    if (notify) showStockLimitNotice(item, limit, requested);
    return requested;
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
    const direct = String(item?.url || item?.detail_url || "").trim();

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
    const current = mergeCurrentCartProduct(item, product);
    return {
      ...current,
      product_type_key: item.product_type_key || product.product_type_key || "",
      product_type_label: item.product_type_label || product.product_type_label || product.product_type_detail_label || "",
      color: firstFilled(item.color, item.farba, product.color),
      capacity: productCapacity(item) || productCapacity(product),
      warranty: firstFilled(item.warranty, item.zaruka) || "24 mesiacov",
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

  async function fetchProductsBySkus(skus) {
    const wanted = [...new Set((skus || []).map((sku) => String(sku || "").trim()).filter(Boolean))].slice(0, 30);
    if (!wanted.length) return { verified: false, products: new Map() };
    try {
      const response = await fetch(`/api/products?skus=${encodeURIComponent(wanted.join(','))}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok || !Array.isArray(data.products)) return { verified: false, products: new Map() };
      return {
        verified: true,
        products: new Map(data.products.map((product) => [String(product?.sku || '').trim(), product])),
      };
    } catch {
      return { verified: false, products: new Map() };
    }
  }

  async function hydrateCartProducts() {
    const cart = readCart();
    if (!cart.length) return false;

    let changed = false;
    const hydrated = [];
    // Aktuálne údaje všetkých tonerov načítame pri každom otvorení košíka
    // jedinou požiadavkou. Kalendáre zostávajú vo vlastnom katalógu.
    const liveLookup = await fetchProductsBySkus(cart
      .filter((item) => !isCalendarCartItem(item))
      .map((item) => item.sku));

    for (let itemIndex = 0; itemIndex < cart.length; itemIndex += 1) {
      const item = cart[itemIndex];
      // Kalendáre majú vlastný katalóg a vlastnú serverovú kontrolu skladu.
      // Nikdy ich nedohľadávame medzi tonermi cez hlavné /api/products.
      if (isCalendarCartItem(item)) {
        const calendarStockStatus = String(item?.stock_status || "instock").toLowerCase();
        const calendarItem = {
          ...item,
          source: "kalendare-2027",
          url: productUrl(item),
          // Staršia verzia košíka mohla kalendár omylom obohatiť údajmi tonera.
          // Pri kalendári preto odstránime iba tonerové atribúty; sklad a cenu
          // pri objednávke aj tak autoritatívne overuje serverový katalóg.
          color: "",
          farba: "",
          capacity: "",
          kapacita: "",
          yield: "",
          page_yield: "",
          pageYield: "",
          pages: "",
          ml: "",
          volume: "",
          product_type_key: "",
          product_type_label: "",
          stock_quantity: null,
          stock_text: calendarStockStatus === "outofstock"
            ? "Nie je skladom"
            : (calendarStockStatus === "onbackorder" ? "Na objednávku" : "Skladom"),
        };
        hydrated.push(calendarItem);
        if (JSON.stringify(calendarItem) !== JSON.stringify(item)) changed = true;
        continue;
      }

      const liveProduct = liveLookup.products.get(String(item.sku || '').trim()) || null;
      const needsData = !productCapacity(item) || !item.url || item.url === "#" || !item.stock_text || item.stock_quantity === null || item.stock_quantity === undefined;
      const fallback = !liveLookup.verified && needsData ? findProductInSessionCache(item.sku) : null;
      const merged = liveProduct
        ? mergeProductData(item, liveProduct)
        : liveLookup.verified
          ? markMissingCartProduct(item)
          : fallback
            ? mergeProductData(item, fallback)
            : { ...item, url: productUrl(item), capacity: productCapacity(item) };
      const availableQty = limitedQty(merged, merged.qty, true);
      if (availableQty > 0) merged.qty = availableQty;
      hydrated.push(merged);

      if (JSON.stringify(merged) !== JSON.stringify(item)) changed = true;
    }

    if (!changed || JSON.stringify(readCart()) !== JSON.stringify(cart)) return false;
    saveCart(hydrated);
    return true;
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
    const requested = cleanQty(item?.qty || 1);
    const limit = stockLimit(item);
    if (limit !== null && requested > limit) return orderFulfilmentText(item, requested);
    if (item?.stock_text) return String(item.stock_text);
    if (item?.stock_status === "instock") {
      if (item.stock_quantity !== null && item.stock_quantity !== undefined && item.stock_quantity !== "") return `Skladom ${item.stock_quantity} ks`;
      return "Skladom";
    }
    if (item?.stock_status === "onbackorder" || item?.stock_status === "outofstock") return "Na objednávku · dodanie 3–10 pracovných dní";
    return "Skladom";
  }

  function stockClass(item) {
    const limit = stockLimit(item);
    if (limit !== null && cleanQty(item?.qty || 1) > limit) return "is-backorder";
    if (item?.stock_status === "outofstock" || item?.stock_status === "onbackorder") return "is-backorder";
    return "is-instock";
  }

  function cartItemMetaHtml(item) {
    if (isCalendarCartItem(item)) {
      return `
        <div class="cart-item-meta" aria-label="Dostupnosť produktu">
          <span class="cart-stock ${stockClass(item)}"><i></i>${esc(stockText(item))}</span>
        </div>
      `;
    }
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

  function isCompatibleDiscountItem(item) {
    const type = String(item?.product_type_key || item?.productTypeKey || "").toLowerCase();
    const label = String(item?.product_type_label || item?.productTypeLabel || item?.name || "").toLowerCase();
    return type === "compatible" || label.includes("kompatibil");
  }

  function quantityDiscountRate(item) {
    if (isCalendarCartItem(item)) {
      const qty = cleanQty(item.qty);
      if (qty >= 21) return 0.15;
      if (qty >= 3) return 0.05;
      return 0;
    }
    if (!isCompatibleDiscountItem(item)) return 0;
    const qty = cleanQty(item.qty);
    if (qty >= 4) return 0.25;
    if (qty >= 2) return 0.10;
    return 0;
  }

  function quantityLineDiscount(item) {
    const qty = cleanQty(item.qty);
    const original = Math.round(Number(item.price || 0) * qty * 100) / 100;
    const rate = quantityDiscountRate(item);
    if (isCalendarCartItem(item) && rate > 0) {
      const discountedUnit = Math.round(Number(item.price || 0) * (1 - rate) * 100) / 100;
      const final = Math.round(discountedUnit * qty * 100) / 100;
      return Math.max(0, Math.round((original - final) * 100) / 100);
    }
    return Math.round(original * rate * 100) / 100;
  }

  function cartPricing(cart = readCart()) {
    const totals = (cart || []).reduce((acc, item) => {
      const qty = cleanQty(item.qty);
      const lineOriginal = Number(item.price || 0) * qty;
      const lineDiscount = quantityLineDiscount(item);
      acc.subtotal += lineOriginal;
      acc.discount += lineDiscount;
      return acc;
    }, { subtotal: 0, discount: 0 });

    totals.discount = Math.round(totals.discount * 100) / 100;
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

    const incomingReward = isPaperRewardCartItem(product);
    const existing = cart.find((item) => item.sku === sku && isPaperRewardCartItem(item) === incomingReward);
    const requestedAddition = cleanQty(product.qty || 1);
    const previousQty = existing ? cleanQty(existing.qty) : 0;

    if (existing) {
      const stockSource = {
        ...existing,
        stock_status: product.stock_status || existing.stock_status || "instock",
        stock_quantity: product.stock_quantity ?? existing.stock_quantity ?? null,
      };
      const requestedTotal = cleanQty(existing.qty) + requestedAddition;
      const acceptedTotal = limitedQty(stockSource, requestedTotal, true);
      if (acceptedTotal <= cleanQty(existing.qty)) return { added: 0, limited: true };
      existing.qty = acceptedTotal;
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
      if (product.source) existing.source = String(product.source);
    } else {
      const acceptedQty = limitedQty(product, requestedAddition, true);
      if (acceptedQty < 1) return { added: 0, limited: true };
      cart.push({
        sku,
        name: product.name || "Produkt",
        price: Number(product.price || 0),
        image: product.image || "",
        url: productUrl(product),
        slug: product.slug || "",
        qty: acceptedQty,
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
        source: String(product.source || ""),
      });
    }

    saveCart(cart);
    const savedItem = cart.find((item) => item.sku === sku && isPaperRewardCartItem(item) === incomingReward);
    const actualAdded = Math.max(0, cleanQty(savedItem?.qty) - previousQty);
    if (typeof window.tmTrackCartAdd === "function") {
      window.tmTrackCartAdd(product, actualAdded);
    }
    return { added: actualAdded, limited: actualAdded < requestedAddition };
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
        <div class="add-cart-summary" data-add-cart-summary aria-live="polite"></div>
        <div class="add-cart-actions">
          <a class="btn-primary" href="/pokladna">Do pokladne</a>
          <a class="btn-secondary" href="/kosik">Do košíka</a>
          <button class="btn-link" type="button" data-add-cart-close>Pokračovať v nákupe</button>
        </div>
        <section class="tm-drawer-benefits" aria-label="Výhody registrácie">
          <h3>Výhody registrácie</h3>
          <div><b>5 %</b><span><strong>Zľava za novú registráciu</strong><small>Uvítacia zľava na prvý nákup.</small></span></div>
          <div><b>7 %</b><span><strong>Odmena za dokončenú objednávku</strong><small>7 % zľava na ďalší nákup kompatibilných tonerov.</small></span></div>
          <div><b>★</b><span><strong>Vernostný program</strong><small>Za každé 1 € nákupu získate 1 bod.</small></span></div>
          <div><b>♡</b><span><strong>Vaše tlačiarne a tonery</strong><small>Uložte si ich do účtu a nabudúce ich nájdete rýchlejšie.</small></span></div>
          <a href="/vyhody-registracie">Pozrieť všetky výhody →</a>
        </section>
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

  function discountRows({ discount, couponDiscount, loyaltyDiscount }) {
    const percent = Number(tmCoupon?.percent || 0);
    return [
      ["Množstevná / sadová zľava", discount],
      [percent > 0 ? `Kupónová zľava ${percent} %` : "Kupónová zľava", couponDiscount],
      ["Vernostná zľava", loyaltyDiscount],
    ].filter(([, amount]) => amount > 0);
  }

  function benefitStatusText() {
    return benefitStatus === "pending" ? "Overujeme zľavy…" : "Zľavy sa nepodarilo overiť.";
  }

  function renderAddCartSummary(drawer) {
    const cart = readCart();
    ensureCartBenefits(cart);
    const count = cartCount(cart);
    const summary = drawer.querySelector("[data-add-cart-summary]");
    const line = (label, value) => `<div><span>${label}</span><strong>${value}</strong></div>`;
    let html = line("V košíku", `${count} ${count === 1 ? "produkt" : count >= 2 && count <= 4 ? "produkty" : "produktov"}`);
    if (benefitStatus === "ready") {
      const totals = cartGoodsTotals(cart, cartPricing(cart), couponDiscountForTotal, loyaltyDiscountForTotal);
      const discounts = discountRows(totals);
      if (discounts.length) html += line("Tovar pred zľavami", formatMoney(totals.subtotal));
      for (const [label, amount] of discounts) html += line(label, "-" + formatMoney(amount));
      html += line("Spolu za tovar", formatMoney(totals.total) + " s DPH");
      html += totals.missingForFreeShipping > 0
        ? `<p>Do dopravy zdarma chýba ${formatMoney(totals.missingForFreeShipping)}</p>`
        : '<p class="is-free">Dopravu máte zdarma</p>';
    } else {
      html += `<span role="status">${benefitStatusText()}</span>`;
      if (benefitStatus === "error") html += '<button class="btn-link" type="button" data-cart-retry-discounts>Skúsiť znova</button>';
    }
    summary.innerHTML = html;
  }

  function showAddCartDrawer(product) {
    const drawer = ensureAddCartDrawer();
    const cart = readCart();
    const sku = String(product?.sku || '').trim();
    const item = cart.find((cartItem) => String(cartItem.sku || '').trim() === sku) || product || cart[cart.length - 1] || {};
    const itemGross = Number(item.price || 0);
    const statusEl = drawer.querySelector('[data-add-cart-status]');
    if (statusEl) statusEl.textContent = 'Produkt bol pridaný do košíka';

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
            <span>za 1 ks s DPH pred zľavami</span>
          </div>
        </div>
      `;
    }

    if (benefitStatus === "error") couponCartKey = undefined;
    renderAddCartSummary(drawer);

    if (addCartDrawerTimer) window.clearTimeout(addCartDrawerTimer);
    drawer.hidden = false;
    document.body.classList.add('has-add-cart-drawer');
    window.requestAnimationFrame(() => drawer.classList.add('is-open'));
    addCartDrawerTimer = window.setTimeout(() => {
      if (benefitStatus === "ready") hideAddCartDrawer();
    }, 10000);
  }

  function updateQty(sku, qty, rewardItem = false) {
    let result = { qty: cleanQty(qty), limited: false };
    const cart = readCart().map((item) => {
      if (item.sku === sku && isPaperRewardCartItem(item) === Boolean(rewardItem)) {
        const requested = cleanQty(qty);
        const accepted = limitedQty(item, requested, true);
        result = { qty: Math.max(1, accepted), limited: accepted < requested };
        return { ...item, qty: result.qty };
      }
      return item;
    });

    saveCart(cart);
    return result;
  }

  function removeFromCart(sku, rewardItem = false) {
    saveCart(readCart().filter((item) => item.sku !== sku || isPaperRewardCartItem(item) !== Boolean(rewardItem)));
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
    const checkoutButtons = document.querySelectorAll('.checkout-button, .cart-mobile-sticky-checkout');

    if (!list) return;

    const cart = readCart();
    ensureCartBenefits(cart);
    const mobileBreakdown = document.querySelector("[data-cart-mobile-breakdown]");
    if (mobileBreakdown) mobileBreakdown.hidden = !cart.length;
    const hasUnavailable = cart.some((item) => !isPaperRewardCartItem(item) && cartProductUnavailable(item));
    list.innerHTML = "";

    if (cart.length === 0) {
      document.querySelector("[data-cart-benefits-status]").hidden = true;
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
      const isPaperReward = isPaperRewardCartItem(item);
      const unavailable = !isPaperReward && cartProductUnavailable(item);
      const qty = cleanQty(item.qty);
      const maxQty = stockLimit(item);
      const qtyMax = 99;
      const itemTotal = Number(item.price || 0) * qty;
      const itemDiscountRate = quantityDiscountRate(item);
      const itemDiscount = quantityLineDiscount(item);
      const itemFinal = Math.max(0, itemTotal - itemDiscount);

      const row = document.createElement("article");
      row.className = `cart-item${unavailable ? ' is-unavailable' : ''}`;
      row.dataset.sku = item.sku;
      row.dataset.rewardItem = String(isPaperReward);

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
          ${isPaperReward ? `<strong class="cart-line-discount">Automatická vernostná odmena</strong>` : `<button class="cart-remove" type="button" data-cart-action="remove" data-sku="${esc(item.sku)}">Odstrániť</button>`}
        </div>

        <div class="cart-item-price">${formatMoney(item.price)}</div>

        <div class="cart-item-quantity">
          <div class="qty-control">
            <button type="button" data-cart-action="minus" data-sku="${esc(item.sku)}" data-reward-item="${isPaperReward}" aria-label="Znížiť množstvo" ${isPaperReward || unavailable ? "disabled" : ""}>−</button>
            <input type="number" min="1" max="${qtyMax}" value="${qty}" data-cart-action="input" data-sku="${esc(item.sku)}" data-reward-item="${isPaperReward}" aria-label="Množstvo" ${isPaperReward || unavailable ? "disabled" : ""}/>
            <button type="button" data-cart-action="plus" data-sku="${esc(item.sku)}" data-reward-item="${isPaperReward}" aria-label="Zvýšiť množstvo" ${isPaperReward || unavailable ? "disabled" : ""}>+</button>
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
              <strong data-tm-dispatch-message${maxQty !== null && qty > maxQty || !isAvailableNow(item) ? " data-tm-dispatch-static" : ""}>${esc(maxQty !== null && qty > maxQty ? orderFulfilmentText(item, qty) : (isAvailableNow(item) ? getDispatchMessage() : ORDER_DELIVERY_LABEL))}</strong>
              <small>${maxQty !== null && qty > maxQty ? "Objednávku odošleme naraz po skompletizovaní všetkých kusov." : (isAvailableNow(item) ? "Produkty skladom pripravíme na odoslanie čo najskôr." : "Objednávku odošleme po naskladnení produktu.")}</small>
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

    const totals = cartGoodsTotals(cart, cartPricing(cart), couponDiscountForTotal, loyaltyDiscountForTotal);
    const { subtotal, discount, beforeCouponTotal, couponDiscount, loyaltyDiscount, total, missingForFreeShipping } = totals;
    const verified = benefitStatus === "ready";
    const totalText = verified ? formatMoney(total) : "—";

    document.querySelectorAll("[data-free-shipping-card]").forEach((card) => {
      const title = card.querySelector("[data-free-shipping-title]");
      const text = card.querySelector("[data-free-shipping-text]");
      const hasFreeShipping = verified && missingForFreeShipping === 0;
      if (!verified) {
        card.classList.remove("is-free");
        if (title) title.textContent = "Doprava zdarma od 29 €";
        if (text) text.textContent = benefitStatusText();
        return;
      }
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

    let afterQuantityEl = document.querySelector("[data-cart-after-quantity-line]");
    if (summary && !afterQuantityEl) {
      const line = document.createElement("div");
      line.className = "summary-line summary-after-quantity";
      line.dataset.cartAfterQuantityLine = "";
      line.innerHTML = `<span>Cena po množstevnej / sadovej zľave</span><strong data-cart-after-quantity>0,00 €</strong>`;
      const couponAnchor = summary.querySelector("[data-cart-coupon-line]") || summary.querySelector(".summary-note");
      summary.insertBefore(line, couponAnchor);
      afterQuantityEl = line;
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

    let couponBox = summary?.querySelector("[data-cart-coupon-box]");
    if (summary && !couponBox) {
      couponBox = document.createElement("form");
      couponBox.className = "summary-note coupon-note";
      couponBox.dataset.cartCouponBox = "";
      couponBox.innerHTML = couponFormMarkup();
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

    let desktopLoyaltyBox = summary?.querySelector("[data-cart-loyalty-box]");
    if (summary && !desktopLoyaltyBox) {
      desktopLoyaltyBox = document.createElement("div");
      desktopLoyaltyBox.className = "summary-note loyalty-note";
      desktopLoyaltyBox.dataset.cartLoyaltyBox = "";
      summary.insertBefore(desktopLoyaltyBox, summary.querySelector(".summary-total"));
    }

    document.querySelectorAll("[data-cart-loyalty-box]").forEach((loyaltyBox) => {
      loyaltyBox.hidden = !tmLoyalty.ok || tmLoyalty.discountValue <= 0;
      if (!loyaltyBox.hidden) {
        loyaltyBox.innerHTML = `<strong>Vernostné body</strong><span>Máte ${tmLoyalty.points} bodov = zľava ${formatMoney(tmLoyalty.discountValue)}.</span><label class="checkline loyalty-toggle-line"><input type="checkbox" data-loyalty-toggle ${tmLoyaltyApply ? "checked" : ""}> <span>Použiť vernostnú zľavu v tejto objednávke</span></label>`;
      } else {
        loyaltyBox.innerHTML = "";
      }
    });

    if (afterQuantityEl) afterQuantityEl.hidden = discount <= 0;
    const afterQuantityValue = document.querySelector("[data-cart-after-quantity]");
    if (afterQuantityValue) afterQuantityValue.textContent = formatMoney(beforeCouponTotal);
    if (couponEl) couponEl.hidden = !verified || couponDiscount <= 0;
    const couponValueEl = document.querySelector("[data-cart-coupon]");
    if (couponValueEl) couponValueEl.textContent = couponDiscount > 0 ? `-${formatMoney(couponDiscount)}` : "";
    syncCouponBoxes(verified ? couponDiscount : 0);

    if (loyaltyEl) loyaltyEl.hidden = !verified || loyaltyDiscount <= 0;
    document.querySelectorAll("[data-cart-loyalty]").forEach((loyaltyValueEl) => {
      loyaltyValueEl.textContent = loyaltyDiscount > 0 ? `-${formatMoney(loyaltyDiscount)}` : "";
    });

    if (discountEl) discountEl.hidden = discount <= 0;
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
    const discountValueEl = document.querySelector("[data-cart-discount]");
    if (discountValueEl) discountValueEl.textContent = discount > 0 ? `-${formatMoney(discount)}` : "";
    const vatTotals = grossVatTotals([...cart.map(discountedGrossLine), -couponDiscount, -loyaltyDiscount], total);
    if (mobileBreakdown) {
      const rows = verified ? discountRows(totals) : [];
      const detail = mobileBreakdown.querySelector("[data-cart-breakdown-discounts]");
      detail.hidden = !rows.length;
      detail.innerHTML = rows.length ? `<div><dt>Tovar pred zľavami</dt><dd>${formatMoney(subtotal)}</dd></div>` +
        rows.map(([label, value]) => `<div><dt>${label}</dt><dd>-${formatMoney(value)}</dd></div>`).join("") : "";
      mobileBreakdown.querySelector("[data-cart-breakdown-net]").textContent = verified ? formatMoney(vatTotals.net) : "—";
      mobileBreakdown.querySelector("[data-cart-breakdown-vat]").textContent = verified ? formatMoney(vatTotals.tax) : "—";
      mobileBreakdown.querySelector("[data-cart-breakdown-total]").textContent = totalText;
    }
    if (netEl) netEl.textContent = verified ? formatMoney(vatTotals.net) : "—";
    if (vatEl) vatEl.textContent = verified ? formatMoney(vatTotals.tax) : "—";
    if (totalEl) totalEl.textContent = totalText;
    if (mobileTotalEl) mobileTotalEl.textContent = totalText;
    document.querySelectorAll("[data-cart-benefits-status]").forEach((box) => {
      box.hidden = verified;
      box.querySelector("span").textContent = verified ? "" : benefitStatusText();
      box.querySelector("button").hidden = benefitStatus !== "error";
    });

    let unavailableNotice = document.querySelector('[data-cart-unavailable-notice]');
    if (summary && !unavailableNotice) {
      unavailableNotice = document.createElement('div');
      unavailableNotice.dataset.cartUnavailableNotice = '';
      unavailableNotice.className = 'summary-note cart-unavailable-notice';
      unavailableNotice.textContent = 'V košíku je vypredaný alebo už nedostupný produkt. Odstráňte ho, aby ste mohli pokračovať do pokladne.';
      summary.insertBefore(unavailableNotice, summary.querySelector('.summary-total'));
    }
    if (unavailableNotice) unavailableNotice.hidden = !hasUnavailable;
    checkoutButtons.forEach((button) => {
      if (hasUnavailable) {
        if (!button.dataset.checkoutHref) button.dataset.checkoutHref = button.getAttribute('href') || '/pokladna';
        button.setAttribute('href', '#');
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.setAttribute('href', button.dataset.checkoutHref || '/pokladna');
        button.removeAttribute('aria-disabled');
      }
    });

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
    if (event.target.closest("[data-cart-retry-discounts]")) {
      couponCartKey = undefined;
      renderCartViews();
      return;
    }
    const blockedCheckout = event.target.closest('[aria-disabled="true"].checkout-button, [aria-disabled="true"].cart-mobile-sticky-checkout');
    if (blockedCheckout) {
      event.preventDefault();
      document.querySelector('[data-cart-unavailable-notice]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const couponToggle = event.target.closest("[data-coupon-toggle]");
    if (couponToggle) {
      const box = couponToggle.closest("[data-cart-coupon-box]");
      if (box) setCouponBoxExpanded(box, box.dataset.couponExpanded !== "true");
      return;
    }

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
      removeFromCart(sku, cartButton.dataset.rewardItem === "true");
      renderCartPage();
      return;
    }

    if (action === "minus") {
      const item = readCart().find((cartItem) => cartItem.sku === sku);
      updateQty(sku, cleanQty(item?.qty || 1) - 1, cartButton.dataset.rewardItem === "true");
      renderCartPage();
      return;
    }

    if (action === "plus") {
      const item = readCart().find((cartItem) => cartItem.sku === sku);
      updateQty(sku, cleanQty(item?.qty || 1) + 1, cartButton.dataset.rewardItem === "true");
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

    updateQty(input.dataset.sku, input.value, input.dataset.rewardItem === "true");
    renderCartPage();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== null && ![CART_KEY, "tm_coupon_v1", "tm_loyalty_apply"].includes(event.key)) return;
    if (!event.key || event.key === "tm_coupon_v1") {
      tmCoupon = readSavedCoupon();
      enteredCartCoupon = undefined;
      couponCartKey = undefined;
      ++couponRevision;
    }
    if (!event.key || event.key === "tm_loyalty_apply") tmLoyaltyApply = localStorage.getItem("tm_loyalty_apply") !== "0";
    if (!event.key || event.key === CART_KEY) refreshCartCounters();
    renderCartViews();
  });

  document.addEventListener("DOMContentLoaded", async () => {
    refreshCartCounters();
    renderCartPage();
    refreshDispatchMessages(document);
    const cartPage = document.querySelector("[data-cart-list]");
    if (cartPage && readCart().length) {
      // Odmenu načítame pred hydratáciou. Inak mohla pomalšia hydratácia
      // uložiť staršiu kópiu košíka a práve pridanú odmenu znovu odstrániť.
      await getCartLoyalty().catch(() => {});
      const changed = await hydrateCartProducts();
      if (changed) { renderCartPage(); refreshDispatchMessages(document); }
    }
  });

  window.setInterval(() => refreshDispatchMessages(document), 60000);

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
