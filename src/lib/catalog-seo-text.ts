import type { TmProduct } from "./tm-products-cache";
import { productOemCodes } from "./seo-catalog.ts";
import { normalizeSeoTitle } from "./seo-snippet.ts";
import { resolvedPublicationBrand } from "./product-publication-policy.ts";

const SITE_SUFFIX = " | ToneryMaxim.sk";

function clean(value: unknown): string {
  return String(value || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productSearchText(product: TmProduct): string {
  const cached = clean(product.search_text);
  if (cached) return cached;
  const categories = Array.isArray(product.categories)
    ? product.categories.map((item: any) => `${item?.name || ""} ${item?.slug || ""}`).join(" ")
    : "";
  return clean([
    product.name,
    product.sku,
    product.slug,
    product.product_type_label,
    product.product_type_detail_label,
    categories,
  ].join(" ")).toLocaleLowerCase("sk");
}

function sentence(value: unknown): string {
  const text = clean(value).replace(/[.,;:]+$/g, "");
  return text ? `${text}.` : "";
}

function truncate(value: string, limit: number): string {
  const text = clean(value);
  if (text.length <= limit) return text;
  const shortened = text.slice(0, limit + 1).replace(/\s+\S*$/, "").replace(/[.,;:–—-]+$/g, "");
  return shortened || text.slice(0, limit).trim();
}

function unique(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = clean(value);
    const key = text.toLocaleLowerCase("sk");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function skCount(value: number, one: string, few: string, many: string): string {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  const form = count === 1 ? one : count >= 2 && count <= 4 ? few : many;
  return `${count} ${form}`;
}

type ProductKind = "toner" | "ink" | "drum" | "waste" | "fuser" | "transfer" | "ribbon" | "maintenance" | "component";

function productKind(product: TmProduct): ProductKind {
  const text = productSearchText(product);
  const name = clean(product.name).toLocaleLowerCase("sk");
  if (/(?:\bpapier\b|obálk|obal|šanón|sanon|škatuľ|skatul|balík|balik)/i.test(name)) return "component";
  if (/\b(?:pilot|frixion|roller)\b/i.test(text)) return "component";
  if (/\b(optick|valec|drum|imaging\s*unit|image\s*unit|zobrazovac)/i.test(text)) return "drum";
  if (/\b(odpad|odp\.?\s*nádob|waste\s*(toner|container|bottle))/i.test(text)) return "waste";
  if (/\b(fuser|zapekac|fixing\s*(unit|assembly)|fixac)/i.test(text)) return "fuser";
  if (/\b(transfer\s*(belt|unit)|prenosov)/i.test(text)) return "transfer";
  if (/\b(ribbon|paska|páska)/i.test(text)
    || /\b(?:EPSON\s+(?:ERC|LQ)|PANASONIC\s+KX-(?:F|FP|P))\s*-?\s*\d+/i.test(productName(product))) return "ribbon";
  if (/\b(maintenance|udrzb|údržb|service\s*kit)/i.test(text)) return "maintenance";
  if (/\b(atrament|inkjet|ink|ink\s*cartridge)/i.test(text)
    || /\b(?:BCI|CLI|PGI|GI|PFI|BT|LC)[\s-]*[A-Z]*\d/i.test(text)
    || /\b(?:epson\s+T\d|no\.?\s*\d{3,4}\b.*(?:pack|black|cyan|magenta|yellow))/i.test(text)
    || (/\b(napln|náplň|cartridge|kazet)/i.test(text) && !/\b(toner|páska|paska|ribbon|label\s*tape)/i.test(text))) return "ink";
  if (/\btoner/i.test(text)
    || /\b(?:CRG|CF|CE|CB|CC|Q|W)\s*-?\s*\d{2,5}[A-Z]*\b/i.test(text)
    || /\b(?:T\s*-?\s*10|C\s*-?\s*EXV\s*\d+)\b/i.test(text)) return "toner";
  return "component";
}

const kindNames: Record<ProductKind, { one: string; many: string }> = {
  toner: { one: "toner", many: "tonery" },
  ink: { one: "atramentová náplň", many: "atramentové náplne" },
  drum: { one: "optický valec", many: "optické valce" },
  waste: { one: "nádoba na odpadový toner", many: "nádoby na odpadový toner" },
  fuser: { one: "zapekacia jednotka", many: "zapekacie jednotky" },
  transfer: { one: "prenosová jednotka", many: "prenosové jednotky" },
  ribbon: { one: "tlačová páska", many: "tlačové pásky" },
  maintenance: { one: "údržbová súprava", many: "údržbové súpravy" },
  component: { one: "spotrebný materiál", many: "spotrebný materiál" },
};

function colorText(value: unknown): string {
  const text = clean(value);
  if (!text) return "";
  const normalized = text.toLocaleLowerCase("sk");
  if (/black|cier|čier/.test(normalized)) return "Čierna farba";
  if (/cyan|azur|azúr/.test(normalized)) return "Azúrová farba";
  if (/magenta|purpur/.test(normalized)) return "Purpurová farba";
  if (/yellow|zlt|žlt/.test(normalized)) return "Žltá farba";
  if (/cmyk|multipack|farebn|color|colour/.test(normalized)) return "Farebné vyhotovenie";
  return `Farba: ${text}`;
}

function capacityText(product: TmProduct): string {
  const value = clean(product.page_yield || product.capacity);
  if (!value || !/\d/.test(value)) return "";
  if (/\b(str|page|ml|litr)/i.test(value)) return `kapacita ${value}`;
  return `kapacita ${value} strán`;
}

function chipText(product: TmProduct): string {
  const text = productSearchText(product);
  if (/\b(no[ -]?chip|bez\s+c(?:ip|ipu)|bez\s+č(?:ip|ipu))/i.test(text)) return "bez čipu";
  if (/\b(oem[ -]?chip|oem\s+c(?:ip|ipom)|oem\s+č(?:ip|ipom))/i.test(text)) return "s OEM čipom";
  if ((product.product_type_key === "compatible" || product.product_type_key === "renovated") && /\b(smart\s*)?(chip|cip|čip)/i.test(text)) return "s čipom";
  return "";
}

function productName(product: TmProduct): string {
  return clean(product.name) || clean(product.sku) || "Produkt do tlačiarne";
}

type SlovakGender = "masculine" | "feminine";

const masculineColors: Record<string, string> = {
  "čierna": "čierny", cierna: "čierny", black: "čierny",
  "azúrová": "azúrový", azurova: "azúrový", cyan: "azúrový",
  "purpurová": "purpurový", purpurova: "purpurový", magenta: "purpurový",
  "žltá": "žltý", zlta: "žltý", yellow: "žltý",
  "sivá": "sivý", siva: "sivý", gray: "sivý", grey: "sivý",
  "svetlo sivá": "svetlosivý", "svetlosivá": "svetlosivý", "foto sivá": "fotografický sivý",
  "svetlo azúrová": "svetloazúrový", "svetlo purpurová": "svetlopurpurový",
  "červená": "červený", cervena: "červený", red: "červený",
  "modrá": "modrý", modra: "modrý", blue: "modrý",
  "zelená": "zelený", zelena: "zelený", green: "zelený",
  "biela": "biely", white: "biely",
  "farebná": "farebný", farebna: "farebný", color: "farebný", colour: "farebný",
  cmyk: "farebný", cmy: "farebný", multipack: "farebný",
  "foto modrá": "fotografický modrý", "tmavo sivá": "tmavosivý", oranžová: "oranžový",
  "chroma optimizer": "Chroma Optimizer", "optimalizátor lesku": "optimalizátor lesku",
  clear: "číry", "full pack": "farebný", "3-farby": "farebný", "6-farieb": "farebný",
  "(c/m/y)": "farebný", "sada (k/c/m/y)": "farebný", "c/m/y/pc/pm/r": "farebný",
};

const feminineColors: Record<string, string> = {
  "čierna": "čierna", cierna: "čierna", black: "čierna",
  "azúrová": "azúrová", azurova: "azúrová", cyan: "azúrová",
  "purpurová": "purpurová", purpurova: "purpurová", magenta: "purpurová",
  "žltá": "žltá", zlta: "žltá", yellow: "žltá",
  "sivá": "sivá", siva: "sivá", gray: "sivá", grey: "sivá",
  "svetlo sivá": "svetlosivá", "svetlosivá": "svetlosivá", "foto sivá": "fotografická sivá",
  "svetlo azúrová": "svetloazúrová", "svetlo purpurová": "svetlopurpurová",
  "červená": "červená", cervena: "červená", red: "červená",
  "modrá": "modrá", modra: "modrá", blue: "modrá",
  "zelená": "zelená", zelena: "zelená", green: "zelená",
  "biela": "biela", white: "biela",
  "farebná": "farebná", farebna: "farebná", color: "farebná", colour: "farebná",
  cmyk: "farebná", cmy: "farebná", multipack: "farebná",
  "foto modrá": "fotografická modrá", "tmavo sivá": "tmavosivá", oranžová: "oranžová",
  "chroma optimizer": "Chroma Optimizer", "optimalizátor lesku": "optimalizátor lesku",
  clear: "číra", "full pack": "farebná", "3-farby": "farebná", "6-farieb": "farebná",
  "(c/m/y)": "farebná", "sada (k/c/m/y)": "farebná", "c/m/y/pc/pm/r": "farebná",
};

function grammaticalColor(product: TmProduct, gender: SlovakGender): string {
  const name = productName(product);
  let raw = clean(product.color || product.farba).toLocaleLowerCase("sk");
  if (/\blight\s+cyan\b|\bsvetlo\s*az[úu]rov/i.test(name)) raw = "svetlo azúrová";
  else if (/\blight\s+(?:magenta|mag\.?)\b|\bsvetlo\s*purpur/i.test(name)) raw = "svetlo purpurová";
  else if (!raw) {
    const coded = name.match(/\bC\s*-?\s*EXV\s*-?\s*\d+\s*(BK|B|C|M|Y)\b/i)?.[1]?.toUpperCase();
    const short = name.match(/\s-\s*(B|BK|CY|MA|YE)\b/i)?.[1]?.toUpperCase();
    const signal = coded || short || "";
    raw = ({ B: "čierna", BK: "čierna", C: "azúrová", CY: "azúrová", M: "purpurová", MA: "purpurová", Y: "žltá", YE: "žltá" } as Record<string, string>)[signal] || "";
  }
  if (!raw) return "";
  const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const colors = gender === "masculine" ? masculineColors : feminineColors;
  return colors[raw] || colors[normalized] || (/bk|cyan|magenta|yellow|cmy|fareb|color/i.test(raw) ? colors.farebna : "");
}

function grammaticalType(product: TmProduct, gender: SlovakGender): string {
  const key = clean(product.product_type_key).toLowerCase();
  if (gender === "feminine") {
    if (key === "compatible") return "kompatibilná";
    if (key === "original") return "originálna";
    if (key === "renovated") return "renovovaná";
  } else {
    if (key === "compatible") return "kompatibilný";
    if (key === "original") return "originálny";
    if (key === "renovated") return "renovovaný";
  }
  return "";
}

function titleProductKind(product: TmProduct): { gender: SlovakGender; noun: string; compactNoun: string } {
  const kind = productKind(product);
  const text = productSearchText(product);
  const set = /\b(multipack|multi[ -]?pack|sada|set|[346][ -]?pack)\b/i.test(text)
    || /\b[A-Z]{1,6}-?\d{2,5}[A-Z]*\s*(?:XL|XXL)?\s*\+\s*[A-Z]{1,6}-?\d{2,5}/i.test(productName(product));
  if (set && kind === "ink") return { gender: "feminine", noun: "sada atramentových náplní", compactNoun: "sada náplní" };
  if (set && kind === "toner") return { gender: "feminine", noun: "sada tonerov", compactNoun: "sada tonerov" };
  if (kind === "ink") return { gender: "feminine", noun: "atramentová náplň", compactNoun: "náplň" };
  if (kind === "drum") return { gender: "masculine", noun: "optický valec", compactNoun: "valec" };
  if (kind === "waste") return { gender: "feminine", noun: "odpadová nádobka", compactNoun: "nádobka" };
  if (kind === "fuser") return { gender: "feminine", noun: "zapekacia jednotka", compactNoun: "jednotka" };
  if (kind === "transfer") return { gender: "feminine", noun: "prenosová jednotka", compactNoun: "jednotka" };
  if (kind === "ribbon") return { gender: "feminine", noun: "tlačová páska", compactNoun: "páska" };
  if (kind === "maintenance") return { gender: "feminine", noun: "údržbová súprava", compactNoun: "súprava" };
  if (kind === "toner") return { gender: "masculine", noun: "toner", compactNoun: "toner" };
  return { gender: "masculine", noun: "spotrebný materiál", compactNoun: "materiál" };
}

function normalizedProductCode(value: unknown): string {
  return clean(value)
    .toUpperCase()
    .replace(/^C\s*-?\s*EXV\s*-?\s*/i, "C-EXV ")
    .replace(/^(C-EXV \d+)\s+(BK|B|C|M|Y)$/i, "$1$2")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*-\s*/g, "-");
}

function codeFromProductName(product: TmProduct): string {
  const name = productName(product);

  // Sady dvoch rôznych kaziet nesmú v titulku stratiť druhý kód
  // (napr. Canon PG-545 XL + CL-546 XL).
  const pair = name.match(/\b([A-Z]{1,6}-?\d{2,5}[A-Z]*)\s*(XL|XXL)?\s*\+\s*([A-Z]{1,6}-?\d{2,5}[A-Z]*)\s*(XL|XXL)?\b/i);
  if (pair) {
    const first = `${pair[1]}${pair[2] ? ` ${pair[2]}` : ""}`.toUpperCase();
    const second = `${pair[3]}${pair[4] ? ` ${pair[4]}` : ""}`.toUpperCase();
    return `${first} + ${second}`;
  }

  // Katalógové číslo v zátvorke je pri HP, OKI, Xerox a podobných značkách
  // presnejšie než marketingový názov alebo model tlačiarne pred ním.
  const parenthesized = name.match(/\(\s*([A-Z0-9][A-Z0-9-]{5,15})\s*\)/i);
  if (parenthesized && /\d/.test(parenthesized[1])) return normalizedProductCode(parenthesized[1]);

  // Najprv výrobcovské rady, ktoré pôvodný úzky OEM parser nepoznal.
  const known = name.match(/\b(C\s*-?\s*EXV\s*-?\s*\d{1,3}(?:\s*(?:BK|B|C|M|Y))?|(?:BT|LC|BCI|CLI|PGI|PFI|CRG|CF|CE|CB|CC|TN|DR|TK)\s*-?\s*[A-Z0-9-]*\d[A-Z0-9-]*|(?:ERC|LQ|FX|KX-FP?|KX-P)\s*-?\s*\d{1,5}|GI\s*-?\s*\d{2,4}(?:\s*\/\s*GI\s*-?\s*\d{2,4})?|TZE?\s*-?\s*[A-Z]?\d{3,5}|DK\s*-?\s*\d{3,5}|WT\s*-?\s*\d{3,5}[A-Z]*|TNP\s*-?\s*\d{2,4}[A-Z]*|IU\s*-?\s*\d{2,5}[A-Z]*|BP\s*-?\s*[A-Z]{1,3}\d{2,5}|SP\s*-?\s*\d{2,4}|T\s*-?\s*10\b|A0V[A-Z0-9]{3,8}|TL\s*-?\s*\d{3,5}[A-Z]*|\d[A-Z0-9]{5,11})\b/i);
  if (known) return normalizedProductCode(known[1]);

  // Bežné názvy začínajú značkou a hneď za ňou nesú rodinu alebo kód.
  const afterBrand = name.match(/^\s*(?:HP|Canon|Brother|Epson|Xerox|Samsung|Lexmark|Kyocera|OKI|Ricoh|Dell|Utax|Toshiba|Panasonic|Sharp|Pantum|Konica(?:\s+Minolta)?|Develop|Dymo)\s+(?:originál(?:ny|na)?\s+|originál\s+|toner\s+|páska\s+)*([A-Z0-9][A-Z0-9/-]*)/i);
  if (afterBrand && /\d/.test(afterBrand[1])) return normalizedProductCode(afterBrand[1]);

  // Názvy typu „kompatibilná kazeta/toner pre značku KÓD“.
  const afterForBrand = name.match(/\bpre\s+(?:HP|Canon|Brother|Epson|Xerox|Samsung|Lexmark|Kyocera|OKI|Ricoh|Dell|Utax|Toshiba|Panasonic|Sharp|Pantum|Dymo|Konica(?:\s+Minolta)?)\s+([A-Z0-9][A-Z0-9/-]{2,20})/i);
  if (afterForBrand && /\d/.test(afterForBrand[1])) return normalizedProductCode(afterForBrand[1]);

  return "";
}

function readableNameIdentity(product: TmProduct): string {
  const name = productName(product)
    .replace(/^\s*(?:renovovaný\s+(?:toner|valec)\s+HATONA|renovovaný\s+(?:toner|valec)|kompatibilný\s+toner|kompatibilná\s+kazeta|kompatibilná\s+páska|alt\.\s*páska)\s+pre\s+/iu, "")
    .replace(/(?:black|cyan|magenta|yellow|čierny|čierna|azúrový|azúrová|purpurový|purpurová|žltý|žltá)/giu, " ")
    .replace(/(?:kompatibilný|kompatibilná|kompatibilné|originálny|originálna|originálne|originál|renovovaný|renovovaná|tonerová|toner|atramentová|atramentové|náplň|náplne|optický|valec|spotrebný|materiál)/giu, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:strán|str\.|ml)\b/giu, " ");
  return truncate(name, 28) || "Produkt do tlačiarne";
}

function productIdentity(product: TmProduct): string {
  const nameCode = codeFromProductName(product);
  if (nameCode) return nameCode;
  const oem = productOemCodes(product)[0];
  if (oem) return oem;
  const name = productName(product);
  const brand = clean(product.product_brand);
  if (brand && name.toLocaleLowerCase("sk").startsWith(brand.toLocaleLowerCase("sk"))) {
    const afterBrand = name.slice(brand.length).trim();
    const leadingCode = afterBrand.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\s+(XL|XXL|TWIN))?/i);
    if (leadingCode && /[A-Z]/i.test(leadingCode[1]) && /\d/.test(leadingCode[1])) {
      return `${leadingCode[1]}${leadingCode[2] ? ` ${leadingCode[2].toUpperCase()}` : ""}`.replace(/\s*-\s*/g, "-");
    }
  }
  const cartridge = name.match(/\b(?:Canon\s+)?Cartridge\s+([A-Z0-9-]+)/i);
  if (cartridge) return `CRG ${cartridge[1].toUpperCase()}`;
  const mpn = clean(product.mpn);
  if (mpn) return mpn.toUpperCase();
  return readableNameIdentity(product);
}

