(() => {
  const roots = Array.from(document.querySelectorAll("[data-printer-finder]"));
  if (!roots.length) return;

  const brandModal = document.querySelector("[data-brand-modal]");
  const brandGrid = document.querySelector("[data-brand-grid]");
  let globalBrands = [];

  const popularByBrand = {
    Epson: [
      "Epson EcoTank L3251",
      "Epson EcoTank L3151",
      "Epson EcoTank L3110",
      "Epson EcoTank L3101",
      "Epson EcoTank L3260",
      "Epson EcoTank L1210",
      "Epson EcoTank L3250",
      "Epson EcoTank L5190",
      "Epson EcoTank L5290",
      "Epson Stylus SX425W",
      "Epson Stylus S20",
      "Epson Stylus SX100",
    ],
    HP: [
      "HP LaserJet M110w",
      "HP LaserJet Pro M404dn",
      "HP LaserJet Pro MFP M428fdw",
      "HP LaserJet P1102",
      "HP LaserJet Pro M15w",
      "HP LaserJet Pro MFP M28w",
      "HP LaserJet Pro M203dn",
      "HP Color LaserJet Pro 3202DN",
      "HP Color LaserJet Pro 3202DW",
      "HP Color LaserJet Pro M254dw",
      "HP Color LaserJet Pro M254nw",
      "HP Color LaserJet Pro M255DW",
    ],
    Brother: [
      "Brother DCP-L2532DW",
      "Brother DCP-L2512D",
      "Brother HL-L2372DN",
      "Brother MFC-L2712DN",
      "Brother MFC-L2732DW",
      "Brother DCP-T500W",
      "Brother DCP-T510W",
      "Brother DCP-J4110DW",
      "Brother MFC-J4410DW",
      "Brother MFC-J4510DW",
      "Brother MFC-J4610DW",
      "Brother MFC-J4710DW",
    ],
    Canon: [
      "Canon i-SENSYS MF655Cdw",
      "Canon i-SENSYS LBP223dw",
      "Canon i-SENSYS MF643Cdw",
      "Canon i-SENSYS MF645Cx",
      "Canon i-SENSYS MF752Cdw",
      "Canon PIXMA MG3650",
      "Canon PIXMA TS3350",
      "Canon imagePROGRAF TM-200",
      "Canon PIXMA TS3150",
      "Canon PIXMA TS5150",
      "Canon PIXMA G3411",
      "Canon PIXMA MX495",
      "Canon imagePROGRAF iPF8300",
    ],
  };

  const normalize = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const compactKey = (value) => normalize(value).replace(/[^a-z0-9]/g, "");

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function productWord(countValue) {
    const n = Number(countValue || 0);
    if (n === 1) return "produkt";
    if (n > 1 && n < 5) return "produkty";
    return "produktov";
  }

  function printerUrl(title) {
    return `/novy/produkty?printer=${encodeURIComponent(title)}`;
  }

  const printerImages = {
    [compactKey("Epson EcoTank L3251")]: "/novy/printer-images/epson/l3251.webp",
    [compactKey("Epson EcoTank L3151")]: "/novy/printer-images/epson/l3151.webp",
    [compactKey("Epson EcoTank L3110")]: "/novy/printer-images/epson/l3110.webp",
    [compactKey("Epson EcoTank L3101")]: "/novy/printer-images/epson/l3101.webp",
    [compactKey("Epson EcoTank L3260")]: "/novy/printer-images/epson/l3260.webp",
    [compactKey("Epson EcoTank L1210")]: "/novy/printer-images/epson/l1210.webp",
    [compactKey("Epson EcoTank L3250")]: "/novy/printer-images/epson/l3250.webp",
    [compactKey("Epson EcoTank L5190")]: "/novy/printer-images/epson/l5190.webp",
    [compactKey("Epson EcoTank L5290")]: "/novy/printer-images/epson/l5290.webp",
    [compactKey("Epson Stylus SX425W")]: "/novy/printer-images/epson/sx425w.webp",
    [compactKey("Epson Stylus S20")]: "/novy/printer-images/epson/s20.webp",
    [compactKey("Epson Stylus SX100")]: "/novy/printer-images/epson/sx100.webp",

    [compactKey("HP LaserJet M110w")]: "/novy/printer-images/hp/m110w.webp",
    [compactKey("HP LaserJet Pro M404dn")]: "/novy/printer-images/hp/m404dn.webp",
    [compactKey("HP LaserJet Pro MFP M428fdw")]: "/novy/printer-images/hp/m428fdw.webp",
    [compactKey("HP LaserJet Pro MFP M140w")]: "/novy/printer-images/hp/m140w.webp",
    [compactKey("HP LaserJet P1102")]: "/novy/printer-images/hp/p1102.webp",
    [compactKey("HP LaserJet Pro M15w")]: "/novy/printer-images/hp/m15w.webp",
    [compactKey("HP LaserJet Pro MFP M28w")]: "/novy/printer-images/hp/m28w.webp",
    [compactKey("HP LaserJet Pro M203dn")]: "/novy/printer-images/hp/m203dn.webp",
    [compactKey("HP Color LaserJet Pro 3202DN")]: "/novy/printer-images/hp/color-3202dn.webp",
    [compactKey("HP Color LaserJet Pro 3202DW")]: "/novy/printer-images/hp/color-3202dw.webp",
    [compactKey("HP Color LaserJet Pro M254dw")]: "/novy/printer-images/hp/m254dw.webp",
    [compactKey("HP Color LaserJet Pro M254nw")]: "/novy/printer-images/hp/m254nw.webp",
    [compactKey("HP Color LaserJet Pro M255DW")]: "/novy/printer-images/hp/m255dw.webp",

    [compactKey("Canon i-SENSYS MF655Cdw")]: "/novy/printer-images/canon/mf655cdw.webp",
    [compactKey("Canon i-SENSYS LBP223dw")]: "/novy/printer-images/canon/lbp223dw.webp",
    [compactKey("Canon i-SENSYS MF643Cdw")]: "/novy/printer-images/canon/mf643cdw.webp",
    [compactKey("Canon i-SENSYS MF645Cx")]: "/novy/printer-images/canon/mf645cx.webp",
    [compactKey("Canon i-SENSYS MF752Cdw")]: "/novy/printer-images/canon/mf752cdw.webp",
    [compactKey("Canon PIXMA MG3650")]: "/novy/printer-images/canon/mg3650.webp",
    [compactKey("Canon PIXMA TS3350")]: "/novy/printer-images/canon/ts3350.webp",
    [compactKey("Canon imagePROGRAF TM-200")]: "/novy/printer-images/canon/imageprograf.webp",
    [compactKey("Canon PIXMA TS3150")]: "/novy/printer-images/canon/ts3150.webp",
    [compactKey("Canon PIXMA TS5150")]: "/novy/printer-images/canon/ts5150.webp",
    [compactKey("Canon PIXMA G3411")]: "/novy/printer-images/canon/pixma-g3411.webp",
    [compactKey("Canon PIXMA MX495")]: "/novy/printer-images/canon/pixma-mx495.webp",
    [compactKey("Canon imagePROGRAF iPF8300")]: "/novy/printer-images/canon/ipf8300.webp",

    [compactKey("Brother DCP-L2532DW")]: "/novy/printer-images/brother/dcp-l2532dw.webp",
    [compactKey("Brother DCP-L2512D")]: "/novy/printer-images/brother/dcp-l2512d.webp",
    [compactKey("Brother HL-L2372DN")]: "/novy/printer-images/brother/hl-l2372dn.webp",
    [compactKey("Brother MFC-L2712DN")]: "/novy/printer-images/brother/mfc-l2712dn.webp",
    [compactKey("Brother MFC-L2732DW")]: "/novy/printer-images/brother/mfc-l2732dw.webp",
    [compactKey("Brother DCP-T500W")]: "/novy/printer-images/brother/dcp-t500w.webp",
    [compactKey("Brother DCP-T510W")]: "/novy/printer-images/brother/dcp-t510w.webp",
    [compactKey("Brother DCP-J4110DW")]: "/novy/printer-images/brother/dcp-j4110dw.webp",
    [compactKey("Brother MFC-J4410DW")]: "/novy/printer-images/brother/mfc-j4410dw.webp",
    [compactKey("Brother MFC-J4510DW")]: "/novy/printer-images/brother/mfc-j4510dw.webp",
    [compactKey("Brother MFC-J4610DW")]: "/novy/printer-images/brother/mfc-j4610dw.webp",
    [compactKey("Brother MFC-J4710DW")]: "/novy/printer-images/brother/mfc-j4710dw.webp",
  };

  function printerImage(title) {
    return printerImages[compactKey(title)] || "";
  }

  function mobilePrinterTitle(title, brand) {
    const source = String(title || "").trim();
    const currentBrand = String(brand || "").trim();
    if (!source || !currentBrand) return source;
    const sourceKey = normalize(source);
    const brandKey = normalize(currentBrand);
    if (sourceKey === brandKey) return source;
    if (!sourceKey.startsWith(`${brandKey} `)) return source;
    return source.slice(currentBrand.length).trim();
  }

  function renderGlobalBrands() {
    if (!brandGrid || !globalBrands.length) return;
    brandGrid.innerHTML = globalBrands.map((item) => `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>`).join("");
  }

  function initPrinterFinder(root) {
    const brand = root.dataset.brand || "";
    const input = root.querySelector("[data-printer-input]");
    const clearButton = root.querySelector("[data-clear-printer]");
    const submitButton = root.querySelector("[data-printer-submit]");
    const suggestions = root.querySelector("[data-printer-suggestions]");
    const status = root.querySelector("[data-printer-status]");
    const popularGrid = root.querySelector("[data-printer-popular-grid]");
    const count = root.querySelector("[data-printer-count]");

    let printers = [];
    let selectedPrinter = "";

    function setSelectedPrinter(title) {
      selectedPrinter = title || "";
      if (input) input.value = selectedPrinter;
      if (clearButton) clearButton.hidden = !selectedPrinter;
      if (submitButton) submitButton.disabled = !selectedPrinter;
      if (suggestions) suggestions.hidden = true;
    }

    function filterPrinters(query) {
      const q = normalize(query);
      const qc = compactKey(query);
      if (!q) return printers;
      return printers.filter((printer) => {
        const title = printer.title || "";
        return normalize(title).includes(q) || compactKey(title).includes(qc) || q.split(/\s+/).every((part) => normalize(title).includes(part));
      });
    }

    function renderSuggestionList(items) {
      if (!suggestions) return;
      if (!items.length) {
        suggestions.innerHTML = `<div class="printer-empty">Nenašli sme model. Skúste zadať kratší názov alebo inú časť názvu.</div>`;
        suggestions.hidden = false;
        return;
      }

      suggestions.innerHTML = items.slice(0, 80).map((printer) => `
        <button type="button" data-printer-choice="${escapeHtml(printer.title)}">
          <strong>${escapeHtml(printer.title)}</strong>
          <span>${Number(printer.product_count || 0)} ${productWord(printer.product_count)}</span>
        </button>
      `).join("");
      suggestions.hidden = false;
    }

    function renderPopularGrid() {
      if (!popularGrid) return;

      const used = new Set();
      const preferred = popularByBrand[brand] || [];
      const preferredItems = preferred
        .map((title) => printers.find((printer) => compactKey(printer.title) === compactKey(title)))
        .filter(Boolean);

      const fallbackItems = [...printers]
        .sort((a, b) => Number(b.product_count || 0) - Number(a.product_count || 0))
        .filter((printer) => !preferredItems.some((item) => compactKey(item.title) === compactKey(printer.title)));

      const items = [...preferredItems, ...fallbackItems]
        .filter((printer) => {
          const key = compactKey(printer.title);
          if (used.has(key)) return false;
          used.add(key);
          return true;
        })
        .slice(0, 12);

      const isMobileRoot = root.classList.contains("tm-printer-mobile");

      popularGrid.innerHTML = items.map((printer) => {
        const image = printerImage(printer.title);
        const title = isMobileRoot ? mobilePrinterTitle(printer.title, brand) : printer.title;
        const hasImageClass = image ? " has-printer-image" : "";
        return `
          <a href="${printerUrl(printer.title)}" class="printer-popular-card${hasImageClass}">
            ${image ? `
              <span class="printer-popular-image" aria-hidden="true">
                <img src="${image}" alt="" loading="lazy" decoding="async">
              </span>
            ` : ""}
            <span class="printer-popular-content">
              <span class="printer-popular-title">${escapeHtml(title)}</span>
              <span class="printer-popular-meta">${Number(printer.product_count || 0)} ${productWord(printer.product_count)}</span>
              <strong>Zobraziť náplne →</strong>
            </span>
          </a>
        `;
      }).join("");
    }

    async function loadPrinters() {
      try {
        const response = await fetch(`/novy/api/printers?brand=${encodeURIComponent(brand)}&limit=5000`, { headers: { Accept: "application/json" } });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Nepodarilo sa načítať modely");
        printers = Array.isArray(data.printers) ? data.printers : [];
        globalBrands = Array.isArray(data.brands) ? data.brands : globalBrands;
        renderPopularGrid();
        renderGlobalBrands();
        if (status) status.textContent = printers.length ? `Našli sme ${printers.length} modelov tlačiarní ${brand}.` : `Pre značku ${brand} sme zatiaľ nenašli modely.`;
        if (count) count.textContent = printers.length ? `${printers.length} modelov v zozname` : "";
      } catch (error) {
        if (status) status.textContent = error?.message || "Nepodarilo sa načítať modely tlačiarní.";
      }
    }

    input?.addEventListener("input", () => {
      selectedPrinter = "";
      if (clearButton) clearButton.hidden = !input.value;
      if (submitButton) submitButton.disabled = true;
      renderSuggestionList(filterPrinters(input.value));
    });

    input?.addEventListener("focus", () => renderSuggestionList(filterPrinters(input.value)));

    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const target = selectedPrinter || input.value.trim();
      if (!target) return;
      event.preventDefault();
      window.location.href = printerUrl(target);
    });

    suggestions?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-printer-choice]");
      if (!button) return;
      const target = button.dataset.printerChoice || "";
      if (!target) return;
      window.location.href = printerUrl(target);
    });

    clearButton?.addEventListener("click", () => {
      setSelectedPrinter("");
      if (input) {
        input.value = "";
        input.focus();
      }
      renderSuggestionList(filterPrinters(""));
    });

    submitButton?.addEventListener("click", () => {
      const target = selectedPrinter || input?.value?.trim();
      if (!target) return;
      window.location.href = printerUrl(target);
    });

    root.querySelector("[data-open-brand-list]")?.addEventListener("click", () => {
      if (brandModal instanceof HTMLDialogElement) brandModal.showModal();
    });

    loadPrinters();
  }

  document.querySelector("[data-close-brand-modal]")?.addEventListener("click", () => {
    if (brandModal instanceof HTMLDialogElement) brandModal.close();
  });

  brandModal?.addEventListener("click", (event) => {
    if (event.target === brandModal && brandModal instanceof HTMLDialogElement) brandModal.close();
  });

  document.addEventListener("click", (event) => {
    document.querySelectorAll("[data-printer-suggestions]").forEach((suggestions) => {
      if (suggestions.hidden) return;
      if (event.target.closest("[data-printer-finder]")) return;
      suggestions.hidden = true;
    });
  });

  roots.forEach(initPrinterFinder);
})();
