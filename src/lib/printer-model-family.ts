function compact(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const XEROX_VARIANT_SUFFIX = /(?:series|vdni|vdn|dni|dnm|dnw|dnf|bi|ni|dn|nw|n|b|v|z)$/;
const SAMSUNG_VARIANT_SUFFIX = /(?:series|fdw|ndw|fnw|dn|dw|fd|fw|fn|nd|nw|w|n|f|d)$/;

/** HP LaserJet labels may omit Pro/MFP; the complete model suffix is identity. */
export function hpLaserJetPrinterIdentityKey(value: unknown) {
  const key = compact(value);
  if (!/^hp(?:color)?laserjet/.test(key)) return "";
  const model = key.replace(/^hp(?:color)?laserjet/, "")
    .replace(/^(?:pro|enterprise|managed|flow|mfp)+/, "")
    .replace(/(?:mfp|printer)$/, "");
  // Never strip equipment or HP+ suffixes: M110w != M110we, M1132 != M1132s.
  return /^[a-z]{0,3}\d{2,5}[a-z]{0,7}$/.test(model) ? model : "";
}

/**
 * Xerox používa za základným číslom modelu koncovky výbavy (B, BI, N, DN,
 * DNI, V...). Tie nemenia rodinu spotrebného materiálu. HP koncovky
 * sa naopak zachovávajú celé vrátane označenia programu HP+.
 */
export function xeroxPrinterFamilyKey(value: unknown) {
  const key = compact(value);
  if (!key.startsWith("xerox")) return "";
  const model = key.slice("xerox".length);
  if (!/\d/.test(model)) return model;
  return model.replace(XEROX_VARIANT_SUFFIX, "");
}

/**
 * Samsung sa v katalógu zapisuje napr. ako Samsung M2070W, SL-M2070W alebo
 * Xpress M2070W. Marketingové prefixy ani koncovky výbavy nemenia modelovú
 * rodinu, no rozdielne čísla (M2026 a M2070) ostávajú samostatné.
 */
export function samsungPrinterFamilyKey(value: unknown) {
  const key = compact(value);
  if (!key.startsWith("samsung")) return "";
  let model = key.slice("samsung".length)
    .replace(/^(?:multixpress|proxpress|xpress)/, "")
    .replace(/^sl/, "");
  if (!/\d/.test(model)) return "";
  model = model.replace(SAMSUNG_VARIANT_SUFFIX, "");
  return model;
}

export function consumablePrinterFamilyKey(value: unknown) {
  const hp = hpLaserJetPrinterIdentityKey(value);
  if (hp) return `hp:laserjet:${hp}`;
  const xerox = xeroxPrinterFamilyKey(value);
  if (xerox) return `xerox:${xerox}`;
  const samsung = samsungPrinterFamilyKey(value);
  if (samsung) return `samsung:${samsung}`;
  return "";
}

export function sameConsumablePrinterFamily(left: unknown, right: unknown) {
  const leftKey = consumablePrinterFamilyKey(left);
  const rightKey = consumablePrinterFamilyKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}