function productBrandLabel(product: TmProduct, identity: string): string {
  const name = productName(product);
  const match = name.match(/\b(HP|Canon|Brother|Epson|Xerox|Samsung|Lexmark|Kyocera|OKI|Ricoh|Dell|Utax|Toshiba|Panasonic|Sharp|Pantum|Dymo|IBM|Develop|Konica(?:\s+Minolta)?|Minolta)\b/i);
  let brand = resolvedPublicationBrand(product) || clean(match?.[1] || product.product_brand || product.manufacturer_brand);
  const canonicalBrands: Record<string, string> = {
    hp: "HP", canon: "Canon", brother: "Brother", epson: "Epson", xerox: "Xerox",
    samsung: "Samsung", lexmark: "Lexmark", kyocera: "Kyocera", oki: "OKI", ricoh: "Ricoh",
    dell: "Dell", utax: "Utax", toshiba: "Toshiba", panasonic: "Panasonic", sharp: "Sharp",
    pantum: "Pantum", dymo: "Dymo", ibm: "IBM", develop: "Develop", konica: "Konica Minolta",
    minolta: "Konica Minolta", "konica minolta": "Konica Minolta",
  };
  brand = canonicalBrands[brand.toLocaleLowerCase("sk")] || brand;
  if (!brand || identity.toLocaleLowerCase("sk").startsWith(brand.toLocaleLowerCase("sk"))) return "";
  return brand;
}

