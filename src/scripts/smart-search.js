(() => {
  if (window.__TM_SMART_SEARCH_MODULE_READY__) {
    window.tmInitSmartSearch?.();
    return;
  }
  window.__TM_SMART_SEARCH_MODULE_READY__ = true;

  const CACHE_KEY = "tm_smart_search_v8";
  const CACHE_TTL = 20 * 60 * 1000;
  // Nášepkávač štartuje od 3 znakov. Krátky debounce iba zlučuje veľmi rýchle
  // údery klávesov; používateľ nemá čakať stovky ms pred samotným requestom.
  const MIN_QUERY_LENGTH = 3;
  const DEBOUNCE_MS = 55;

  const memory = new Map();
  let warmupStarted = false;

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
    return "📂";
  }

  function sectionTitle(section) {
    if (section === "printers") return "Tlačiarne";
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

  function itemTemplate(item, section, query) {
    const type = item.type || "";
    const image = item.image
      ? `<span class="tm-smart-thumb"><img src="${esc(item.image)}" alt="" loading="lazy"></span>`
      : `<span class="tm-smart-thumb tm-smart-thumb--icon">${iconFor(section)}</span>`;

    const price = item.price ? `<strong>${new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(Number(item.price || 0))}</strong>` : "";
    const typeBadge = section === "products" && type ? `<em class="tm-smart-type tm-smart-type--${esc(type)}">${typeLabel(type)}</em>` : "";

    return `
      <a class="tm-smart-item ${type ? `tm-smart-item--${esc(type)}` : ""}" href="${esc(item.url || "/produkty?s=" + encodeURIComponent(query))}" data-smart-result="${esc(section)}">
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

    const body = items.map((item) => itemTemplate(item, section, query)).join("");

    return `
      <section class="tm-smart-section tm-smart-section--${section}">
        <h3>${sectionTitle(section)}</h3>
        <div>${body}</div>
      </section>
    `;
  }

  function renderTypeFilters(groups) {
    if (!Array.isArray(groups) || !groups.length) return "";
    const filters = groups
      .filter((item) => ["compatible", "original", "renovated"].includes(item.type))
      .map((item) => `<a class="tm-smart-filter tm-smart-filter--${esc(item.type)}" href="${esc(item.url)}">${esc(typeLabel(item.type))} <b>${esc(item.count || "")}</b></a>`)
      .join("");
    return filters ? `<nav class="tm-smart-filters" aria-label="Filtrovať nájdené produkty podľa typu">${filters}</nav>` : "";
  }

  function renderPanel(panel, data, query) {
    const productCount = Array.isArray(data?.productGroups)
      ? data.productGroups.reduce((sum, item) => sum + Number(item.count || 0), 0)
      : Number(data?.products?.length || 0);
    const html = [
      renderSection("printers", data?.printers?.slice(0, 5), query),
      renderTypeFilters(data?.productGroups),
      renderSection("products", data?.products?.slice(0, 6), query),
      productCount > 6 ? `<a class="tm-smart-all" href="/produkty?s=${encodeURIComponent(query)}">Zobraziť všetkých ${productCount} produktov <span>›</span></a>` : "",
    ].join("");

    const alternative = data?.didYouMean
      ? `<div class="tm-smart-empty tm-smart-empty--alternative"><strong>Možno ste mysleli:</strong><a class="tm-smart-didyoumean" href="${esc(data.didYouMean.url)}">${esc(data.didYouMean.label)}</a></div>`
      : "";

    panel.innerHTML = html || alternative || `
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

  async function fetchSuggestions(query, signal, retry = true) {
    const cached = sessionRead(query);
    if (cached) return cached;

    try {
      const response = await fetch(`/api/smart-search?q=${encodeURIComponent(query)}`, {
        headers: { Accept: "application/json" },
        signal,
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("Neplatná odpoveď vyhľadávania.");
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Vyhľadávanie zlyhalo.");
      sessionWrite(query, data);
      return data;
    } catch (error) {
      // Jednorazové opakovanie pomôže pri krátkom prepnutí/reštarte proxy.
      // Abort z nového používateľského dotazu sa nikdy neopakuje.
      if (!retry || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 180));
      return fetchSuggestions(query, signal, false);
    }
  }

  function warmupSearch() {
    if (warmupStarted) return;
    warmupStarted = true;
    const start = () => {
      fetch('/api/smart-search?q=__tm_warm__', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        priority: 'low',
      }).catch(() => {});
    };
    // Index začni zohrievať okamžite. requestIdleCallback vedel warmup odložiť
    // až o 800 ms, takže prvý používateľský dotaz mohol predbehnúť index.
    start();
  }

  function goToSearch(input) {
    const query = input.value.trim();
    if (!query) return;

    // Formulár vždy prejde cez serverovú routu. Presný model tlačiarne sa tam
    // presmeruje na kanonickú stránku /tlaciarne/značka/model s popisom.
    // Obyčajný produktový dotaz zostane na /produkty.
    window.location.href = `/produkty?s=${encodeURIComponent(query)}`;
  }

  function installSmartSearch(form) {
    const input = form.querySelector("input[type='search'], input[type='text'], [data-smart-search-input]");
    if (!input || input.dataset.smartSearchReady === "1") return;

    input.dataset.smartSearchReady = "1";
    form.dataset.smartSearch = "true";

    const { panel } = prepareWrapper(form, input);
    let timer = null;
    let loadingTimer = null;
    let controller = null;
    let serial = 0;

    const cancelPending = () => {
      serial += 1;
      if (timer) clearTimeout(timer);
      if (loadingTimer) clearTimeout(loadingTimer);
      timer = null;
      loadingTimer = null;
      if (controller) controller.abort();
      controller = null;
    };

    const hidePanel = () => {
      panel.hidden = true;
      panel.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
    };

    const schedule = () => {
      cancelPending();
      const query = input.value.trim();
      const mySerial = serial;

      if (query.length < MIN_QUERY_LENGTH) {
        hidePanel();
        return;
      }

      input.setAttribute("aria-expanded", "true");
      const cached = sessionRead(query);
      if (cached) {
        renderPanel(panel, cached, query);
        return;
      }

      // Panel sa otvorí hneď, ale spinner ukážeme až keď odpoveď naozaj trvá.
      // Pri bežnom rýchlom requeste tak UI nebliká stavom „Hľadám“.
      panel.hidden = false;
      loadingTimer = setTimeout(() => {
        if (mySerial === serial && input.value.trim() === query) setLoading(panel, query);
      }, 120);

      timer = setTimeout(async () => {
        if (mySerial !== serial || input.value.trim() !== query) return;
        controller = new AbortController();
        const requestController = controller;
        // Cold-start indexu nesmie na mobilnej sieti skončiť skôr, než server
        // stihne odpovedať. Warm odpovede zostávajú bežne pod stovkami ms.
        const timeout = setTimeout(() => requestController.abort(), 4000);

        try {
          const data = await fetchSuggestions(query, requestController.signal);
          if (mySerial !== serial || input.value.trim() !== query) return;
          if (loadingTimer) clearTimeout(loadingTimer);
          loadingTimer = null;
          renderPanel(panel, data, query);
        } catch (error) {
          if (mySerial !== serial || input.value.trim() !== query) return;
          if (loadingTimer) clearTimeout(loadingTimer);
          loadingTimer = null;
          if (error?.name === "AbortError") {
            // Timeout alebo nový dotaz nikdy nesmie nechať UI visieť.
            panel.innerHTML = `<div class="tm-smart-empty"><strong>Pokračujte Enterom.</strong><span>Otvoríme kompletné výsledky pre „${esc(query)}“.</span></div>`;
          } else panel.innerHTML = `<div class="tm-smart-empty"><strong>Pokračujte Enterom.</strong><span>Otvoríme kompletné výsledky pre „${esc(query)}“.</span></div>`;
          panel.hidden = false;
        } finally {
          clearTimeout(timeout);
          if (controller === requestController) controller = null;
        }
      }, DEBOUNCE_MS);
    };

    input.addEventListener("input", schedule);
    input.addEventListener("focus", () => {
      const query = input.value.trim();
      if (query.length < MIN_QUERY_LENGTH) return;
      const cached = sessionRead(query);
      if (cached) renderPanel(panel, cached, query);
      else schedule();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        cancelPending();
        hidePanel();
      }
    });

    if (!form.matches("[data-catalog-form]")) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        cancelPending();
        hidePanel();
        goToSearch(input);
      });
    }

    panel.addEventListener("mousedown", (event) => {
      const link = event.target.closest("a");
      if (!link) return;
      if (link.dataset.smartResult === "products") {
        const title = link.querySelector(".tm-smart-copy > span")?.textContent || "";
        try {
          sessionStorage.setItem("tm_last_product_click", JSON.stringify({ title, time: Date.now() }));
        } catch {}
      }
    });

    document.addEventListener("click", (event) => {
      if (form.parentElement?.contains(event.target)) return;
      cancelPending();
      hidePanel();
    });
  }

  function init() {
    document.querySelectorAll("form.search, form.catalog-search, [data-smart-search]").forEach(installSmartSearch);
    warmupSearch();
  }

  window.tmInitSmartSearch = init;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})();
