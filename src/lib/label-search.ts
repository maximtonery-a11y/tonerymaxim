import type { LabelCandidate } from './label-reference.ts';
export { candidateText, barcodeGuidance, type LabelCandidate } from './label-reference.ts';

// Only manufacturer references leave the device. Keep the entire suffix throughout matching.
export type LabelLine = { text: string; confidence: number; confirmedList?: boolean; words?: { text: string; confidence: number; verifiedDigits?: boolean; legibleList?: boolean }[] };
type Rule = { kind: LabelCandidate['kind']; brand: string; pattern: RegExp };

const printerFamilies = [
  { brand: 'HP', name: /\b(?:LASERJET|DESKJET|OFFICEJET|DESIGNJET|ENVY|SMART TANK|HP (?:COLOR )?LASER|LASER(?=\s+107[AW]\b))\b/i, number: /^(?:\d{4}[A-Z]{0,4}|107A|\d{3}(?:W|WE|NW|NWE|FNW|FDW))$/ },
  { brand: 'Xerox', name: /\b(?:WORKCENTRE|PHASER|VERSALINK|ALTALINK)\b/i, number: /^[BC]?\d{3,4}[A-Z]{0,3}$/ },
  { brand: 'Samsung', name: /\b(?:XPRESS|PROXPRESS|SAMSUNG)\b/i, number: /^(?:(?:SL-)?[CMX]|SCX-|ML-)\d{3,5}[A-Z]{0,4}$/ },
  { brand: 'Kyocera', name: /\b(?:ECOSYS|TASKALFA)\b/i, number: /^(?:[MP][A-Z]?-?)?\d{3,5}[A-Z]{0,4}$/ },
];
// HP product-number fields on printer plates, checked against HP's model specifications.
const hpPrinterNumbers = new Map([
  // hp.com/sk-sk/products/printers/product-details/24494357 and /24494358
  ['4ZB77A', '107A'], ['4ZB78A', '107W'],
  // hp.com/sk-sk/products/printers/product-details/34443734 and /35334172
  ['7MD66F', 'M110W'], ['7MD66E', 'M110WE'],
  // h10032.www1.hp.com/ctg/Manual/c06183445.pdf, technical specifications by printer model
  ['W1A53A', 'M404DN'], ['W1A56A', 'M404DW'],
]);
const productNumberField = /\b(?:PRODUCT\s*(?:NO\.?|NUMBER|ID)|PROD\.?\s*(?:NO\.?|ID)|P\/N|ČÍSLO\s+PRODUKTU)[\s:#.,_–-]{0,8}([A-Z0-9]{6})(?:#[A-Z0-9]{3})?(?![A-Z0-9#-])/i;
const hpOem = /^(?:C[BEFH]\d{3}|[CQW]\d{4}|[A-Z]\d[A-Z]\d{2})[A-Z]{1,3}$/;
export function isCompleteBrotherModel(code: string) {
  return /^(?:DCP|MFC|HL)-[A-Z]?\d{3,5}(?:CDW|CDN|DW|DN|CW|NW)$/.test(code);
}

// Read the open C on a colour printer independently. Only the full word from
// the trusted read is returned. No digit, family or network suffix is inferred.
export function confirmsBrotherColourBadge(precise: LabelCandidate[], other: LabelCandidate[]) {
  if (precise.length !== 1 || !other.length) return false;
  const [reading] = precise;
  if (!reading.certain || reading.brand !== 'Brother' || reading.kind !== 'printer') return false;
  const mark = /^((?:DCP|MFC|HL)-[A-Z]?\d{3,4})C(D[WN])$/.exec(reading.code);
  if (!mark) return false;
  const closedGlyph = mark[1] + '0' + mark[2];
  return other.every(item => item.kind === 'printer' && item.brand === 'Brother'
    && (item.code === reading.code || item.code === closedGlyph));
}

// On one physical nameplate an extra stroke can turn CDW into CDHW.
// Accept only a complete printed spelling, corroborated by another reading
// of the same family and digits. Two plausible suffixes still need a choice.
export function corroboratedBrotherBadge(passes: LabelLine[][], privateCodes: Set<string>) {
  for (const lines of passes) labelCandidates(lines, privateCodes);
  const observed = passes.map(lines => ({ lines, items: labelCandidates(lines, privateCodes) })).filter(r => r.items.length);
  if (observed.length < 2 || observed.some(r => r.items.length !== 1)) return;
  const items = observed.map(r => r.items[0]);
  if (items.some(r => r.kind !== 'printer' || r.brand !== 'Brother')) return;
  const good = items.filter(r => isCompleteBrotherModel(r.code));
  if (!good.length || new Set(good.map(r => r.code)).size !== 1) return;
  const code = good[0].code;
  const stem = code.match(/^(?:DCP|MFC|HL)-[A-Z]?\d{3,5}/)![0];
  const suffix = code.slice(stem.length);
  const compatibleRead = (other: string) => {
    if (other === code) return true;
    if (!other.startsWith(stem)) return false;
    const noisy = other.slice(stem.length);
    if (noisy.length !== suffix.length + 1) return false;
    return [...noisy].some((_, i) => noisy.slice(0, i) + noisy.slice(i + 1) === suffix);
  };
  if (items.every(r => compatibleRead(r.code))) return observed.find(r => r.items[0].code === code)?.lines;
}
const rules: Rule[] = [
  { kind: 'supply', brand: 'HP', pattern: hpOem },
  { kind: 'supply', brand: 'Brother', pattern: /^(?:(?:TN|DR|LC|BT|WT|BU)-?[A-Z]?\d{2,5}[A-Z0-9]{0,5}|DR-?\d{2,5}CL-(?:CMYK|CMY|BK|[CMY]))$/ },
  { kind: 'supply', brand: 'Canon', pattern: /^(?:GI|PGI|CLI|PG|CL|CRG|PFI)-?\d{2,4}[A-Z]{0,5}$/ },
  { kind: 'supply', brand: 'Epson', pattern: /^C13[TS][A-Z0-9]{4,11}$/ },
  { kind: 'supply', brand: 'Kyocera', pattern: /^TK-?\d{2,5}[A-Z]{0,2}$/ },
  { kind: 'supply', brand: 'Xerox', pattern: /^\d{3}R\d{5}$/ },
  { kind: 'supply', brand: 'Samsung', pattern: /^(?:MLT|CLT)-?[A-Z]\d{3}[A-Z]{0,3}$/ },
  { kind: 'printer', brand: 'Brother', pattern: /^(?:DCP|MFC|HL)-?[A-Z]?\d{3,5}[A-Z]{0,5}$/ },
  { kind: 'printer', brand: 'Canon', pattern: /^(?:TS|TR|MG|MX|MP|IPF|IP|LBP|MF|GX|G)-?\d{3,5}[A-Z]{0,4}$/i },
  { kind: 'printer', brand: 'HP', pattern: /^(?:M|P|CP|CM)\d{3,5}[A-Z]{0,5}$/ },
  { kind: 'printer', brand: 'Epson', pattern: /^(?:ET|XP|WF|L)-?\d{3,5}[A-Z]{0,3}$/ },
];
// Several manufacturers sell printers with the same short badge, e.g. C530dn.
const sharedPrinterModel = /^(?:C|B|MC|MB)\d{3,4}(?:DNW|DWN|DTN|DN|DW|NW|N|W)$/;
const sharedPrinterBrands = ['OKI', 'Lexmark', 'Xerox', 'Samsung'];
const brandPattern = /\b(HP|BROTHER|CANON|EPSON|KYOCERA|XEROX|SAMSUNG|OKI|LEXMARK)\b/gi;
const privateLine = /\b(?:[S5]\s*[/|\\]\s*[I1]?N|S[1I]N(?=\s*[:#])|SN|SERIAL|SERI[AO]V[EÉ]|IMEI|MAC|PASSWORD|HESLO|WIFI|WI-FI|REGULATORY|RMN|EAN|UPC|GTIN)\b/i;
const codeKey = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
// Once independent exposures agree on a complete marking, a narrower crop must
// never substitute its prefix, even if the shop carries that shorter model.
export function isShorterReading(candidate: LabelCandidate, confirmed: LabelCandidate[]) {
  const code = codeKey(candidate.code);
  return confirmed.some(full => {
    if (candidate.kind !== full.kind || candidate.brand !== full.brand) return false;
    const previous = codeKey(full.code);
    return previous.length > code.length && previous.startsWith(code);
  });
}

const clean = (text: string) => text.toUpperCase().replace(/[‐‑‒–—−]/g, '-')
  .replace(/\b(LASERJET|OFFICEJET|DESKJET|DESIGNJET)\s*(PRO)?\s*(MFP)?(?=[MPC]{1,2}\d{3,5}\b|[MPC]{1,2}\d{3,5}[A-Z])/g,
    (_, family, pro, mfp) => [family, pro, mfp].filter(Boolean).join(' ') + ' ')
  .replace(/\b((?:[MP]|CP|CM)\d{3,5})[ \t]+(FDNW|FDW|FDN|DNW|DWN|DN|DW|NW|NWE|WE)\b/g, '$1$2');
const codePrefix = /\b(DCP|MFC|HL|TN|DR|LC|BT|WT|CLI|PGI|GI|CL|PG|CRG|PFI|TK|MLT|CLT|ET|XP|WF|LBP)\s*-?\s+([A-Z]?\d)/g;
const separateSuffix = /\b((?:(?:PGI|CLI|PG|CL|GI|LC|TN)-?\d{2,5}|\d{3}))\s+(XXL|XL|PGBK|BK|[CMY])\b/g;
// On thick type a printed slash may look like an I. Recover just the separator
// between two complete references. Never substitute a character inside either code.
function labelSeparators(text: string) {
  return clean(text)
    .replace(/\b(C[BEFH]\d{3}[AX]D?)\s*\/?[I|\\]\s*(?=CRG[ -]?\d{3,4}\b)/g, '$1/')
    .replace(/\b(CRG[ -]?\d{3,4}H?)\s*\/?[I|\\]\s*(?=(?:H-)?C[BEFH]\d{3}[AX]D?\b)/g, '$1/');
}
function tokens(text: string): string[] {
  return labelSeparators(text)
    .replace(/\b(?:H|HP)\s*-\s*(?=C[BEFH]\d{3}[A-Z]{1,3}\b)/g, '')
    .replace(codePrefix, '$1-$2').replace(/\b((?:TN|DR|LC)-[A-Z]?\d)[ \t]+(\d{2,4}[A-Z]{0,3})\b/g, '$1$2').replace(separateSuffix, '$1$2')
    .replace(/\b(DR-?\d{2,5})\s+CL\b/g, '$1CL').replace(/\b(DR-?\d{2,5}CL)[ -]+(CMYK|CMY|BK|[CMY])\b/g, '$1-$2')
    .match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || [];
}

// Aftermarket labels may print several regional article numbers and one common colour.
// Expand only an entire printed list. Ignore partial lists, mixed colours and barcodes.
export function printedTonerCodes(text: string): string[] {
  const match = clean(text).match(/(?:^|[^A-Z0-9/])(?:LB)?TN[ -]?(\d{3,4}(?:\s*\/\s*\d{3,4}){1,7})[ -]?(BK|[CMYK])(?![A-Z0-9/])/);
  if (!match) return [];
  const numbers = match[1].split(/\s*\/\s*/);
  if (!numbers.every(n => n.length === numbers[0].length)) return [];
  return [...new Set(numbers.map(n => 'TN-' + n + match[2]))];
}

export function matchesPrintedToner(codes: string[], name: string, oem: string) {
  if (/\b(?:CMYK|sada|multipack)\b/i.test(name)) return false;
  return tokens(name + ' ' + oem).some(token => codes.some(code => codeKey(code) === codeKey(token)));
}

export function labelBrands(lines: LabelLine[]): string[] {
  const brands = new Set(lines.flatMap(line => clean(line.text).match(brandPattern) || []));
  const context = clean(lines.map(line => line.text).join(' '));
  for (const family of printerFamilies) if (family.name.test(context)) brands.add(family.brand.toUpperCase());
  if (/\bJETINTELLIGENCE\b/i.test(context)) brands.add('HP');
  if (/\b(?:PIXMA|MAXIFY)\b/i.test(context)) brands.add('CANON');
  if (/\bECOTANK\b/i.test(context)) brands.add('EPSON');
  return [...brands];
}

function visibleLabelLines(lines: LabelLine[], privateCodes: Set<string>) {
  let privateValueOnNextLine = false;
  const useful: LabelLine[] = [];
  for (const line of lines.slice(0, 100)) {
    const text = line.text.trim();
    if (!text) continue;
    if (privateLine.test(text)) {
      for (const token of tokens(text)) privateCodes.add(codeKey(token));
      for (const code of printedTonerCodes(text)) privateCodes.add(codeKey(code));
      privateValueOnNextLine = /(?:[S5]\s*[/|\\]\s*[I1]?N|S[1I]N|SN|SERIAL(?:\s+(?:NUMBER|NO\.?))?|PASSWORD|MAC|RMN|EAN|UPC|GTIN)\s*[:#-]?$/i.test(text);
      continue;
    }
    if (privateValueOnNextLine) {
      privateValueOnNextLine = false;
      if (!/\b(?:MODEL|TONER|CARTRIDGE|LASERJET|PIXMA|ECOTANK)\b/i.test(text)) {
        for (const token of tokens(text)) privateCodes.add(codeKey(token));
        continue;
      }
    }
    useful.push(line);
  }
  return useful;
}

// An aftermarket label can name a different orderable article for each printer brand.
function printedBrandPair(line: string) {
  const parts = labelSeparators(line).split(/[/／]/);
  if (parts.length !== 2) return;
  const left = tokens(parts[0]), right = tokens(parts[1]);
  const canonCode = /^CRG-?\d{3,4}[A-Z]{0,2}$/;
  for (const [hpSide, canonSide] of [[left, right], [right, left]]) {
    const hp = hpSide.filter(code => hpOem.test(code));
    const canon = canonSide.filter(code => canonCode.test(code));
    if (hp.length === 1 && canon.length === 1) return [hp[0], canon[0]] as const;
  }
}

export function hasSplitSupplyLabel(lines: LabelLine[]) {
  return lines.some(({ text }) => {
    if (privateLine.test(text)) return false;
    const normalized = labelSeparators(text);
    if (!/[/／]/.test(normalized)) return false;
    if (printedBrandPair(normalized)) return true;
    const sides = normalized.split(/[/／]/).map(part => part.trim());
    if (sides.length !== 2) return false;
    const hp = /\b(?:C[BEFH]\d{1,3}|[QW]\d{2,4})[A-Z]{0,3}\b/;
    const canon = /\bCRG(?:[- ]?\d{0,4})?[A-Z]{0,2}\b/;
    // A cropped side cannot identify a second brand. A complete same-brand
    // commercial alias (such as HP 85A / CE285A) is still a valid single match.
    const [a, b] = sides;
    return (hp.test(a) && (canon.test(b) || !b)) || (hp.test(b) && (canon.test(a) || !a))
      || (canon.test(a) && !b) || (canon.test(b) && !a);
  });
}

// The full-frame pass also protects references seen beside serial numbers during a later crop.
export function labelCandidates(lines: LabelLine[], privateCodes = new Set<string>(), previousBrands: string[] = []): LabelCandidate[] {
  const found = new Map<string, LabelCandidate>();
  const brands = new Set([...labelBrands(lines), ...previousBrands]);
  const context = clean(lines.map(line => line.text).join(' '));
  const family = printerFamilies.find(family => brands.size === 1 && brands.has(family.brand.toUpperCase())
    && (family.name.test(context) || previousBrands.includes(family.brand.toUpperCase())));
  const packageLabel = /\b(?:TONER|CARTRIDGES?|CARTOUCHES?|DUAL PACK|DRUM UNIT|PRINT CARTRIDGE|FOR USE WITH)\b/i.test(context);
  const useful = visibleLabelLines(lines, privateCodes);
  for (const [index, line] of useful.entries()) {
    let text = line.text;
    const pair = printedBrandPair(text);
    if (pair && pair.every(code => !privateCodes.has(codeKey(code)))) {
      for (const [i, code] of pair.entries()) {
        const brand = i === 0 ? 'HP' : 'Canon';
        const item: LabelCandidate = { brand, code, kind: 'supply', certain: line.confidence >= 78 };
        const key = 'supply:' + brand + ':' + codeKey(code);
        if (!found.has(key) || item.certain) found.set(key, item);
      }
      continue;
    }
    const listed = printedTonerCodes(text);
    const printedWord = listed.length > 1 && line.words?.find(word => printedTonerCodes(word.text).join('/') === listed.join('/'));
    const listConfidence = printedWord ? Math.max(printedWord.confidence,line.confidence) : line.confidence;
    if (listed.length > 1 && (!brands.size || brands.has('BROTHER')) && (listConfidence >= 60 || printedWord && printedWord.legibleList)) {
      const code = listed[0].slice(0,3) + listed.map(ref => ref.slice(3).match(/^\d+/)![0]).join('/') + listed[0].match(/[A-Z]+$/)![0];
      if (!listed.some(ref => privateCodes.has(codeKey(ref))) && !privateCodes.has(codeKey(code))) {
        const key = 'supply:Brother:' + code;
        const certain = listConfidence >= 80 || line.confirmedList === true;
        if (!found.has(key) || certain) found.set(key, { brand:'Brother', code, kind:'supply', certain });
      }
      continue;
    }
    // Canon sometimes prints the family number and its ink colour on separate lines.
    const below = useful[index + 1]?.text.trim() || '';
    if (brands.has('CANON') && /^\d{3}$/.test(text.trim()) && /^(?:PGBK|BK|[CMY]|XX?L)$/i.test(below)) {
      text = text.trim() + below;
    }
    const words = tokens(text);
    const printedNumber = clean(text).match(productNumberField)?.[1];
    // A distorted HP wordmark may still be followed by a clear four-digit model.
    // Only the family word may vary. The customer confirms the unchanged number.
    const hpNumberOnLabel = /^\W*HP\s+(?:LASER|DESK|OFFICE|DESIGN)[A-Z]{0,4}(?:\s+PRO)?\s+(\d{4})(?:\s+PLUS)?\W*$/i.exec(text)?.[1];
    for (const [position, token] of words.entries()) {
      if (privateCodes.has(codeKey(token))) continue;
      const model = hpPrinterNumbers.get(token);
      if (model) {
        if (printedNumber === token && !packageLabel && (!brands.size || brands.has('HP'))) {
          const key = 'printer:HP:' + model;
          if (!found.has(key)) found.set(key, { brand: 'HP', code: model, kind: 'printer', certain: false });
        }
        continue;
      }
      if (!packageLabel && sharedPrinterModel.test(token)) {
        const manufacturer = sharedPrinterBrands.find(b => brands.has(b.toUpperCase()));
        if (!brands.size || manufacturer) {
          const brand = manufacturer || '';
          const confidence = line.words?.find(w => codeKey(w.text) === codeKey(token))?.confidence ?? line.confidence;
          const item: LabelCandidate = { brand, code: token, kind: 'printer', certain: !!brand && confidence >= 85 };
          found.set('printer:' + brand + ':' + token, item);
        }
        continue;
      }
      const rule = rules.find(rule => rule.pattern.test(token));
      const shortHP = (!brands.size || brands.has('HP')) && (/^\d{2,3}(?:[AX]|XL)$/.test(token)
        || (/^\d{2,3}$/.test(token) && new RegExp('\\bHP\\s+' + token + '\\b', 'i').test(text)));
      const shortCanon = brands.has('CANON') && /^\d{3}(?:XXL|XL|PGBK|BK|[HCMY])?$/.test(token);
      const shortEpson = brands.has('EPSON') && /^\d{3}(?:XL)?$/.test(token);
      const explicitHpNumber = !packageLabel && token === hpNumberOnLabel && !/^(?:19|20)\d{2}$/.test(token);
      const numberedPrinter = !packageLabel && family && family.number.test(token)
        && !/^(?:19|20)\d{2}$/.test(token)
        && (!/^\d+$/.test(token) || family.name.test(text)
          || (text.trim() === token && family.name.test(useful[index - 1]?.text || '')));
      if (!rule && !shortHP && !shortCanon && !shortEpson && !numberedPrinter && !explicitHpNumber) continue;
      const brand = numberedPrinter ? family.brand : rule?.brand || (shortCanon ? 'Canon' : shortEpson ? 'Epson' : 'HP');
      const kind = numberedPrinter || explicitHpNumber ? 'printer' : rule?.kind || 'supply';
      if (kind === 'printer' && packageLabel) continue;
      const word = line.words?.find(word => codeKey(word.text) === codeKey(token));
      const confidence = word?.confidence ?? line.confidence;
      const brotherBadge = kind === 'printer' && brand === 'Brother' && confidence >= 92 && isCompleteBrotherModel(token);
      const brandAgrees = brands.size === 1 ? brands.has(brand.toUpperCase())
        : !brands.size && (kind === 'supply' || brotherBadge || word?.verifiedDigits === true);
      if (brands.size && !brands.has(brand.toUpperCase())) continue;
      const code = kind === 'printer' && words[position + 1] === 'PLUS' ? token + ' Plus' : token;
      const key = kind + ':' + brand + ':' + codeKey(code);
      const candidate = { brand, code, kind, certain: (!explicitHpNumber || Boolean(numberedPrinter)) && !shortHP && !shortCanon && !shortEpson && brandAgrees && (confidence >= 85 || word?.verifiedDigits === true) };
      if (!found.has(key) || candidate.certain) found.set(key, candidate);
    }
  }
  const items = [...found.values()];
  // The large DR family name and the precise colour suffix can occupy two lines.
  const preciseDrums = items.filter(item => item.brand === 'Brother' && /^DR-?\d+CL-(?:CMYK|CMY|BK|[CMY])$/.test(item.code));
  const stems = new Set(preciseDrums.map(item => codeKey(item.code.split('CL-')[0])));
  // An uncertain suffix is evidence that the clearer prefix on the other line
  // is incomplete. It is never used to invent a colour or an article number.
  for (const line of useful) {
    const detail = clean(line.text).match(/\b(DR-?\d{2,5})\s*CL\s*[- ]\s*[A-Z]{1,5}\b/);
    if (detail) stems.add(codeKey(detail[1]));
  }
  return items.filter(item => {
    if (item.brand !== 'Brother' || preciseDrums.includes(item)) return true;
    const code = codeKey(item.code);
    return ![...stems].some(stem => code.startsWith(stem) && /^(?:[C06][L1I]?|L)?$/.test(code.slice(stem.length)));
  });
}

// Live scans have no confirmation step. A complete, legible reference must be read
// on consecutive camera frames before the catalogue is asked for an exact match.
export function liveLabelCandidate(lines: LabelLine[], privateCodes: Set<string>): LabelCandidate | undefined {
  let candidates = labelCandidates(lines, privateCodes);
  if (candidates.length > 1) {
    // HP frequently prints both CE285A and 85A on the same box.
    const long = candidates.filter(item => item.brand === 'HP' && item.kind === 'supply' && hpOem.test(item.code));
    if (long.length !== 1 || !candidates.every(item => item === long[0] ||
      (item.brand === 'HP' && item.kind === 'supply' && /^\d{2,3}[AX]$/.test(item.code) && long[0].code.endsWith(item.code)))) return;
    candidates = long;
  }
  const item = candidates[0];
  if (!item || item.certain) return item;
  if (printedTonerCodes(item.code).length > 1) return item;
  const explicitBrand = labelBrands(lines).includes(item.brand.toUpperCase());
  // An HP box often shows just “106A” in large print. A bare short code needs
  // three clear readings AND an unambiguous full manufacturer code in the shop.
  const bareHP = !explicitBrand && item.brand === 'HP' && item.kind === 'supply' && /^\d{2,3}[AX]$/.test(item.code);
  if (bareHP) {
    const legible = lines.some(line => !privateLine.test(line.text) && tokens(line.text).includes(item.code)
      && (line.words?.find(word => codeKey(word.text) === item.code)?.confidence ?? line.confidence) >= 90);
    return legible ? { ...item, requiresPairing: true } : undefined;
  }
  const hasClearCode = lines.some(line => {
    if (privateLine.test(line.text)) return false;
    const productNumber = clean(line.text).match(productNumberField)?.[1];
    if (productNumber && hpPrinterNumbers.get(productNumber) === item.code && item.kind === 'printer') {
      // A known six-character HP number in its own named field is still
      // verified on three separate frames, even on a faint regulatory plate.
      return (line.words?.find(word => codeKey(word.text) === productNumber)?.confidence ?? line.confidence) >= 50;
    }
    const target = codeKey(item.code);
    const distinctivePrinter = item.kind === 'printer' && /^(?:DCP|MFC|HL|MF|LBP|ET|XP|WF)-?[A-Z]?\d/.test(item.code);
    const distinctiveSupply = item.kind === 'supply' && /^(?:TN|DR|LC|GI|PGI|CLI|CRG|PFI|TK|C13[TS])[-A-Z]*\d{2,}/.test(item.code);
    const confidence = line.words?.find(word => codeKey(word.text) === target)?.confidence ?? line.confidence;
    if (item.kind === 'printer' && sharedPrinterModel.test(item.code) && tokens(line.text).includes(item.code)) return confidence >= 50;
    return (explicitBrand || distinctivePrinter || distinctiveSupply) && tokens(line.text).some(token => codeKey(token) === target)
      && confidence >= (distinctivePrinter || distinctiveSupply ? 76 : 85);
  });
  return hasClearCode ? item : undefined;
}

export function liveLabelOptions(lines: LabelLine[], privateCodes: Set<string>): LabelCandidate[] {
  if (hasSplitSupplyLabel(lines)) {
    const candidates = labelCandidates(lines, privateCodes);
    for (const line of visibleLabelLines(lines, privateCodes)) {
      const pair = printedBrandPair(line.text);
      if (!pair || line.confidence < 55) continue;
      const options = pair.map(code => candidates.find(item => item.kind === 'supply' && item.code === code));
      if (options[0] && options[1]) return [options[0], options[1]];
    }
    return [];
  }
  const one = liveLabelCandidate(lines, privateCodes);
  return one ? [one] : [];
}

// Each reading is an independent interpretation of the same row. Present exact alternatives
// for confirmation and honour a private field detected by either reading.
export function selectedLabelCandidates(passes: LabelLine[][], privateCodes: Set<string>, previousBrands: string[]) {
  for (const lines of passes) visibleLabelLines(lines, privateCodes);
  const candidates = new Map<string, LabelCandidate>();
  for (const lines of passes) {
    for (const item of labelCandidates(lines, privateCodes, previousBrands)) {
      candidates.set(item.kind + ':' + item.brand + ':' + codeKey(item.code), { ...item, certain: false });
    }
  }
  return [...candidates.values()];
}

export type CatalogLink = { title: string; url: string; price?: number; brand?: string; oem?: string };
export type LabelOffers = { printers?: CatalogLink[]; products?: CatalogLink[]; warning?: string };

// Search suggestions can include related families. The scan accepts only complete references.
// A correctly read family may still have several incompatible colour variants.
export function drumNeedsSuffix(candidate: LabelCandidate, response: LabelOffers) {
  if (candidate.brand !== 'Brother' || !/^DR-?\d{2,5}(?:CL)?$/.test(candidate.code)) return false;
  const family = codeKey(candidate.code);
  return (response.products || []).some(item => {
    if (!/\bBrother\b/i.test(item.title)) return false;
    return tokens(item.title + ' ' + (item.oem || '')).some(token => {
      const article = codeKey(token);
      return article.startsWith(family) && /^(?:CL)?(?:CMYK?|BK|[CMY])$/.test(article.slice(family.length));
    });
  });
}

export function exactLabelOffers(candidate: LabelCandidate, response: LabelOffers): CatalogLink[] {
  const printer = candidate.kind === 'printer';
  const allowedPath = printer ? /^\/tlaciarne\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i : /^\/produkt\/[a-z0-9-]+\/?$/i;
  const result = (printer ? response.printers : response.products) || [];
  const target = codeKey(candidate.code);
  const printed = candidate.brand === 'Brother' && !printer ? printedTonerCodes(candidate.code) : [];
  const seen = new Set<string>();
  return result.filter(item => {
    if (!item?.title || !allowedPath.test(item.url) || seen.has(item.url)) return false;
    const brands = clean(item.title).match(brandPattern) || [];
    if (candidate.brand) {
      if (![...brands, (item.brand || '').toUpperCase()].includes(candidate.brand.toUpperCase())) return false;
    } else if (!printer || !sharedPrinterModel.test(candidate.code) || !brands.length) return false;
    const identities = tokens(item.title + (printer ? '' : ' ' + (item.oem || '')));
    const matches = printed.length ? matchesPrintedToner(printed, item.title, item.oem || '') : identities.some((code, position) => {
      const key = codeKey(printer && identities[position + 1] === 'PLUS' ? code + 'PLUS' : code);
      if (key === target) return true;
      return !printer && candidate.brand === 'Canon' && /^\d{3}/.test(target)
        && key.replace(/^(?:CRG|PGI|CLI|PG|CL|GI|PFI)/, '') === target;
    });
    if (!matches) return false;
    seen.add(item.url);
    return true;
  });
}

// Short HP names (for example 85A) are often printed larger than the OEM code.
// Enrich their offers only when a single-cartridge catalogue entry explicitly pairs both.
export function hpOrderCode(candidate: LabelCandidate, exactOffers: CatalogLink[]): string | undefined {
  if (candidate.brand !== 'HP' || candidate.kind !== 'supply' || !/^\d{2,3}[AX]$/.test(candidate.code)) return;
  const codes = new Set<string>();
  for (const offer of exactOffers) {
    if (/\b(?:dual|pack|balenie|sada)\b|\b[2-9]\s*(?:ks|x)\b/i.test(offer.title)) continue;
    for (const code of tokens(offer.title)) if (hpOem.test(code)) codes.add(code);
  }
  if (codes.size === 1) return [...codes][0];
}