function naturalQualifier(product: TmProduct, identity: string): string {
  const name = productName(product);
  const hatona = /\bHATONA\b/i.test(name);
  const packComposition = name.match(/\b([A-Z]{1,3}(?:\/[A-Z]{1,3}){2,})\s+PACK\b/i);
  if (packComposition) return packComposition[1].toUpperCase() + " sada";
  const chip = chipText(product);
  if (chip) return chip + (hatona ? " HATONA" : "");
  if (hatona) return "HATONA";
  if (!/\b(?:XL|XXL)\b/i.test(identity)) {
    const size = name.match(/\b(XXL|XL)\b/i)?.[1];
    if (size) return size.toUpperCase();
  }
  if (/\b(twin|dvojbalenie|dual\s*pack)\b/i.test(name)) return "dvojbalenie";
  const thousandYield = name.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*K\b/i)?.[1];
  if (thousandYield) return `${thousandYield.replace(".", ",")} tis. strán`;
  const volume = name.match(/\b(\d+(?:[.,]\d+)?)\s*ml\b/i)?.[1];
  if (volume) return `${volume.replace(".", ",")} ml`;
  const pieces = name.match(/\((\d{1,2})\s*ks\)|\b(\d{1,2})\s*x\b/i);
  if (pieces) return (pieces[1] || pieces[2]) + " ks";
  if (/\bCMYK\b/i.test(name)) return "CMYK sada";
  if (/\bCMY\b/i.test(name)) return "CMY sada";
  const pairedCode = name.match(/\b(?:black|čierna?)\s*\+\s*([A-Z]{1,5}-?\d{2,5}[A-Z]*)/i);
  if (pairedCode) return "sada s " + pairedCode[1].toUpperCase();
  return "";
}

