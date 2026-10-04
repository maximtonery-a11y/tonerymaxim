export type DetectedPrinterInput = {
  name?: string;
  driver?: string;
  isDefault?: boolean;
  isNetwork?: boolean;
  isLocal?: boolean;
  isOffline?: boolean;
  isVirtual?: boolean;
};

export type DetectedPrinterMatch = {
  status: "exact" | "ambiguous" | "not_found" | "ignored";
  model?: string;
  suggestions?: string[];
  reason?: string;
};

const BRANDS = [
  "Konica Minolta", "Panasonic", "Samsung", "Lexmark", "Kyocera", "Toshiba",
  "Brother", "Canon", "Epson", "Xerox", "Ricoh", "Dell", "Utax", "OKI",
  "HP", "Sharp", "Pantum", "Philips", "IBM",
] as const;

const VIRTUAL_MARKERS = [
  "microsoft print to pdf", "microsoft xps document writer", "fax", "onenote",
  "adobe pdf", "pdfcreator", "pdf creator", "cutepdf", "bullzip", "dopdf",
  "microsoft office document image writer", "send to onenote", "snagit",
];

// Slová, ktoré samy osebe neidentifikujú rodinu tlačiarne. Pri číselnom
// modeli ich pri hľadaní rodinného kontextu preskočíme (napr. LaserJet Pro 200
// -> laserjet200, nie iba 200). Práve strata tohto kontextu bola chyba V3.
const GENERIC_ALPHA_TOKENS = new Set([
  "printer", "printers", "printing", "series", "driver", "class", "universal",
  "device", "queue", "copy", "network", "local", "usb", "wsd", "ipp",
  "pro", "plus", "mfp", "type", "v", "version", "windows", "microsoft",
  "pcl", "ps", "xps", "postscript", "color", "colour", "mono", "monochrome",
  "enterprise", "professional", "business", "edition", "model",
]);

