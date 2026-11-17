// Keep meaningful suffixes, plus signs and generations when comparing printer labels.
const modelKey = value => value.trim().toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[\s_\u2010\u2011-]+/g, "");

export function indexPrinterModels(names, product) {
  const thirdParty = ["compatible", "renovated"].includes(product.product_type_key);
  return names.filter(name => {
    if (!/\d/.test(name) || /[/;,–—*]|\b(?:series|séria|série)\b/i.test(name)
      || /\d[a-z]*\s*-\s*[a-z]{0,4}\d/i.test(name)) return false;
    const hp = /\bHP\b|hewlett[- ]packard/i.test(name + " " + (product.product_brand || ""));
    return !(thirdParty && hp && /\d[a-z-]*e(?:[\s)]|$)|\(e\)|\bHP\+/i.test(name));
  }).map(name => ({ name, key: modelKey(name) }));
}

export function findPrinterModel(index, query) {
  const text = query.trim();
  const key = modelKey(text);
  if (key.length < 2 || !/[a-z0-9]/.test(key)) return { state: "empty", choices: [] };
  const exact = /\d/.test(key) && index.find(model => model.key === key);
  if (exact) return { state: "listed", name: exact.name, choices: [] };
  const terms = text.split(/\s+/).map(modelKey).filter(Boolean);
  const choices = [];
  for (const model of index) {
    // In a name such as "HP LaserJet 1005", a separate 1005 must not suggest P1005.
    const matches = terms.every(term => {
      if (terms.length > 1 && /^\d+$/.test(term)) {
        return model.name.split(/\s+/).some(word => modelKey(word).startsWith(term));
      }
      return model.key.includes(term);
    });
    if (matches) choices.push(model.name);
    if (choices.length === 5) break;
  }
  return { state: choices.length ? "choose" : "unknown", choices };
}

export function bindPrinterCheck(root, getNames, product, chip, modelUrl) {
  const box = root.querySelector("[data-printer-check]");
  if (!box) return;
  const toggle = box.querySelector("[data-check-toggle]");
  const panel = box.querySelector("[data-check-panel]");
  const form = panel.querySelector("form");
  const field = form.elements.namedItem("model");
  const status = panel.querySelector("[role=status]");
  const options = panel.querySelector("[data-check-options]");
  const search = panel.querySelector("[data-check-catalog]");
  const heading = root.querySelector("[data-check-heading]");
  const summary = root.querySelector("[data-check-summary]");
  const defaultHeading = heading.textContent;
  const defaultSummary = summary.textContent;
  let index;
  const models = () => index ??= indexPrinterModels(getNames(), product);
  const reported = new Set();

  function selectModel(name) {
    heading.textContent = name ? "Vybraná tlačiareň v zozname kompatibility" : defaultHeading;
    summary.textContent = name || defaultSummary;
  }

  function track(result) {
    if (reported.has(result) || window.ToneryMaximCookies?.get?.()?.analytics !== true
      || typeof window.tmTrackEcommerce !== "function") return;
    reported.add(result);
    window.tmTrackEcommerce("printer_fit_check", { fit_result: result, item_id: String(product.sku || product.id) });
  }

  function showResult() {
    const query = field.value.trim();
    const { state, name, choices } = findPrinterModel(models(), query);
    selectModel(name);
    options.replaceChildren();
    status.dataset.state = state;
    search.hidden = !["unknown", "choose"].includes(state) || !/\d/.test(query);
    if (search.hidden) search.removeAttribute("href");
    else search.href = "/produkty?" + new URLSearchParams({ s: query });

    if (state === "listed") {
      status.textContent = name + " je v zozname kompatibilných modelov." +
        (chip?.key === "no-chip" ? " Táto náplň vyžaduje pôvodný čip." : "");
    } else if (state === "choose") {
      status.textContent = "Vyberte presný názov zo štítku tlačiarne vrátane písmen na konci.";
      for (const label of choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        options.append(button);
      }
    } else if (state === "unknown") {
      status.textContent = "Tento model nemáme pri produkte potvrdený. Skontrolujte označenie na tlačiarni.";
    } else {
      status.textContent = "Označenie modelu nájdete na tlačiarni alebo na jej štítku.";
    }
    return state;
  }

  function setOpen(open) {
    toggle.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
    if (open) {
      showResult();
      field.focus();
      track("opened");
    } else toggle.focus();
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  root.querySelector("[data-check-from-models]")?.addEventListener("click", event => {
    event.preventDefault();
    setOpen(true);
    box.scrollIntoView({ block: "center" });
  });
  field.addEventListener("input", showResult);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const state = showResult();
    if (state !== "empty") track(state);
    if (state === "choose") options.firstElementChild?.focus();
    else if (state !== "empty") status.focus();
  });
  options.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    field.value = button.textContent;
    if (showResult() === "listed") track("listed");
    status.focus();
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  });
  search.addEventListener("click", () => track("catalog_search"));

  // Only a matching model page on our own shop supplies printer context.
  if (!document.referrer) return;
  const referrer = new URL(document.referrer);
  const path = referrer.pathname.replace(/\/$/, "");
  if (referrer.origin !== location.origin || !/^\/tlaciarne\/[^/]+\/[^/]+$/.test(path)) return;
  const matches = models().filter(model => modelUrl(model.name) === path);
  if (matches.length === 1 && !matches[0].name.includes("+")) {
    field.value = matches[0].name;
    selectModel(matches[0].name);
  }
}
