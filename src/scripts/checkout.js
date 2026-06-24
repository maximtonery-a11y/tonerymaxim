(() => {
  if (window.__TM_CHECKOUT_INIT__) return;
  window.__TM_CHECKOUT_INIT__ = true;

  const CART_KEYS = ["tm_cart_v1", "tonerymaxim_cart", "cart", "tm_cart"];

  const DPD_WIDGET_KEY = "iwzhr18lr8fiwp8xz68oicw1jv6vpow5";
  const DPD_WIDGET_LIBRARY_URL = "https://pus-maps.dpd.sk/lib/library.js";

  // Verejný GLS Map Widget API key z implementačnej príručky GLS.
  // Po dodaní vlastného kľúča od GLS stačí vymeniť túto hodnotu.
  const GLS_WIDGET_KEY = "A13D8A67AC46781E04A04C5D0F3B53EA248088022DD62DA5D800EB3B395B0E61DD88C281F1FF0FCCC276B26B5EA7AE70A9A39BFF2137FD6F1859760C3ADBF975";

  const SHIPPING = {
    dpd_courier: { carrier: "DPD", type: "courier", label: "DPD kuriér na adresu", price: 3.9 },
    dpd_pickup: { carrier: "DPD", type: "pickup", label: "DPD Pickup", price: 2.9 },
    dpd_box: { carrier: "DPD", type: "box", label: "DPD Pickup Box", price: 2.9 },
    gls_courier: { carrier: "GLS", type: "courier", label: "GLS kuriér na adresu", price: 3.9 },
    gls_pickup: { carrier: "GLS", type: "pickup_or_box", label: "GLS ParcelShop / Balíkomat", price: 2.9 },
  };

  let selectedDpdPickup = null;
  let selectedGlsPickup = null;
  let dpdWidgetLoading = null;
  let dpdWidgetInstance = null;
  let glsWidgetLoading = null;

  const PAYMENT = {
    gopay: { label: "Platba online GoPay", price: 0, gopayInstrument: "PAYMENT_CARD" },
    applepay: { label: "Apple Pay", price: 0, gopayInstrument: "APPLE_PAY" },
    googlepay: { label: "Google Pay", price: 0, gopayInstrument: "GOOGLE_PAY" },
    cod: { label: "Dobierka", price: 1.2 },
    bank_prepaid: { label: "Platba prevodným príkazom vopred", price: 0 },
    invoice_org: { label: "Prevodný príkaz pre organizácie a firmy", price: 0 },
  };

  function normalizeNumber(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/\s/g, "").replace("€", "").replace(",", ".");
      const number = Number(cleaned);
      return Number.isFinite(number) ? number : 0;
    }
    return 0;
  }

  function cleanQty(value) {
    const number = parseInt(String(value ?? ""), 10);
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

  function firstFilled(...values) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text && text.toLowerCase() !== "neuvedené") return text;
    }
    return "";
  }

  function productCapacity(item) {
    return firstFilled(
      item?.capacity,
      item?.kapacita,
      item?.yield,
      item?.page_yield,
      item?.pageYield,
      item?.pages,
      item?.ml,
      item?.volume
    );
  }

  function productUrl(item) {
    const url = String(item?.url || item?.detail_url || "").trim();
    if (url && url !== "#") return url;
    const slug = String(item?.slug || "").trim();
    if (slug) return `/produkt/${encodeURIComponent(slug)}`;
    return "/produkty";
  }

  function stockText(item) {
    if (item?.stock_text) return String(item.stock_text);
    if (item?.stock_status === "instock") {
      if (item.stock_quantity !== null && item.stock_quantity !== undefined && item.stock_quantity !== "") return `Skladom ${item.stock_quantity} ks`;
      return "Skladom";
    }
    if (item?.stock_status === "onbackorder") return "Na objednávku";
    if (item?.stock_status === "outofstock") return "Nie je skladom";
    return "Dostupnosť neznáma";
  }

  function normalizeCartItem(item, index) {
    if (!item || typeof item !== "object") return null;

    const price =
      normalizeNumber(item.price) ||
      normalizeNumber(item.unitPrice) ||
      normalizeNumber(item.regular_price) ||
      normalizeNumber(item.sale_price) ||
      normalizeNumber(item.amount);

    const name =
      item.name ||
      item.title ||
      item.productName ||
      item.product_name ||
      `Produkt ${index + 1}`;

    const qty =
      item.qty ??
      item.quantity ??
      item.count ??
      item.pocet ??
      1;

    if (!name || price <= 0) return null;

    return {
      id: String(item.id || item.productId || item.product_id || item.sku || item.code || name),
      sku: String(item.sku || item.code || item.id || ""),
      name: String(name),
      price,
      qty: cleanQty(qty),
      image: item.image || item.img || item.thumbnail || "",
      url: productUrl(item),
      slug: String(item.slug || ""),
      color: firstFilled(item.color, item.farba),
      capacity: productCapacity(item),
      stock_status: String(item.stock_status || item.stockStatus || "instock"),
      stock_quantity: item.stock_quantity ?? item.stockQuantity ?? null,
      stock_text: String(item.stock_text || item.stockText || ""),
      product_type_key: String(item.product_type_key || item.productTypeKey || item.type || ""),
      product_type_label: String(item.product_type_label || item.productTypeLabel || ""),
      series_pack_key: String(item.series_pack_key || item.seriesPackKey || ""),
      series_pack_label: String(item.series_pack_label || item.seriesPackLabel || ""),
      series_pack_discount_rate: Number(item.series_pack_discount_rate || item.seriesPackDiscountRate || 0),
    };
  }

  function readCart() {
    for (const key of CART_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const parsed = JSON.parse(raw);

        let items = [];

        if (Array.isArray(parsed)) {
          items = parsed;
        } else if (Array.isArray(parsed.items)) {
          items = parsed.items;
        } else if (Array.isArray(parsed.products)) {
          items = parsed.products;
        } else if (parsed && typeof parsed === "object") {
          items = Object.values(parsed);
        }

        const normalized = items
          .map((item, index) => normalizeCartItem(item, index))
          .filter(Boolean);

        if (normalized.length > 0) {
          localStorage.setItem("tm_cart_v1", JSON.stringify(normalized));
          return normalized;
        }
      } catch {
        // pokračujeme na ďalší možný kľúč
      }
    }

    return [];
  }

  function money(value) {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function cartTotal(cart) {
    return cart.reduce((sum, item) => sum + Number(item.price || 0) * cleanQty(item.qty), 0);
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

  function cartPricing(cart) {
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

  function getSelected(name) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : "";
  }

  function getInput(name) {
    return document.querySelector(`[name="${name}"]`);
  }

  function setValue(name, value) {
    const input = getInput(name);
    if (input && value !== undefined && value !== null && String(value).trim() !== "") {
      input.value = String(value);
      input.classList.remove("is-invalid");
    }
  }

  function uniqueCityZip(items) {
    const map = new Map();

    (items || []).forEach((item) => {
      const zip = String(item.zip || "").trim();
      const city = String(item.city || "").trim();
      if (!zip || !city) return;

      map.set(`${zip}|${city.toLowerCase()}`, {
        zip,
        city,
        street: String(item.street || "").trim(),
        postOffice: String(item.postOffice || "").trim(),
        district: String(item.district || "").trim(),
      });
    });

    return [...map.values()];
  }

  function installPostalPickerStyles() {
    if (document.querySelector("#tm-postal-picker-style")) return;

    const style = document.createElement("style");
    style.id = "tm-postal-picker-style";
    style.textContent = `
      .tm-postal-picker {
        margin-top: 8px;
        border: 1px solid #d7e3f3;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 18px 46px rgba(7, 27, 58, .14);
        overflow: hidden;
        z-index: 30;
      }

      .tm-postal-picker-title {
        padding: 10px 13px;
        background: #f3f8ff;
        color: #475467;
        font-size: 12px;
        font-weight: 850;
        border-bottom: 1px solid #e4edf7;
      }

      .tm-postal-picker button {
        width: 100%;
        border: 0;
        background: #fff;
        display: grid;
        grid-template-columns: 82px 1fr;
        gap: 12px;
        align-items: center;
        text-align: left;
        padding: 11px 13px;
        cursor: pointer;
        color: #071b3a;
        font-weight: 850;
      }

      .tm-postal-picker button:hover,
      .tm-postal-picker button:focus {
        background: #eef6ff;
        outline: none;
      }

      .tm-postal-picker-code {
        color: #0078d4;
        font-weight: 950;
      }

      .tm-postal-picker-meta {
        display: block;
        margin-top: 2px;
        color: #667085;
        font-size: 12px;
        font-weight: 700;
      }
    `;
    document.head.appendChild(style);
  }

  function removePostalPicker(group) {
    document.querySelector(`[data-postal-picker="${group}"]`)?.remove();
  }

  function showPostalPicker({ group, anchorInput, zipInput, cityInput, results, title }) {
    installPostalPickerStyles();
    removePostalPicker(group);

    const cleanResults = uniqueCityZip(results);

    if (!anchorInput || !zipInput || !cityInput || cleanResults.length <= 1) return false;

    const picker = document.createElement("div");
    picker.className = "tm-postal-picker";
    picker.dataset.postalPicker = group;

    const titleEl = document.createElement("div");
    titleEl.className = "tm-postal-picker-title";
    titleEl.textContent = title || "Vyberte správnu obec / mesto";
    picker.appendChild(titleEl);

    cleanResults.slice(0, 18).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";

      const meta = [item.street, item.postOffice, item.district].filter(Boolean).join(" · ");

      button.innerHTML = `
        <span class="tm-postal-picker-code">${item.zip}</span>
        <span>
          ${item.city}
          ${meta ? `<span class="tm-postal-picker-meta">${meta}</span>` : ""}
        </span>
      `;

      button.addEventListener("click", () => {
        zipInput.value = item.zip;
        cityInput.value = item.city;
        zipInput.classList.remove("is-invalid");
        cityInput.classList.remove("is-invalid");
        removePostalPicker(group);
      });

      picker.appendChild(button);
    });

    const label = anchorInput.closest("label");
    if (label) {
      label.appendChild(picker);
    } else {
      anchorInput.insertAdjacentElement("afterend", picker);
    }

    return true;
  }

  function isDpdPickupShipping(shipping) {
    return shipping === "dpd_pickup" || shipping === "dpd_box";
  }

  function isGlsPickupShipping(shipping) {
    return shipping === "gls_pickup";
  }

  function needsPickupShipping(shipping) {
    return isDpdPickupShipping(shipping) || isGlsPickupShipping(shipping);
  }

  function updateVisibility() {
    const shipping = getSelected("shipping");
    const company = document.querySelector("#company_enabled")?.checked;
    const differentAddress = document.querySelector("#different_address")?.checked;

    const needsPickup = needsPickupShipping(shipping);
    const pickupBox = document.querySelector("[data-pickup-box]");

    if (pickupBox) {
      pickupBox.hidden = !needsPickup;
      pickupBox.classList.toggle("is-visible", needsPickup);
    }

    if (!isDpdPickupShipping(shipping)) {
      selectedDpdPickup = null;
      const input = document.querySelector("#DPDPickupPointResult");
      if (input) input.value = "";
    }

    if (!isGlsPickupShipping(shipping)) {
      selectedGlsPickup = null;
      const input = document.querySelector("#GLSPickupPointResult");
      if (input) input.value = "";
    }

    renderPickupSummary();
    document.querySelector("[data-company-box]")?.toggleAttribute("hidden", !company);
    document.querySelector("[data-delivery-address]")?.toggleAttribute("hidden", !differentAddress);
  }

  function renderCheckoutSummary() {
    const list = document.querySelector("[data-checkout-items]");
    if (!list) return;

    const cart = readCart();
    const empty = document.querySelector("[data-checkout-empty]");
    const form = document.querySelector("[data-checkout-form]");

    list.innerHTML = "";

    if (cart.length === 0) {
      if (empty) empty.hidden = false;
      if (form) form.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (form) form.hidden = false;

    cart.forEach((item) => {
      const qty = cleanQty(item.qty);
      const lineFinal = Number(item.price || 0) * qty;
      const row = document.createElement("div");
      row.className = "checkout-product";
      const attrs = [item.color, item.capacity, stockText(item)].filter(Boolean).map(esc).join(" · ");
      row.innerHTML = `
        <a class="checkout-product-thumb" href="${esc(item.url)}" aria-label="Otvoriť detail produktu ${esc(item.name)}">${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" />` : "TM"}</a>
        <div>
          <a class="checkout-product-name" href="${esc(item.url)}">${esc(item.name)}</a>
          <span>${qty} × ${money(item.price)}</span>
          ${attrs ? `<small class="checkout-product-attrs">${attrs}</small>` : ""}
        </div>
        <b>${money(lineFinal)}</b>
      `;
      list.appendChild(row);
    });

    const pricing = cartPricing(cart);
    const subtotal = pricing.subtotal;
    const discount = pricing.discount;
    const discountedSubtotal = Math.max(0, subtotal - discount);
    const shipping = SHIPPING[getSelected("shipping") || "dpd_courier"] || SHIPPING.dpd_courier;
    const payment = PAYMENT[getSelected("payment") || "gopay"] || PAYMENT.gopay;

    const shippingPrice = discountedSubtotal >= 29 ? 0 : shipping.price;
    const paymentPrice = payment.price;
    const total = discountedSubtotal + shippingPrice + paymentPrice;

    document.querySelector("[data-summary-subtotal]").textContent = money(subtotal);
    const discountLine = document.querySelector("[data-summary-discount-line]");
    if (discountLine) discountLine.hidden = discount <= 0;
    const discountValue = document.querySelector("[data-summary-discount]");
    if (discountValue) discountValue.textContent = `-${money(discount)}`;
    document.querySelector("[data-summary-shipping-label]").textContent = shipping.label;
    document.querySelector("[data-summary-shipping]").textContent = shippingPrice === 0 ? "Zdarma" : money(shippingPrice);
    document.querySelector("[data-summary-payment-label]").textContent = payment.label;
    document.querySelector("[data-summary-payment]").textContent = paymentPrice === 0 ? "Bez poplatku" : money(paymentPrice);
    document.querySelector("[data-summary-total]").textContent = money(total);

    const mobileTotal = document.querySelector("[data-mobile-total]");
    if (mobileTotal) mobileTotal.textContent = money(total);

    const mobileSummaryTotal = document.querySelector("[data-mobile-summary-total]");
    if (mobileSummaryTotal) mobileSummaryTotal.textContent = money(total);

    const mobileSticky = document.querySelector("[data-checkout-mobile-sticky]");
    if (mobileSticky) mobileSticky.hidden = cart.length === 0;

    const freeBox = document.querySelector("[data-free-shipping]");
    if (freeBox) {
      if (discountedSubtotal >= 29) {
        freeBox.className = "free-shipping-box is-free";
        freeBox.textContent = "🎉 Dopravu máte zdarma";
      } else {
        freeBox.className = "free-shipping-box";
        freeBox.textContent = `Do dopravy zdarma vám chýba ${money(29 - discountedSubtotal)}`;
      }
    }
  }

  function validateField(input) {
    const value = input.value.trim();
    let valid = true;

    if (input.required && value.length === 0) valid = false;
    if (input.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) valid = false;
    if (input.type === "tel" && value && value.replace(/\D/g, "").length < 9) valid = false;
    if ((input.name === "zip" || input.name === "delivery_zip") && value && value.replace(/\D/g, "").length < 5) valid = false;

    input.classList.toggle("is-invalid", !valid);
    return valid;
  }

  function validateCheckout() {
    const requiredFields = document.querySelectorAll("[data-checkout-form] input[required]");
    let valid = true;

    requiredFields.forEach((input) => {
      if (!validateField(input)) valid = false;
    });

    const shippingType = getSelected("shipping");
    const missingDpdPickup = isDpdPickupShipping(shippingType) && !selectedDpdPickup;
    const missingGlsPickup = isGlsPickupShipping(shippingType) && !selectedGlsPickup;

    if (missingDpdPickup || missingGlsPickup) {
      document.querySelector("[data-pickup-box]")?.classList.add("is-invalid-pickup");
      valid = false;
    } else {
      document.querySelector("[data-pickup-box]")?.classList.remove("is-invalid-pickup");
    }

    const terms = document.querySelector("#terms");
    if (terms && !terms.checked) {
      terms.closest(".checkline").classList.add("is-invalid-line");
      valid = false;
    } else if (terms) {
      terms.closest(".checkline").classList.remove("is-invalid-line");
    }

    return valid;
  }

  async function lookupPostalByZip(pair, force = false) {
    const zipInput = getInput(pair.zip);
    const cityInput = getInput(pair.city);
    const zip = String(zipInput?.value || "").replace(/\D/g, "");

    if (zip.length !== 5) return;

    try {
      const response = await fetch(`/api/psc?zip=${encodeURIComponent(zip)}`);
      const data = await response.json();

      if (!response.ok || !data.ok) return;

      const results = uniqueCityZip(data.results || []);

      if (results.length > 1) {
        showPostalPicker({
          group: pair.group,
          anchorInput: zipInput,
          zipInput,
          cityInput,
          results,
          title: `PSČ ${zip} má viac možností. Vyberte správnu obec / časť obce:`,
        });
        return;
      }

      removePostalPicker(pair.group);

      if (data.city && cityInput) {
        if (force || !cityInput.value.trim()) {
          cityInput.value = data.city;
          cityInput.classList.remove("is-invalid");
        }
      }
    } catch {
      // Pomocná funkcia, checkout nesmie spadnúť.
    }
  }

  async function lookupPostalByCity(pair, force = false) {
    const cityInput = getInput(pair.city);
    const zipInput = getInput(pair.zip);
    const streetInput = getInput(pair.street);
    const city = String(cityInput?.value || "").trim();
    const street = String(streetInput?.value || "").trim();

    if (!city || !zipInput) return;

    try {
      const params = new URLSearchParams();
      params.set("city", city);
      if (street) params.set("street", street);

      const response = await fetch(`/api/psc?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || !data.ok) return;

      const results = uniqueCityZip(data.results || []);

      if (results.length > 1) {
        showPostalPicker({
          group: pair.group,
          anchorInput: cityInput,
          zipInput,
          cityInput,
          results,
          title: `${city} má viac PSČ. Vyberte správne:`,
        });
        return;
      }

      removePostalPicker(pair.group);

      if (data.zip) {
        if (force || !zipInput.value.trim()) {
          zipInput.value = data.zip;
          zipInput.classList.remove("is-invalid");
        }
      }
    } catch {
      // Pomocná funkcia, checkout nesmie spadnúť.
    }
  }

  function debounce(fn, delay = 400) {
    let timer;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function setupPostalAutofill() {
    const pairs = [
      { group: "billing", zip: "zip", city: "city", street: "address" },
      { group: "delivery", zip: "delivery_zip", city: "delivery_city", street: "delivery_street" },
    ];

    pairs.forEach((pair) => {
      const zipInput = getInput(pair.zip);
      const cityInput = getInput(pair.city);
      const streetInput = getInput(pair.street);

      const zipHandler = debounce(() => lookupPostalByZip(pair, false), 350);
      const cityHandler = debounce(() => lookupPostalByCity(pair, false), 450);

      zipInput?.addEventListener("input", zipHandler);
      zipInput?.addEventListener("blur", () => lookupPostalByZip(pair, false));

      cityInput?.addEventListener("input", cityHandler);
      cityInput?.addEventListener("blur", () => lookupPostalByCity(pair, false));

      streetInput?.addEventListener("blur", () => lookupPostalByCity(pair, false));
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".tm-postal-picker") && !event.target.matches('[name="zip"], [name="city"], [name="delivery_zip"], [name="delivery_city"]')) {
        removePostalPicker("billing");
        removePostalPicker("delivery");
      }
    });
  }

  async function loadCompanyByIco() {
    const icoInput = document.querySelector('[name="ico"]');
    const status = document.querySelector("[data-company-status]");
    const button = document.querySelector("[data-load-company]");
    const ico = String(icoInput?.value || "").replace(/\D/g, "");

    if (ico.length !== 8) {
      status.textContent = "Zadajte IČO v tvare 8 číslic.";
      status.className = "company-status is-error";
      return;
    }

    button.disabled = true;
    status.textContent = "Načítavam firmu...";
    status.className = "company-status";

    try {
      const response = await fetch(`/api/company?ico=${encodeURIComponent(ico)}`);
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || data.detail || "Firmu sa nepodarilo načítať.");
      }

      const company = data.company || {};

      setValue("company", company.name);
      setValue("dic", company.dic);
      setValue("icdph", company.icDph);

      if (company.address) {
        setValue("address", company.address.street);
        setValue("city", company.address.city);
        setValue("zip", company.address.zip);

        if (!company.address.zip && company.address.city) {
          await lookupPostalByCity({ group: "billing", zip: "zip", city: "city", street: "address" }, false);
        }
      }

      status.textContent = company.name ? "Firma bola načítaná." : "";
      status.className = "company-status is-success";
    } catch (error) {
      status.textContent = error.message || "Nepodarilo sa načítať firmu.";
      status.className = "company-status is-error";
    } finally {
      button.disabled = false;
    }
  }


  function buildDpdWidgetUrl(mode) {
    const params = new URLSearchParams();
    params.set("key", DPD_WIDGET_KEY);
    params.set("lang", "sk");
    params.set("countries", "SK");
    params.set("enabledCountries", "SK");
    params.set("hideFeatures", "true");

    if (mode === "pickup") {
      params.set("disableLockers", "true");
    }

    return `https://api.dpd.cz/widget/latest/index.html?${params.toString()}`;
  }

  function normalizeDpdPickup(widgetData) {
    const point = widgetData?.pickupPoint || widgetData?.parcelShop || widgetData?.point || widgetData || {};
    const rawResult = widgetData?.pickupPointResult || point?.pickupPointResult || JSON.stringify(point || {});

    const id =
      point.id ||
      point.pudoId ||
      point.pudo_id ||
      point.parcelshop_id ||
      point.parcelShopId ||
      point.pickupPointId ||
      point.pickup_point_id ||
      widgetData?.id ||
      "";

    const name =
      point.name ||
      point.company ||
      point.parcelshop_name ||
      point.pickupPointName ||
      point.title ||
      "DPD Pickup miesto";

    const streetParts = [point.street, point.houseno].filter(Boolean).join(" ").trim();
    const street =
      point.addressText ||
      point.address ||
      streetParts ||
      point.parcelshop_address ||
      point.pickupPointAddress ||
      "";

    const city = point.city || point.town || point.municipality || "";
    const zip = point.zip || point.zipCode || point.postalCode || point.postal_code || "";
    const country = point.country || point.countryCode || point.country_code || "SK";
    const lat = point.lat || point.latitude || point.gpsLat || "";
    const lng = point.lng || point.lon || point.longitude || point.gpsLng || "";
    const codAllowedRaw = point.cod_allowed ?? point.codAllowed ?? point.cod ?? null;
    const typeRaw = String(point.type || point.place || point.locationType || widgetData?.type || "").toLowerCase();

    const selectedShipping = getSelected("shipping");

    return {
      carrier: "DPD",
      delivery_type: selectedShipping === "dpd_box" || typeRaw === "locker" ? "box" : "pickup",
      pickup_id: String(id || rawResult).trim(),
      pickup_name: String(name).trim(),
      pickup_address: String(street).trim(),
      pickup_city: String(city).trim(),
      pickup_zip: String(zip).trim(),
      pickup_country: String(country).trim().toUpperCase(),
      pickup_lat: String(lat).trim(),
      pickup_lng: String(lng).trim(),
      cod_allowed: codAllowedRaw === null ? null : String(codAllowedRaw) === "1" || codAllowedRaw === true,
      raw_type: typeRaw,
      raw_result: String(rawResult || "").trim(),
      selected_at: new Date().toISOString(),
    };
  }

  function normalizeGlsPickup(point) {
    const selectedShipping = getSelected("shipping");
    const isLocker = Boolean(point?.isparcellocker);

    return {
      carrier: "GLS",
      delivery_type: isLocker ? "box" : "pickup",
      pickup_id: String(point?.id || point?.oldId || "").trim(),
      pickup_name: String(point?.title || "GLS výdajné miesto").trim(),
      pickup_address: String(point?.street || point?.address || "").trim(),
      pickup_city: String(point?.city || "").trim(),
      pickup_zip: String(point?.postalcode || "").trim(),
      pickup_country: String(point?.countrycode || "SK").trim(),
      pickup_lat: "",
      pickup_lng: "",
      cod_allowed: null,
      raw_type: isLocker ? "parcel_locker" : "parcel_shop",
      raw_result: JSON.stringify(point || {}),
      selected_at: new Date().toISOString(),
    };
  }

  function getSelectedPickup() {
    const shipping = getSelected("shipping");
    if (isDpdPickupShipping(shipping)) return selectedDpdPickup;
    if (isGlsPickupShipping(shipping)) return selectedGlsPickup;
    return null;
  }

  function renderPickupSummary() {
    const box = document.querySelector("[data-pickup-box]");
    const summary = document.querySelector("[data-pickup-summary]");
    const button = document.querySelector("[data-open-pickup-widget]");
    const shipping = getSelected("shipping");
    const needsPickup = needsPickupShipping(shipping);
    const selectedPickup = getSelectedPickup();

    if (!box || !summary || !button) return;

    if (!needsPickup) {
      box.hidden = true;
      box.classList.remove("is-visible", "is-invalid-pickup");
      summary.innerHTML = `
        <strong>Výdajné miesto zatiaľ nie je vybrané</strong>
        <p>Vyberte výdajné miesto alebo box cez mapu dopravcu.</p>
      `;
      button.textContent = "Vybrať na mape";
      return;
    }

    box.hidden = false;
    box.classList.add("is-visible");

    if (!selectedPickup) {
      const carrier = isGlsPickupShipping(shipping) ? "GLS" : "DPD";
      const label =
        shipping === "dpd_box" ? "DPD box zatiaľ nie je vybraný" :
        shipping === "dpd_pickup" ? "DPD Pickup miesto zatiaľ nie je vybrané" :
        "GLS ParcelShop / Balíkomat zatiaľ nie je vybraný";

      summary.innerHTML = `
        <strong>${label}</strong>
        <p>Výber je povinný pre tento spôsob doručenia.</p>
      `;
      button.textContent = `Vybrať ${carrier} mapu`;
      return;
    }

    const addressLine = [selectedPickup.pickup_address, selectedPickup.pickup_zip, selectedPickup.pickup_city]
      .filter(Boolean)
      .join(", ");

    summary.innerHTML = `
      <strong>${selectedPickup.pickup_name || "Vybrané výdajné miesto"}</strong>
      <p>${addressLine || selectedPickup.raw_result || "Adresa bude uložená k objednávke."}</p>
      ${selectedPickup.pickup_id ? `<small>ID: ${selectedPickup.pickup_id}</small>` : ""}
    `;
    button.textContent = "Zmeniť miesto";
    box.classList.remove("is-invalid-pickup");
  }

  function savePickupState() {
    try {
      localStorage.setItem("tm_checkout_dpd_pickup", JSON.stringify(selectedDpdPickup));
      localStorage.setItem("tm_checkout_gls_pickup", JSON.stringify(selectedGlsPickup));
    } catch {
      // noop
    }
  }

  function restorePickupState() {
    try {
      const rawDpd = localStorage.getItem("tm_checkout_dpd_pickup");
      if (rawDpd) {
        const parsed = JSON.parse(rawDpd);
        if (parsed && parsed.carrier === "DPD" && parsed.pickup_id) {
          selectedDpdPickup = parsed;
          const input = document.querySelector("#DPDPickupPointResult");
          if (input) input.value = parsed.raw_result || parsed.pickup_id || "";
        }
      }

      const rawGls = localStorage.getItem("tm_checkout_gls_pickup");
      if (rawGls) {
        const parsed = JSON.parse(rawGls);
        if (parsed && parsed.carrier === "GLS" && parsed.pickup_id) {
          selectedGlsPickup = parsed;
          const input = document.querySelector("#GLSPickupPointResult");
          if (input) input.value = parsed.raw_result || parsed.pickup_id || "";
        }
      }
    } catch {
      selectedDpdPickup = null;
      selectedGlsPickup = null;
    }
  }

  function openPickupWidget() {
    const shipping = getSelected("shipping");

    if (isDpdPickupShipping(shipping)) {
      openDpdWidget();
      return;
    }

    if (isGlsPickupShipping(shipping)) {
      openGlsWidget();
    }
  }

  function loadDpdWidgetScript() {
    if (window.DpdPudo?.Widget) return Promise.resolve();
    if (dpdWidgetLoading) return dpdWidgetLoading;

    dpdWidgetLoading = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-dpd-sk-widget-script]");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.dataset.dpdSkWidgetScript = "true";
      script.src = DPD_WIDGET_LIBRARY_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("DPD widget sa nepodarilo načítať."));
      document.head.appendChild(script);
    });

    return dpdWidgetLoading;
  }

  function getWidgetZip() {
    const deliveryZip = String(getInput("delivery_zip")?.value || "").replace(/\D/g, "");
    const billingZip = String(getInput("zip")?.value || "").replace(/\D/g, "");
    return deliveryZip.length === 5 ? deliveryZip : (billingZip.length === 5 ? billingZip : "");
  }

  async function openDpdWidget() {
    const shipping = getSelected("shipping");

    if (!isDpdPickupShipping(shipping)) return;

    const modal = document.querySelector("[data-dpd-modal]");
    const iframe = document.querySelector("[data-dpd-iframe]");
    const subtitle = document.querySelector("[data-dpd-modal-subtitle]");

    if (!modal || !iframe) return;

    iframe.src = buildDpdWidgetUrl(shipping === "dpd_box" ? "box" : "pickup");
    if (subtitle) {
      subtitle.textContent = shipping === "dpd_box" ? "Vyberte DPD Pickup Box na Slovensku" : "Vyberte DPD Pickup miesto na Slovensku";
    }
    modal.hidden = false;
    document.body.classList.add("has-dpd-modal");
  }

  function closeDpdWidget() {
    const modal = document.querySelector("[data-dpd-modal]");
    const iframe = document.querySelector("[data-dpd-iframe]");

    if (modal) modal.hidden = true;
    if (iframe) iframe.src = "about:blank";
    document.body.classList.remove("has-dpd-modal");
  }

  function loadGlsWidgetScript() {
    if (window.GlsWidget) return Promise.resolve();
    if (glsWidgetLoading) return glsWidgetLoading;

    glsWidgetLoading = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-gls-widget-script]");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.dataset.glsWidgetScript = "true";
      script.src = `https://plugin.gls-slovakia.sk/v1/${GLS_WIDGET_KEY}`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("GLS widget sa nepodarilo načítať."));
      document.head.appendChild(script);
    });

    return glsWidgetLoading;
  }

  async function openGlsWidget() {
    const shipping = getSelected("shipping");

    if (!isGlsPickupShipping(shipping)) return;

    const modal = document.querySelector("[data-gls-modal]");
    const subtitle = document.querySelector("[data-gls-modal-subtitle]");
    const root = document.querySelector("#gls-widget-root");

    if (!modal || !root) return;

    modal.hidden = false;
    document.body.classList.add("has-gls-modal");
    root.innerHTML = `<div class="gls-widget-loading">Načítavam GLS mapu...</div>`;

    if (subtitle) {
      subtitle.textContent = "Vyberte GLS ParcelShop alebo Balíkomat na Slovensku";
    }

    try {
      await loadGlsWidgetScript();

      if (!window.GlsWidget || typeof window.GlsWidget.open !== "function") {
        throw new Error("GLS widget nie je dostupný.");
      }

      root.innerHTML = "";

      const zip = getWidgetZip();
      const isMobileGlsWidget = window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
      const options = {
        lang: "sk",
        renderTo: "#gls-widget-root",
        find: 1,
        noHeader: isMobileGlsWidget ? 1 : 0,
        ctrCode: "SK",
      };

      if (zip) {
        options.location = zip;
      }

      window.GlsWidget.open((point) => {
        const normalized = normalizeGlsPickup(point);
        if (!normalized.pickup_id) return;

        selectedGlsPickup = normalized;
        const input = document.querySelector("#GLSPickupPointResult");
        if (input) input.value = normalized.raw_result || normalized.pickup_id;
        savePickupState();
        renderPickupSummary();

        if (window.GlsWidget && typeof window.GlsWidget.close === "function") {
          window.GlsWidget.close();
        }

        closeGlsWidget();
      }, options);
    } catch (error) {
      root.innerHTML = `
        <div class="gls-widget-error">
          <strong>GLS mapu sa nepodarilo načítať.</strong>
          <p>${error.message || "Skúste to znova alebo zvoľte kuriéra na adresu."}</p>
        </div>
      `;
    }
  }

  function closeGlsWidget() {
    const modal = document.querySelector("[data-gls-modal]");
    const root = document.querySelector("#gls-widget-root");

    try {
      if (window.GlsWidget && typeof window.GlsWidget.close === "function") {
        window.GlsWidget.close();
      }
    } catch {
      // noop
    }

    if (modal) modal.hidden = true;
    if (root) root.innerHTML = "";
    document.body.classList.remove("has-gls-modal");
  }

  function setupPickupWidgets() {
    document.querySelector("[data-open-pickup-widget]")?.addEventListener("click", openPickupWidget);

    document.querySelector("[data-close-dpd-widget]")?.addEventListener("click", closeDpdWidget);
    document.querySelector("[data-dpd-modal]")?.addEventListener("click", (event) => {
      if (event.target.matches("[data-dpd-modal]")) closeDpdWidget();
    });

    document.querySelector("[data-close-gls-widget]")?.addEventListener("click", closeGlsWidget);
    document.querySelector("[data-gls-modal]")?.addEventListener("click", (event) => {
      if (event.target.matches("[data-gls-modal]")) closeGlsWidget();
    });

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || !data.dpdWidget) return;

      if (data.dpdWidget.message === "widgetClose") {
        closeDpdWidget();
        return;
      }

      const normalized = normalizeDpdPickup(data.dpdWidget);
      if (!normalized.pickup_id && !normalized.raw_result) return;

      selectedDpdPickup = normalized;
      const input = document.querySelector("#DPDPickupPointResult");
      if (input) input.value = normalized.raw_result || normalized.pickup_id;
      savePickupState();
      renderPickupSummary();
      closeDpdWidget();
    }, false);

    renderPickupSummary();
  }

  async function submitOrder() {
    const status = document.querySelector("[data-order-status]");
    const submitButton = document.querySelector("[data-submit-order]");

    renderCheckoutSummary();

    const cart = readCart();

    if (cart.length === 0) {
      status.textContent = "Košík je prázdny. Vráťte sa späť do košíka.";
      status.className = "order-status is-error";
      return;
    }

    if (!validateCheckout()) {
      status.textContent = "Skontrolujte zvýraznené povinné údaje.";
      status.className = "order-status is-error";
      return;
    }

    const orderPreview = {
      cart,
      pricing: cartPricing(cart),
      contact: {
        email: document.querySelector("#email").value,
        phone: document.querySelector("#phone").value,
      },
      billing: {
        companyEnabled: document.querySelector("#company_enabled")?.checked || false,
        ico: document.querySelector('[name="ico"]')?.value || "",
        dic: document.querySelector('[name="dic"]')?.value || "",
        icDph: document.querySelector('[name="icdph"]')?.value || "",
        company: document.querySelector('[name="company"]')?.value || "",
        firstName: document.querySelector('[name="first_name"]')?.value || "",
        lastName: document.querySelector('[name="last_name"]')?.value || "",
        address: document.querySelector('[name="address"]')?.value || "",
        city: document.querySelector('[name="city"]')?.value || "",
        zip: document.querySelector('[name="zip"]')?.value || "",
      },
      delivery: {
        differentAddress: document.querySelector("#different_address")?.checked || false,
        firstName: document.querySelector('[name="delivery_first_name"]')?.value || "",
        lastName: document.querySelector('[name="delivery_last_name"]')?.value || "",
        email: document.querySelector('[name="delivery_email"]')?.value || "",
        phone: document.querySelector('[name="delivery_phone"]')?.value || "",
        street: document.querySelector('[name="delivery_street"]')?.value || "",
        city: document.querySelector('[name="delivery_city"]')?.value || "",
        zip: document.querySelector('[name="delivery_zip"]')?.value || "",
      },
      shipping: {
        method: getSelected("shipping"),
        ...(SHIPPING[getSelected("shipping")] || SHIPPING.dpd_courier),
        pickup: getSelectedPickup(),
      },
      payment: getSelected("payment"),
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem("tm_last_order_preview", JSON.stringify(orderPreview));

    if (orderPreview.payment === "cod") {
      status.textContent = "Dobierková objednávka je pripravená. Ostré uloženie objednávky pridáme v ďalšom kroku.";
      status.className = "order-status is-success";
      return;
    }

    try {
      submitButton.disabled = true;
      status.textContent = "Vytváram GoPay platbu...";
      status.className = "order-status";

      const response = await fetch("/api/gopay-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderPreview),
      });

      const data = await response.json();

      if (!response.ok || !data.ok || !data.gwUrl) {
        throw new Error(data.error || "Nepodarilo sa vytvoriť GoPay platbu.");
      }

      status.textContent = "Presmerujem vás na GoPay...";
      status.className = "order-status is-success";

      window.location.href = data.gwUrl;
    } catch (error) {
      status.textContent = error.message || "Nepodarilo sa vytvoriť GoPay platbu.";
      status.className = "order-status is-error";
      submitButton.disabled = false;
    }
  }



  function isCheckoutMobileLayout() {
    return window.matchMedia("(max-width: 920px), (hover: none) and (pointer: coarse)").matches;
  }

  function openCheckoutStep(stepName, shouldScroll = true) {
    const steps = Array.from(document.querySelectorAll("[data-checkout-step]"));
    if (!steps.length) return;

    const target = steps.find((step) => step.dataset.checkoutStep === stepName) || steps[0];
    steps.forEach((step) => step.classList.toggle("is-active", step === target));

    if (stepName === "summary") {
      const summary = document.querySelector(".checkout-summary");
      const toggle = document.querySelector("[data-mobile-summary-toggle]");
      summary?.classList.add("is-open");
      toggle?.setAttribute("aria-expanded", "true");
      if (shouldScroll) summary?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (shouldScroll) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setupMobileCheckoutSteps() {
    const steps = Array.from(document.querySelectorAll("[data-checkout-step]"));
    if (!steps.length) return;

    if (!steps.some((step) => step.classList.contains("is-active"))) {
      steps[0].classList.add("is-active");
    }

    document.querySelectorAll("[data-checkout-step-head]").forEach((head) => {
      head.addEventListener("click", () => {
        if (!isCheckoutMobileLayout()) return;
        const step = head.closest("[data-checkout-step]");
        if (!step) return;
        openCheckoutStep(step.dataset.checkoutStep, false);
      });
    });

    document.querySelectorAll("[data-checkout-next]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!isCheckoutMobileLayout()) return;
        openCheckoutStep(button.dataset.checkoutNext || "contact", true);
      });
    });

  }

  document.addEventListener("DOMContentLoaded", () => {
    restorePickupState();
    renderCheckoutSummary();
    updateVisibility();
    setupPostalAutofill();
    setupPickupWidgets();
    setupMobileCheckoutSteps();

    document.querySelectorAll('input[name="shipping"], input[name="payment"], #company_enabled, #different_address').forEach((input) => {
      input.addEventListener("change", () => {
        updateVisibility();
        renderCheckoutSummary();
      });
    });

    document.querySelectorAll("[data-checkout-form] input").forEach((input) => {
      input.addEventListener("blur", () => validateField(input));
      input.addEventListener("input", () => {
        if (input.classList.contains("is-invalid")) validateField(input);
      });
    });

    document.querySelector("[data-mobile-summary-toggle]")?.addEventListener("click", (event) => {
      const summary = event.currentTarget.closest(".checkout-summary");
      const open = !summary?.classList.contains("is-open");
      summary?.classList.toggle("is-open", open);
      event.currentTarget.setAttribute("aria-expanded", String(open));
    });

    document.querySelector("[data-load-company]")?.addEventListener("click", loadCompanyByIco);
    document.querySelector("[data-submit-order]")?.addEventListener("click", submitOrder);
    document.querySelector("[data-mobile-submit-order]")?.addEventListener("click", submitOrder);
  });
})();
