(() => {
  if (window.__TM_SMART_SEARCH_MODULE_READY__) {
    window.tmInitSmartSearch?.();
    return;
  }
  window.__TM_SMART_SEARCH_MODULE_READY__ = true;

  const CACHE_KEY = "tm_smart_search_v3";
  const CACHE_TTL = 20 * 60 * 1000;
  const MIN_QUERY_LENGTH = 2;
  const DEBOUNCE_MS = 180;

  const memory = new Map();
  const inflight = new Map();
  let activeController = null;
  let runSerial = 0;

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function compact(value) {
    return normalize(value).replace(/[^a-z0-9]/g, "");
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));
  }

  function cacheKey(query) {
    return compact(query) || normalize(query);
  }

  function sessionRead(query) {
    const key = cacheKey(query);
    if (memory.has(key)) return memory.get(key);

    try {
      const all = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}");
      const item = all[key];
      if (!item || !item.time || !item.data) return null;
      if (Date.now() - item.time > CACHE_TTL) return null;
      memory.set(key, item.data);
      return item.data;
    } catch {
      return null;
    }
  }

  function sessionWrite(query, data) {
    const key = cacheKey(query);
    memory.set(key, data);

    try {
      const all = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}");
      all[key] = { time: Date.now(), data };
      const keys = Object.keys(all);
      if (keys.length > 60) {
        keys
          .sort((a, b) => Number(all[a]?.time || 0) - Number(all[b]?.time || 0))
          .slice(0, keys.length - 60)
          .forEach((oldKey) => delete all[oldKey]);
      }
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch {
      // funguje aj bez sessionStorage
    }
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function highlight(text, query) {
    const source = String(text || "");
    const q = String(query || "").trim();
    if (!q) return esc(source);

    const compactQuery = compact(q);
    if (!compactQuery) return esc(source);

    const map = [];
    let compactSource = "";

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const normalized = normalize(char).replace(/[^a-z0-9]/g, "");
      if (!normalized) continue;
      compactSource += normalized;
      map.push(index);
    }

    const found = compactSource.indexOf(compactQuery);
    if (found === -1) return esc(source);

    const start = map[found];
    const end = map[found + compactQuery.length - 1] + 1;

    return `${esc(source.slice(0, start))}<mark>${esc(source.slice(start, end))}</mark>${esc(source.slice(end))}`;
  }

  function iconFor(section) {
    if (section === "printers") return "🖨️";
    if (section === "products") return "🧾";
    if (section === "brands") return "🏷️";
    if (section === "productGroups") return "📦";
    return "📂";
  }

  function sectionTitle(section) {
    if (section === "printers") return "Tlačiarne";
    if (section === "productGroups") return "Nájdené typy produktov";
    if (section === "products") return "Produkty";
    if (section === "brands") return "Značky";
    return "Kategórie";
  }

  function typeLabel(type) {
    if (type === "compatible") return "Kompatibilný";
    if (type === "original") return "Originál";
    if (type === "renovated") return "Renovovaný";
    return "Produkt";
  }

  function prepareWrapper(form, input) {
    let wrapper = form.closest(".tm-smart-search-wrap");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.className = "tm-smart-search-wrap";
      form.parentNode.insertBefore(wrapper, form);
      wrapper.appendChild(form);
    }

    if (form.closest(".hero, .hero-shell")) {
      wrapper.classList.add("tm-smart-search-wrap--hero");
    }

    let panel = wrapper.querySelector(".tm-smart-search-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "tm-smart-search-panel";
      panel.hidden = true;
      panel.setAttribute("role", "listbox");
      wrapper.appendChild(panel);
    }

    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");

    return { wrapper, panel };
  }

  function productGroupTemplate(item, query) {
    const type = item.type || "product";
    return `
      <a class="tm-smart-group tm-smart-group--${esc(type)}" href="${esc(item.url || "/novy/produkty?s=" + encodeURIComponent(query))}" data-smart-result="productGroups">
        <span class="tm-smart-group-dot"></span>
        <span>
          <strong>${highlight(item.title || "", query)}</strong>
          ${item.subtitle ? `<small>${esc(item.subtitle)}</small>` : ""}
        </span>
        <b>Zobraziť</b>
      </a>
    `;
  }

  function itemTemplate(item, section, query) {
    const type = item.type || "";
    const image = item.image
      ? `<span class="tm-smart-thumb"><img src="${esc(item.image)}" alt="" loading="lazy"></span>`
      : `<span class="tm-smart-thumb tm-smart-thumb--icon">${iconFor(section)}</span>`;

    const price = item.price ? `<strong>${new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(Number(item.price || 0))}</strong>` : "";
    const typeBadge = section === "products" && type ? `<em class="tm-smart-type tm-smart-type--${esc(type)}">${typeLabel(type)}</em>` : "";

    return `
      <a class="tm-smart-item ${type ? `tm-smart-item--${esc(type)}` : ""}" href="${esc(item.url || "/novy/produkty?s=" + encodeURIComponent(query))}" data-smart-result="${esc(section)}">
        ${image}
        <span class="tm-smart-copy">
          <span>${highlight(item.title || "", query)}</span>
          ${item.subtitle ? `<small>${highlight(item.subtitle, query)}</small>` : ""}
        </span>
        <span class="tm-smart-side">
          ${typeBadge}
          ${price ? `<span class="tm-smart-price">${price}</span>` : `<span class="tm-smart-arrow">›</span>`}
        </span>
      </a>
    `;
  }

  function renderSection(section, items, query) {
    if (!Array.isArray(items) || !items.length) return "";

    const body = section === "productGroups"
      ? items.map((item) => productGroupTemplate(item, query)).join("")
      : items.map((item) => itemTemplate(item, section, query)).join("");

    return `
      <section class="tm-smart-section tm-smart-section--${section}">
        <h3>${sectionTitle(section)}</h3>
        <div>${body}</div>
      </section>
    `;
  }

  function renderPanel(panel, data, query) {
    const html = [
      renderSection("printers", data?.printers, query),
      renderSection("productGroups", data?.productGroups, query),
      renderSection("products", data?.products, query),
      renderSection("brands", data?.brands, query),
      renderSection("categories", data?.categories, query),
    ].join("");

    panel.innerHTML = html || `
      <div class="tm-smart-empty">
        <strong>Nič sme nenašli.</strong>
        <span>Skúste zadať model tlačiarne, značku alebo kód toneru.</span>
      </div>
    `;

    panel.hidden = false;
  }

  function setLoading(panel, query) {
    panel.innerHTML = `
      <div class="tm-smart-loading">
        <span></span>
        Hľadám „${esc(query)}“...
      </div>
    `;
    panel.hidden = false;
  }

  async function fetchSuggestions(query) {
    const cached = sessionRead(query);
    if (cached) return cached;

    const key = cacheKey(query);
    if (inflight.has(key)) return inflight.get(key);

    if (activeController) activeController.abort();
    activeController = new AbortController();

    const promise = fetch(`/novy/api/smart-search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
      signal: activeController.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Vyhľadávanie zlyhalo.");
        sessionWrite(query, data);
        return data;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
  }

  function goToSearch(input) {
    const query = input.value.trim();
    if (!query) return;
    window.location.href = `/novy/produkty?s=${encodeURIComponent(query)}`;
  }

  function installSmartSearch(form) {
    const input = form.querySelector("input[type='search'], input[type='text'], [data-smart-search-input]");
    if (!input || input.dataset.smartSearchReady === "1") return;

    input.dataset.smartSearchReady = "1";
    form.dataset.smartSearch = "true";

    const { panel } = prepareWrapper(form, input);

    const run = debounce(async () => {
      const query = input.value.trim();
      const serial = ++runSerial;
      input.setAttribute("aria-expanded", query.length >= MIN_QUERY_LENGTH ? "true" : "false");

      if (query.length < MIN_QUERY_LENGTH) {
        panel.hidden = true;
        panel.innerHTML = "";
        return;
      }

      const cached = sessionRead(query);
      if (cached) {
        renderPanel(panel, cached, query);
        return;
      }

      setLoading(panel, query);

      try {
        const data = await fetchSuggestions(query);
        if (serial !== runSerial || input.value.trim() !== query) return;
        renderPanel(panel, data, query);
      } catch (error) {
        if (error?.name === "AbortError") return;
        panel.innerHTML = `<div class="tm-smart-empty"><strong>Vyhľadávanie sa nepodarilo.</strong><span>Stlačte Enter a otvorí sa klasický výpis.</span></div>`;
        panel.hidden = false;
      }
    }, DEBOUNCE_MS);

    input.addEventListener("input", run);
    input.addEventListener("focus", () => {
      if (input.value.trim().length >= MIN_QUERY_LENGTH) run();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        panel.hidden = true;
        input.setAttribute("aria-expanded", "false");
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      goToSearch(input);
    });

    panel.addEventListener("mousedown", (event) => {
      const link = event.target.closest("a");
      if (!link) return;

      if (link.dataset.smartResult === "products") {
        const title = link.querySelector(".tm-smart-copy > span")?.textContent || "";
        try {
          sessionStorage.setItem("tm_last_product_click", JSON.stringify({ title, time: Date.now() }));
        } catch {
          // ignore
        }
      }
    });

    document.addEventListener("click", (event) => {
      if (form.parentElement?.contains(event.target)) return;
      panel.hidden = true;
      input.setAttribute("aria-expanded", "false");
    });
  }

  function init() {
    document.querySelectorAll("form.search, form.catalog-search, [data-smart-search]").forEach(installSmartSearch);
  }

  window.tmInitSmartSearch = init;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