function compactCapacity(product: TmProduct): string {
  return clean(product.page_yield || product.capacity)
    .replace(/\s*strán\b/iu, " str.")
    .replace(/\s+/g, " ");
}

const duplicateQualifierCache = new WeakMap<TmProduct[], Map<TmProduct, string>>();

function humanVariantQualifier(product: TmProduct): string {
  const name = productName(product);
  const parenthesized = name.match(/\(\s*([A-Z0-9][A-Z0-9-]{5,15})\s*\)/i)?.[1];
  if (parenthesized) return parenthesized.toUpperCase();
  if (/\blight\s+cyan\b|\bsvetlo\s*az[úu]rov/i.test(name)) return "svetloazúrová";
  if (/\blight\s+(?:magenta|mag\.?)\b|\bsvetlo\s*purpur/i.test(name)) return "svetlopurpurová";
  const thousandYield = name.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*K\b/i)?.[1];
  if (thousandYield) return `${thousandYield.replace(".", ",")} tis. strán`;
  const volume = name.match(/\b(\d+(?:[.,]\d+)?)\s*ml\b/i)?.[1];
  if (volume) return `${volume.replace(".", ",")} ml`;
  if (/\bDevelop\b/i.test(name)) return "Develop";
  const series = name.match(/\b([A-Z])\s+(\d{3}(?:\/\d{3}){1,8})\b/i);
  if (series) return `${series[1].toUpperCase()} ${series[2]}`;
  return compactCapacity(product);
}