function normalize(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function compact(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function words(value: unknown) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function brandOf(value: unknown) {
  const text = ` ${normalize(value).replace(/[^a-z0-9]+/g, " ")} `;
  const compactText = compact(value);
  for (const brand of BRANDS) {
    const normalizedBrand = normalize(brand).replace(/[^a-z0-9]+/g, " ");
    const compactBrand = compact(brand);
    if (text.includes(` ${normalizedBrand} `)) return brand;
    if (compactText.startsWith(compactBrand) && /\d/.test(compactText.slice(compactBrand.length))) return brand;
  }
  if (text.includes(" hewlett packard ")) return "HP";
  if (text.includes(" konica ")) return "Konica Minolta";
  return "";
}

function isBrandToken(token: string) {
  return BRANDS.some((brand) => words(brand).includes(token))
    || token === "hewlett" || token === "packard" || token === "konica" || token === "minolta";
}

function excludedModelToken(token: string) {
  return /^(?:v\d+|pcl\d*|ps\d*|xps\d*|type\d+)$/i.test(token);
}

function isDistinctiveAlpha(token: string) {
  return /^[a-z]{1,14}$/.test(token)
    && !GENERIC_ALPHA_TOKENS.has(token)
    && !isBrandToken(token);
}

function nearestDistinctiveContext(tokens: string[], index: number) {
  // Maximálne štyri tokeny dozadu: zachytí napr. „HP Color LaserJet Pro 200",
  // ale neťahá nesúvisiaci text zo začiatku dlhého názvu ovládača.
  for (let i = index - 1; i >= Math.max(0, index - 4); i -= 1) {
    const token = tokens[i];
    if (!token) continue;
    if (/\d/.test(token)) break;
    if (isDistinctiveAlpha(token)) return token;
  }
  return "";
}

function suffixAlpha(tokens: string[], index: number) {
  const next = tokens[index + 1] || "";
  if (!/^[a-z]{1,4}$/.test(next)) return "";
  if (GENERIC_ALPHA_TOKENS.has(next) || isBrandToken(next)) return "";
  return next;
}

type SignatureCandidate = {
  value: string;
  score: number;
  autoSafe: boolean;
};

type ModelSignature = {
  value: string;
  autoSafe: boolean;
};

/**
 * Konzervatívna identita modelu.
 *
 * Príklady:
 * - Brother HL-L2350DW       -> hll2350dw
 * - Brother DCP L2532 DW     -> dcpl2532dw
 * - Epson WF-C5890DWF        -> wfc5890dwf
 * - Ricoh SP 230DNW          -> sp230dnw
 * - HP LaserJet Pro 200      -> laserjet200
 * - HP DeskJet 200           -> deskjet200
 * - HP LaserJet Pro M404dn   -> m404dn
 *
 * Ak názov obsahuje viac rovnocenných modelov (M404-M405), vrátime viac
 * signatúr a katalógový záznam nie je „atomický“ – nikdy sa neprijme automaticky.
 */
function modelSignatures(value: unknown): ModelSignature[] {
  const tokens = words(value).map(compact).filter(Boolean);
  const candidates: SignatureCandidate[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] || "";
    if (!token || !/\d/.test(token) || token.length < 3 || excludedModelToken(token)) continue;

    const previous = tokens[index - 1] || "";
    const nextSuffix = suffixAlpha(tokens, index);

    if (/[a-z]/.test(token)) {
      const previousIsShortFamily = /^[a-z]{1,4}$/.test(previous) && isDistinctiveAlpha(previous);

      if (previousIsShortFamily) {
        candidates.push({ value: `${previous}${token}${nextSuffix}`, score: 7, autoSafe: true });
        continue;
      }

      // Model začínajúci číslom (napr. 2710e, 3025BI, 6030B) potrebuje,
      // ak je dostupný, aj rodinný kontext: DeskJet 2710e -> deskjet2710e.
      if (/^\d/.test(token)) {
        const context = nearestDistinctiveContext(tokens, index);
        if (context) {
          candidates.push({ value: `${context}${token}${nextSuffix}`, score: 7, autoSafe: true });
        } else {
          // Alfanumerický kód bez kontextu je stále použiteľný, ale iba v rámci
          // zistenej značky a iba ak je v katalógu jednoznačný.
          candidates.push({ value: `${token}${nextSuffix}`, score: 5, autoSafe: true });
        }
        continue;
      }

      candidates.push({ value: `${token}${nextSuffix}`, score: 6, autoSafe: true });
      continue;
    }

    if (/^\d{3,7}$/.test(token)) {
      const context = nearestDistinctiveContext(tokens, index);
      if (context) {
        candidates.push({ value: `${context}${token}${nextSuffix}`, score: 4, autoSafe: true });
      } else if (nextSuffix) {
        // Oddelený alfanumerický kód (napr. „Dell 3110 cn“) je ekvivalent
        // jedného tokenu 3110cn. Značka + jednoznačný katalógový kód je bezpečný.
        candidates.push({ value: `${token}${nextSuffix}`, score: 5, autoSafe: true });
      } else {
        // Samotné číslo (napr. „HP 2710“) je na automatické prijatie príliš
        // slabé. Použije sa iba na návrhy pre používateľa.
        candidates.push({ value: token, score: 1, autoSafe: false });
      }
    }
  }

  if (!candidates.length) return [];
  const bestScore = Math.max(...candidates.map((item) => item.score));
  const best = candidates.filter((item) => item.score === bestScore);
  const byValue = new Map<string, ModelSignature>();
  for (const item of best) {
    const current = byValue.get(item.value);
    if (!current || (!current.autoSafe && item.autoSafe)) {
      byValue.set(item.value, { value: item.value, autoSafe: item.autoSafe });
    }
  }
  return [...byValue.values()];
}

function fullModelKey(value: string) {
  return compact(value);
}

function dedupeModels(models: string[]) {
  const byKey = new Map<string, string>();
  for (const model of models) {
    const text = String(model || "").replace(/\s+/g, " ").trim();
    const key = fullModelKey(text);
    if (!text || !key) continue;
    const previous = byKey.get(key);
    if (!previous || text.length < previous.length) byKey.set(key, text);
  }
  return [...byKey.values()];
}

export function isVirtualDetectedPrinter(printer: DetectedPrinterInput) {
  if (printer?.isVirtual === true) return true;
  const haystack = normalize(`${printer?.name || ""} ${printer?.driver || ""}`);
  return VIRTUAL_MARKERS.some((marker) => haystack.includes(marker));
}

type PreparedCatalogEntry = {
  model: string;
  key: string;
  brand: string;
  signatures: ModelSignature[];
  atomic: boolean;
};

type PreparedCatalog = {
  entries: PreparedCatalogEntry[];
};

const PREPARED_CATALOG_CACHE = new WeakMap<string[], PreparedCatalog>();

function prepareCatalog(rawCatalogModels: string[]): PreparedCatalog {
  const cached = PREPARED_CATALOG_CACHE.get(rawCatalogModels);
  if (cached) return cached;

  const entries = dedupeModels(rawCatalogModels).map((model) => {
    const signatures = modelSignatures(model);
    return {
      model,
      key: fullModelKey(model),
      brand: brandOf(model),
      signatures,
      atomic: signatures.length === 1,
    };
  });
  const prepared = { entries };
  PREPARED_CATALOG_CACHE.set(rawCatalogModels, prepared);
  return prepared;
}

function exactBrandCompatible(detectedBrand: string, catalogBrand: string) {
  if (!catalogBrand) return true;
  if (!detectedBrand) return false;
  return compact(detectedBrand) === compact(catalogBrand);
}

function suggestionBrandCompatible(detectedBrand: string, catalogBrand: string) {
  if (!detectedBrand || !catalogBrand) return true;
  return compact(detectedBrand) === compact(catalogBrand);
}

function exactModelsForField(fieldValue: string, catalog: PreparedCatalog, fallbackBrand: string) {
  const detectedBrand = brandOf(fieldValue) || fallbackBrand;
  const detectedSignatures = modelSignatures(fieldValue).filter((item) => item.autoSafe);
  if (!detectedSignatures.length) return [];
  const signatureSet = new Set(detectedSignatures.map((item) => item.value));

  return dedupeModels(catalog.entries
    .filter((entry) => entry.atomic)
    .filter((entry) => exactBrandCompatible(detectedBrand, entry.brand))
    .filter((entry) => entry.signatures.some((signature) => signature.autoSafe && signatureSet.has(signature.value)))
    .map((entry) => entry.model));
}

function intersection(left: string[], right: string[]) {
  const rightKeys = new Set(right.map(fullModelKey));
  return dedupeModels(left.filter((item) => rightKeys.has(fullModelKey(item))));
}

function conservativeSuggestions(printer: DetectedPrinterInput, catalog: PreparedCatalog, fallbackBrand: string) {
  const values = [printer.name, printer.driver].map((value) => String(value || "").trim()).filter(Boolean);
  const signatures = [...new Set(values.flatMap((value) => modelSignatures(value).map((item) => item.value)))];
  if (!signatures.length) return [];

  const detectedBrand = values.map(brandOf).find(Boolean) || fallbackBrand;
  const candidates = catalog.entries.filter((entry) => {
    if (!entry.atomic || !suggestionBrandCompatible(detectedBrand, entry.brand)) return false;
    return signatures.some((source) => entry.signatures.some((targetSignature) => {
      const target = targetSignature.value;
      if (source === target) return true;
      if (source.length < 3 || target.length < 3) return false;
      // Iba návrh pre používateľa: prefix/suffix môže pomôcť pri skrátenom
      // driveri, ale nikdy sa z neho nestane automatická zhoda.
      return source.startsWith(target)
        || target.startsWith(source)
        || source.endsWith(target)
        || target.endsWith(source);
    }));
  });
  return dedupeModels(candidates.map((entry) => entry.model)).slice(0, 5);
}

export function matchDetectedPrinter(printer: DetectedPrinterInput, rawCatalogModels: string[]): DetectedPrinterMatch {
  if (!printer || isVirtualDetectedPrinter(printer)) {
    return { status: "ignored", reason: "virtual_printer" };
  }

  const name = String(printer.name || "").replace(/\s+/g, " ").trim();
  const driver = String(printer.driver || "").replace(/\s+/g, " ").trim();
  if (!name && !driver) return { status: "not_found", reason: "missing_name" };

  const catalog = prepareCatalog(rawCatalogModels);
  const fallbackBrand = brandOf(`${name} ${driver}`);
  const nameMatches = name ? exactModelsForField(name, catalog, fallbackBrand) : [];
  const driverMatches = driver ? exactModelsForField(driver, catalog, fallbackBrand) : [];

  if (nameMatches.length && driverMatches.length) {
    const common = intersection(nameMatches, driverMatches);
    if (common.length === 1) return { status: "exact", model: common[0] };
    if (common.length > 1) return { status: "ambiguous", suggestions: common.slice(0, 5), reason: "multiple_common_models" };

    return {
      status: "ambiguous",
      suggestions: dedupeModels([...nameMatches, ...driverMatches]).slice(0, 5),
      reason: "name_driver_conflict",
    };
  }

  const only = nameMatches.length ? nameMatches : driverMatches;
  if (only.length === 1) return { status: "exact", model: only[0] };
  if (only.length > 1) return { status: "ambiguous", suggestions: only.slice(0, 5), reason: "multiple_exact_models" };

  const suggestions = conservativeSuggestions(printer, catalog, fallbackBrand);
  if (suggestions.length) return { status: "ambiguous", suggestions, reason: "partial_only" };
  return { status: "not_found", reason: "no_safe_match" };
}
