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
    Xerox: [
      "Xerox WorkCentre 6515",
      "Xerox Phaser 6510",
      "Xerox VersaLink C405",
      "Xerox VersaLink C400",
      "Xerox C315",
      "Xerox C310",
      "Xerox WorkCentre 6605",
      "Xerox Phaser 6600",
      "Xerox C235",
      "Xerox C230",
      "Xerox Phaser 3020",
      "Xerox WorkCentre 3025",
    ],
    Samsung: [
      "Samsung SL-M2026W",
      "Samsung SL-M2070W",
      "Samsung Xpress SL-C430W",
      "Samsung Xpress SL-C480W",
      "Samsung Xpress C410W",
      "Samsung Xpress C460FW",
      "Samsung CLP-365",
      "Samsung CLX-3305",
      "Samsung CLP-320",
      "Samsung CLX-3185",
      "Samsung Xpress M2825",
      "Samsung Xpress M2875",
    ],
  };

  const normalize = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const compactKey = (value) => normalize(value).replace(/[^a-z0-9]/g, "");

  function samsungFamilyKey(value) {
    const key = compactKey(value);
    if (!key.startsWith("samsung")) return "";
    let model = key.slice("samsung".length)
      .replace(/^(?:multixpress|proxpress|xpress)/, "")
      .replace(/^sl/, "");
    if (!/\d/.test(model)) return "";
    return model.replace(/(?:series|fdw|ndw|fnw|dn|dw|fd|fw|fn|nd|nw|w|n|f|d)$/, "");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function productWord(countValue) {
    const n = Number(countValue || 0);
    if (n === 1) return "produkt";
    if (n > 1 && n < 5) return "produkty";
    return "produktov";
  }

  function printerUrl(title, brand) {
    const brandSlug = normalize(brand).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const modelSlug = normalize(title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return brandSlug && modelSlug && /\d/.test(title)
      ? `/tlaciarne/${brandSlug}/${modelSlug}`
      : `/produkty?printer=${encodeURIComponent(title)}`;
  }

  const printerImages = {
    [compactKey("Epson EcoTank L3251")]: "/printer-images/epson/l3251.webp",
    [compactKey("Epson EcoTank L3151")]: "/printer-images/epson/l3151.webp",
    [compactKey("Epson EcoTank L3110")]: "/printer-images/epson/l3110.webp",
    [compactKey("Epson EcoTank L3101")]: "/printer-images/epson/l3101.webp",
    [compactKey("Epson EcoTank L3260")]: "/printer-images/epson/l3260.webp",
    [compactKey("Epson EcoTank L1210")]: "/printer-images/epson/l1210.webp",
    [compactKey("Epson EcoTank L3250")]: "/printer-images/epson/l3250.webp",
    [compactKey("Epson EcoTank L5190")]: "/printer-images/epson/l5190.webp",
    [compactKey("Epson EcoTank L5290")]: "/printer-images/epson/l5290.webp",
    [compactKey("Epson Stylus SX425W")]: "/printer-images/epson/sx425w.webp",
    [compactKey("Epson Stylus S20")]: "/printer-images/epson/s20.webp",
    [compactKey("Epson Stylus SX100")]: "/printer-images/epson/sx100.webp",

    [compactKey("HP LaserJet M110w")]: "/printer-images/hp/m110w.webp",
    [compactKey("HP LaserJet Pro M404dn")]: "/printer-images/hp/m404dn.webp",
    [compactKey("HP LaserJet Pro MFP M428fdw")]: "/printer-images/hp/m428fdw.webp",
    [compactKey("HP LaserJet Pro MFP M140w")]: "/printer-images/hp/m140w.webp",
    [compactKey("HP LaserJet P1102")]: "/printer-images/hp/p1102.webp",
    [compactKey("HP LaserJet Pro M15w")]: "/printer-images/hp/m15w.webp",
    [compactKey("HP LaserJet Pro MFP M28w")]: "/printer-images/hp/m28w.webp",
    [compactKey("HP LaserJet Pro M203dn")]: "/printer-images/hp/m203dn.webp",
    [compactKey("HP Color LaserJet Pro 3202DN")]: "/printer-images/hp/color-3202dn.webp",
    [compactKey("HP Color LaserJet Pro 3202DW")]: "/printer-images/hp/color-3202dw.webp",
    [compactKey("HP Color LaserJet Pro M254dw")]: "/printer-images/hp/m254dw.webp",
    [compactKey("HP Color LaserJet Pro M254nw")]: "/printer-images/hp/m254nw.webp",
    [compactKey("HP Color LaserJet Pro M255DW")]: "/printer-images/hp/m255dw.webp",

    [compactKey("Canon i-SENSYS MF655Cdw")]: "/printer-images/canon/mf655cdw.webp",
    [compactKey("Canon i-SENSYS LBP223dw")]: "/printer-images/canon/lbp223dw.webp",
    [compactKey("Canon i-SENSYS MF643Cdw")]: "/printer-images/canon/mf643cdw.webp",
    [compactKey("Canon i-SENSYS MF645Cx")]: "/printer-images/canon/mf645cx.webp",
    [compactKey("Canon i-SENSYS MF752Cdw")]: "/printer-images/canon/mf752cdw.webp",
    [compactKey("Canon PIXMA MG3650")]: "/printer-images/canon/mg3650.webp",
    [compactKey("Canon PIXMA TS3350")]: "/printer-images/canon/ts3350.webp",
    [compactKey("Canon imagePROGRAF TM-200")]: "/printer-images/canon/imageprograf.webp",
    [compactKey("Canon PIXMA TS3150")]: "/printer-images/canon/ts3150.webp",
    [compactKey("Canon PIXMA TS5150")]: "/printer-images/canon/ts5150.webp",
    [compactKey("Canon PIXMA G3411")]: "/printer-images/canon/pixma-g3411.webp",
    [compactKey("Canon PIXMA MX495")]: "/printer-images/canon/pixma-mx495.webp",
    [compactKey("Canon imagePROGRAF iPF8300")]: "/printer-images/canon/ipf8300.webp",

    [compactKey("Brother DCP-L2532DW")]: "/printer-images/brother/dcp-l2532dw.webp",
    [compactKey("Brother DCP-L2512D")]: "/printer-images/brother/dcp-l2512d.webp",
    [compactKey("Brother HL-L2372DN")]: "/printer-images/brother/hl-l2372dn.webp",
    [compactKey("Brother MFC-L2712DN")]: "/printer-images/brother/mfc-l2712dn.webp",
    [compactKey("Brother MFC-L2732DW")]: "/printer-images/brother/mfc-l2732dw.webp",
    [compactKey("Brother DCP-T500W")]: "/printer-images/brother/dcp-t500w.webp",
    [compactKey("Brother DCP-T510W")]: "/printer-images/brother/dcp-t510w.webp",
    [compactKey("Brother DCP-J4110DW")]: "/printer-images/brother/dcp-j4110dw.webp",
    [compactKey("Brother MFC-J4410DW")]: "/printer-images/brother/mfc-j4410dw.webp",
    [compactKey("Brother MFC-J4510DW")]: "/printer-images/brother/mfc-j4510dw.webp",
    [compactKey("Brother MFC-J4610DW")]: "/printer-images/brother/mfc-j4610dw.webp",
    [compactKey("Brother MFC-J4710DW")]: "/printer-images/brother/mfc-j4710dw.webp",

    [compactKey("Xerox WorkCentre 6515")]: "/printer-images/xerox/xerox-workcentre-6515.webp",
    [compactKey("Xerox Phaser 6510")]: "/printer-images/xerox/xerox-phaser-6510.webp",
    [compactKey("Xerox VersaLink C405")]: "/printer-images/xerox/xerox-versalink-c405.webp",
    [compactKey("Xerox VersaLink C400")]: "/printer-images/xerox/xerox-versalink-c400.webp",
    [compactKey("Xerox C315")]: "/printer-images/xerox/xerox-c315.webp",
    [compactKey("Xerox C310")]: "/printer-images/xerox/xerox-c310.webp",
    [compactKey("Xerox WorkCentre 6605")]: "/printer-images/xerox/xerox-workcentre-6605.webp",
    [compactKey("Xerox Phaser 6600")]: "/printer-images/xerox/xerox-phaser-6600.webp",
    [compactKey("Xerox C235")]: "/printer-images/xerox/xerox-c235.webp",
    [compactKey("Xerox C230")]: "/printer-images/xerox/xerox-c230.webp",
    [compactKey("Xerox Phaser 3020")]: "/printer-images/xerox/xerox-phaser-3020.webp",
    [compactKey("Xerox WorkCentre 3025")]: "/printer-images/xerox/xerox-workcentre-3025.webp",

    [compactKey("Samsung SL-M2026W")]: "https://cdn.cs.1worldsync.com/13/d8/13d82067-c91a-420b-9cb1-a86fe1b4db20.jpg",
    [compactKey("Samsung SL-M2070W")]: "https://image.alza.cz/products/PN072x2/PN072x2.jpg",
    [compactKey("Samsung Xpress SL-C430W")]: "https://www.bedienungsanleitung-pdf.de/p/pictures1/samsung-xpress-c430w-farblaserdrucker-wlan-nfc-3016.jpg",
    [compactKey("Samsung Xpress SL-C480W")]: "https://www.printerland.co.za/images/Product_LargeImages/C480W-large.jpg",
    [compactKey("Samsung Xpress C410W")]: "https://media.officedepot.com/images/f_auto%2Cq_auto%2Ce_sharpen%2Ch_450/products/774866/774866_o52/774866",
    [compactKey("Samsung Xpress C460FW")]: "https://www.amatteroffax.com/assets/images/defaultproducts/L010-022.jpg",
    [compactKey("Samsung CLP-365")]: "https://awella.ru/pic-samsung/clp-365-1.jpg",
    [compactKey("Samsung CLX-3305")]: "https://www.drtusz.com/ndcimages/zdjecia/baza/urzadzenia/samsung-clx-3305-20322020512.jpg",
    [compactKey("Samsung CLP-320")]: "https://www.printer-care.de/media/images/org/samsung-clp-320_200SAGO-CLP-320_1.jpg",
    [compactKey("Samsung CLX-3185")]: "https://cdn.lesnumeriques.com/optim/produits/36/11106/36_11106_2__400_400.jpg",
    [compactKey("Samsung Xpress M2825")]: "https://www.bhphotovideo.com/images/images2500x2500/samsung_sl_m2825dw_xac_xpress_m2825dw_monochrome_laser_1235343.jpg",
    [compactKey("Samsung Xpress M2875")]: "https://www.hpmarket.cz/library/configuration/tiskarny/Samsung-SL-M2875ND_0b.jpg",
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
        .map((title) => {
          const family = samsungFamilyKey(title);
          const printer = printers.find((item) => compactKey(item.title) === compactKey(title))
            || (family ? printers.find((item) => samsungFamilyKey(item.title) === family) : null);
          return printer ? { ...printer, title } : null;
        })
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
          <a href="${escapeHtml(printer.url || printerUrl(printer.title, brand))}" class="printer-popular-card${hasImageClass}">
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
        const response = await fetch(`/api/printers?brand=${encodeURIComponent(brand)}&limit=5000`, { headers: { Accept: "application/json" } });
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
      const match = printers.find((printer) => compactKey(printer.title) === compactKey(target));
      window.location.href = match?.url || printerUrl(target, brand);
    });

    suggestions?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-printer-choice]");
      if (!button) return;
      const target = button.dataset.printerChoice || "";
      if (!target) return;
      const match = printers.find((printer) => compactKey(printer.title) === compactKey(target));
      window.location.href = match?.url || printerUrl(target, brand);
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
      const match = printers.find((printer) => compactKey(printer.title) === compactKey(target));
      window.location.href = match?.url || printerUrl(target, brand);
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
