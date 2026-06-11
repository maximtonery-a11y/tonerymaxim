(() => {
  const root = document.querySelector("[data-printer-finder]");
  if (!root) return;

  const brand = root.dataset.brand || "";
  const input = root.querySelector("[data-printer-input]");
  const clearButton = root.querySelector("[data-clear-printer]");
  const submitButton = root.querySelector("[data-printer-submit]");
  const suggestions = root.querySelector("[data-printer-suggestions]");
  const status = root.querySelector("[data-printer-status]");
  const popularGrid = root.querySelector("[data-printer-popular-grid]");
  const count = root.querySelector("[data-printer-count]");
  const brandModal = document.querySelector("[data-brand-modal]");
  const brandGrid = document.querySelector("[data-brand-grid]");

  let printers = [];
  let brands = [];
  let selectedPrinter = "";

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
    ],
    HP: [
      "HP LaserJet M110w",
      "HP LaserJet Pro M404dn",
      "HP LaserJet Pro MFP M428fdw",
      "HP LaserJet Pro MFP M140w",
      "HP LaserJet P1102",
      "HP LaserJet Pro M15w",
      "HP LaserJet Pro MFP M28w",
      "HP LaserJet Pro M203dn",
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
      "Canon PIXMA TS3350",
      "Canon PIXMA MG3650",
      "Canon PIXMA G3411",
      "Canon PIXMA TS5150",
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
    return `/produkty?printer=${encodeURIComponent(title)}`;
  }

  const printerImages = {
    [compactKey("Brother DCP-L2532DW")]: "/printer-images/brother/dcp-l2532dw.png",
    [compactKey("Brother DCP-L2512D")]: "/printer-images/brother/dcp-l2512d.png",
    [compactKey("Brother HL-L2372DN")]: "/printer-images/brother/hl-l2372dn.png",
    [compactKey("Brother MFC-L2712DN")]: "/printer-images/brother/mfc-l2712dn.png",
    [compactKey("Brother MFC-L2732DW")]: "/printer-images/brother/mfc-l2732dw.png",
    [compactKey("Brother DCP-T500W")]: "/printer-images/brother/dcp-t500w.png",
    [compactKey("Brother DCP-T510W")]: "/printer-images/brother/dcp-t510w.png",
    [compactKey("Brother DCP-J4110DW")]: "/printer-images/brother/dcp-j4110dw.png",
    [compactKey("Brother MFC-J4410DW")]: "/printer-images/brother/mfc-j4410dw.png",
    [compactKey("Brother MFC-J4510DW")]: "/printer-images/brother/mfc-j4510dw.png",
    [compactKey("Brother MFC-J4610DW")]: "/printer-images/brother/mfc-j4610dw.png",
    [compactKey("Brother MFC-J4710DW")]: "/printer-images/brother/mfc-j4710dw.png",
  };

  function printerImage(title) {
    return printerImages[compactKey(title)] || "";
  }

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

    suggestions.innerHTML = items.map((printer) => `
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

    popularGrid.innerHTML = items.map((printer) => {
      const image = printerImage(printer.title);
      const hasImageClass = image ? " has-printer-image" : "";
      return `
        <a href="${printerUrl(printer.title)}" class="printer-popular-card${hasImageClass}">
          ${image ? `
            <span class="printer-popular-image" aria-hidden="true">
              <img src="${image}" alt="" loading="lazy" decoding="async">
            </span>
          ` : ""}
          <span class="printer-popular-content">
            <span class="printer-popular-title">${escapeHtml(printer.title)}</span>
            <span class="printer-popular-meta">${Number(printer.product_count || 0)} ${productWord(printer.product_count)}</span>
            <strong>Zobraziť náplne →</strong>
          </span>
        </a>
      `;
    }).join("");
  }

  function renderBrands() {
    if (!brandGrid) return;
    brandGrid.innerHTML = brands.map((item) => `<a href="${item.url}">${escapeHtml(item.title)}</a>`).join("");
  }

  async function loadPrinters() {
    try {
      const response = await fetch(`/api/printers?brand=${encodeURIComponent(brand)}&limit=5000`, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Nepodarilo sa načítať modely");
      printers = Array.isArray(data.printers) ? data.printers : [];
      brands = Array.isArray(data.brands) ? data.brands : [];
      renderPopularGrid();
      renderBrands();
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

  suggestions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-printer-choice]");
    if (!button) return;
    setSelectedPrinter(button.dataset.printerChoice || "");
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

  document.querySelector("[data-close-brand-modal]")?.addEventListener("click", () => {
    if (brandModal instanceof HTMLDialogElement) brandModal.close();
  });

  brandModal?.addEventListener("click", (event) => {
    if (event.target === brandModal && brandModal instanceof HTMLDialogElement) brandModal.close();
  });

  document.addEventListener("click", (event) => {
    if (!suggestions || suggestions.hidden) return;
    if (event.target.closest("[data-printer-finder]")) return;
    suggestions.hidden = true;
  });

  loadPrinters();
})();
