export type GeoPriority = {
  kind: "printer" | "oem";
  key: string;
  label: string;
};

// Pevný zoznam udržiava meranie porovnateľné v čase. Poradie nie je tvrdením
// o predajnosti; ide o prvú skupinu stránok, ktorú cielene posilňujeme.
export const GEO_PRIORITY_PRINTERS: GeoPriority[] = [
  ["hp-color-laserjet-pro-m255dw", "HP Color LaserJet Pro M255DW"],
  ["hp-color-laserjet-pro-m255nw", "HP Color LaserJet Pro M255NW"],
  ["hp-color-laserjet-pro-mfp-m282nw", "HP Color LaserJet Pro MFP M282NW"],
  ["hp-color-laserjet-pro-mfp-m283fdn", "HP Color LaserJet Pro MFP M283FDN"],
  ["hp-laserjet-m110w", "HP LaserJet M110w"],
  ["hp-laserjet-mfp-m140w", "HP LaserJet MFP M140w"],
  ["brother-hl-l2350dw", "Brother HL-L2350DW"],
  ["brother-hl-l2352dw", "Brother HL-L2352DW"],
  ["brother-hl-l8360cdw", "Brother HL-L8360CDW"],
  ["brother-mfc-l8900cdw", "Brother MFC-L8900CDW"],
  ["brother-hl-3140cw", "Brother HL-3140CW"],
  ["brother-hl-3150cdw", "Brother HL-3150CDW"],
  ["brother-hl-3170cdw", "Brother HL-3170CDW"],
  ["brother-mfc-9330cdw", "Brother MFC-9330CDW"],
  ["xerox-phaser-3020", "Xerox Phaser 3020"],
  ["xerox-workcentre-3025", "Xerox WorkCentre 3025"],
  ["hp-color-laserjet-pro-3202dn", "HP Color LaserJet Pro 3202DN"],
  ["hp-color-laserjet-pro-3202dw", "HP Color LaserJet Pro 3202DW"],
  ["hp-color-laserjet-pro-mfp-3302fdw", "HP Color LaserJet Pro MFP 3302FDW"],
  ["canon-imageprograf-ipf8300", "Canon imagePROGRAF iPF8300"],
].map(([key, label]) => ({ kind: "printer", key, label }));

export const GEO_PRIORITY_OEMS: GeoPriority[] = [
  "W1420A", "TN-2421", "TN-2411", "DR-2401", "TN-2420", "TN-2410",
  "DR-2400", "CF283A", "CRG-051", "CRG-054BK", "CRG-046", "CRG-046H",
  "CRG-718", "CRG-731", "CRG-729", "LC-970", "LC-1000", "LC-1100",
  "T378XL", "W2190A",
].map((label) => ({ kind: "oem", key: label.toLowerCase().replace(/[^a-z0-9]/g, ""), label }));

export function geoPrinterPriority(slug: string): GeoPriority | undefined {
  return GEO_PRIORITY_PRINTERS.find((item) => item.key === String(slug || "").toLowerCase());
}

export function geoOemPriority(code: string): GeoPriority | undefined {
  const key = String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return GEO_PRIORITY_OEMS.find((item) => item.key === key);
}