function duplicateQualifier(product: TmProduct, allProducts?: TmProduct[]): string {
  if (!allProducts) return "";
  let cached = duplicateQualifierCache.get(allProducts);
  if (!cached) {
    cached = new Map<TmProduct, string>();
    const groups = new Map<string, TmProduct[]>();
    for (const item of allProducts) {
      const title = baseProductTitle(item);
      const group = groups.get(title) || [];
      group.push(item);
      groups.set(title, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const variants = group.map(humanVariantQualifier);
      const distinctVariants = new Set(variants.filter(Boolean).map((value) => value.toLocaleLowerCase("sk")));
      if (distinctVariants.size > 1) {
        group.forEach((item, index) => {
          if (variants[index]) cached!.set(item, variants[index]);
        });
        continue;
      }
      const capacities = new Set(group.map(compactCapacity).filter(Boolean));
      if (capacities.size > 1) {
        for (const item of group) cached.set(item, compactCapacity(item));
      }
    }
    duplicateQualifierCache.set(allProducts, cached);
  }
  return cached.get(product) || "";
}

function productTitleParts(product: TmProduct) {
  const identity = productIdentity(product);
  const brand = productBrandLabel(product, identity);
  const brandedIdentity = [brand, identity].filter(Boolean).join(" ");
  const kind = titleProductKind(product);
  const color = grammaticalColor(product, kind.gender);
  const type = grammaticalType(product, kind.gender);
  const qualifier = naturalQualifier(product, identity);
  const phrase = [color, type, kind.noun, qualifier].filter(Boolean).join(" ");
  const compactPhrase = [color, type, kind.compactNoun, qualifier].filter(Boolean).join(" ");
  return { identity, brandedIdentity, phrase, compactPhrase };
}

function baseProductTitle(product: TmProduct): string {
  const { brandedIdentity, phrase, compactPhrase } = productTitleParts(product);
  const fullCore = `${brandedIdentity} ${phrase}`;
  const compactCore = `${brandedIdentity} ${compactPhrase}`;
  const core = fullCore.length <= 65 ? fullCore : compactCore;
  return normalizeSeoTitle(core.length + SITE_SUFFIX.length <= 65 ? `${core}${SITE_SUFFIX}` : core);
}

function productTitle(product: TmProduct, allProducts?: TmProduct[]): string {
  const base = baseProductTitle(product);
  const qualifier = duplicateQualifier(product, allProducts);
  if (!qualifier) return base;
  const core = base.endsWith(SITE_SUFFIX) ? base.slice(0, -SITE_SUFFIX.length) : base;
  const suffix = " – " + qualifier;
  return normalizeSeoTitle(truncate(core, 65 - suffix.length) + suffix);
}

export function buildProductSeo(product: TmProduct, allProducts?: TmProduct[]): { title: string; description: string } {
  const name = productName(product);
  const title = productTitle(product, allProducts);
  const kind = productKind(product);
  const printers = unique(Array.isArray(product.compatible_printers) ? product.compatible_printers : []).slice(0, 3);
  const facts = unique([
    colorText(product.color || product.farba),
    capacityText(product),
    chipText(product),
  ]);
  const parts = [sentence(name)];
  if (facts.length) parts.push(sentence(facts.join(", ")));
  if (printers.length) parts.push(sentence(`Pre ${printers.join(printers.length === 2 ? " a " : ", ")}`));
  if (product.stock_status === "instock" && Number(product.stock_quantity ?? 1) > 0) parts.push("Skladom.");
  if (parts.length === 1) parts.push(sentence(`Aktuálna cena, dostupnosť a kompatibilita pre tento ${kindNames[kind].one}`));
  let description = parts.join(" ");
  if (description.length < 40) description += ` ${sentence(`Aktuálna cena a dostupnosť pre tento ${kindNames[kind].one}`)}`;
  return { title, description: truncate(description, 158) };
}

function typeSummary(products: TmProduct[]): string {
  const types = unique(products.map((product) => {
    if (product.product_type_key === "compatible") return "kompatibilný";
    if (product.product_type_key === "original") return "originálny";
    if (product.product_type_key === "renovated") return "renovovaný";
    return "";
  }));
  if (!types.length) return "";
  if (types.length === 1) return types[0];
  return `${types.slice(0, -1).join(", ")} a ${types.at(-1)}`;
}

export function buildCodeSeo(codeValue: unknown, products: TmProduct[], printers: string[]) {
  const code = clean(codeValue).toUpperCase();
  const kinds = unique(products.map((product) => productKind(product)));
  const primaryKind = kinds.length === 1 ? kindNames[kinds[0] as ProductKind] : null;
  const singleName = products.length === 1 ? productName(products[0]) : "";
  const heading = singleName || (primaryKind ? `${code} – ${primaryKind.many}` : `Produkty s označením ${code}`);
  const titleKind = primaryKind?.many || "tonery a náplne";
  const title = normalizeSeoTitle(`${code} – ${titleKind}${SITE_SUFFIX}`);
  const variants = typeSummary(products);
  const stock = products.filter((product) => product.stock_status === "instock" && Number(product.stock_quantity ?? 1) > 0).length;
  const printerNames = unique(printers).slice(0, 3);
  const productText = primaryKind
    ? skCount(products.length, primaryKind.one, primaryKind.many, primaryKind.many)
    : skCount(products.length, "produkt", "produkty", "produktov");
  const parts = [sentence(`${productText} s označením ${code}`)];
  if (variants) parts.push(sentence(`Typ: ${variants}`));
  if (printerNames.length) parts.push(sentence(`Pre ${printerNames.join(printerNames.length === 2 ? " a " : ", ")}`));
  if (stock > 0) parts.push(sentence(`${skCount(stock, "produkt je", "produkty sú", "produktov je")} skladom`));
  return {
    title,
    heading,
    description: truncate(parts.join(" "), 158),
    intro: printerNames.length
      ? `Ponuka pre označenie ${code}. Pred objednaním porovnajte celý kód a presný model tlačiarne.`
      : `Ponuka produktov s označením ${code}. Pred objednaním porovnajte celý kód a údaje v detaile produktu.`,
    kindName: primaryKind?.one || "produkt",
  };
}
