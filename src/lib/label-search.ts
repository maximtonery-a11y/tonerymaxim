// Only manufacturer references leave the device. Keep the entire suffix throughout matching.
export type LabelLine = { text: string; confidence: number; words?: { text: string; confidence: number }[] };
export type LabelCandidate = { brand: string; code: string; kind: 'printer' | 'supply'; certain: boolean };
type Rule = { kind: LabelCandidate['kind']; brand: string; pattern: RegExp };

const printerFamilies = [
  { brand: 'HP', name: /\b(?:LASERJET|DESKJET|OFFICEJET|DESIGNJET|ENVY|SMART TANK|HP (?:COLOR )?LASER)\b/i, number: /^(?:\d{4}[A-Z]{0,4}|\d{3}(?:W|WE|NW|NWE|FNW|FDW))$/ },
  { brand: 'Xerox', name: /\b(?:WORKCENTRE|PHASER|VERSALINK|ALTALINK)\b/i, number: /^[BC]?\d{3,4}[A-Z]{0,3}$/ },
  { brand: 'Samsung', name: /\b(?:XPRESS|PROXPRESS|SAMSUNG)\b/i, number: /^(?:(?:SL-)?[CMX]|SCX-|ML-)\d{3,5}[A-Z]{0,4}$/ },
  { brand: 'Kyocera', name: /\b(?:ECOSYS|TASKALFA)\b/i, number: /^(?:[MP][A-Z]?-?)?\d{3,5}[A-Z]{0,4}$/ },
];
const hpOem = /^(?:C[BEFH]\d{3}|[CQW]\d{4}|[A-Z]\d[A-Z]\d{2})[A-Z]{1,3}$/;
const rules: Rule[] = [
  { kind: 'supply', brand: 'HP', pattern: hpOem },
  { kind: 'supply', brand: 'Brother', pattern: /^(?:TN|DR|LC|BT|WT)-?[A-Z]?\d{2,5}[A-Z0-9]{0,5}$/ },
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
const brandPattern = /\b(HP|BROTHER|CANON|EPSON|KYOCERA|XEROX|SAMSUNG)\b/gi;
const privateLine = /\b(?:S\s*\/\s*N|SN|SERIAL|SERI[AO]V[EÉ]|IMEI|MAC|PASSWORD|HESLO|WIFI|WI-FI|REGULATORY|RMN|EAN|UPC|GTIN)\b/i;
const codeKey = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
const clean = (text: string) => text.toUpperCase().replace(/[‐‑‒–—−]/g, '-');
const codePrefix = /\b(DCP|MFC|HL|TN|DR|LC|BT|WT|CLI|PGI|GI|CL|PG|CRG|PFI|TK|MLT|CLT|ET|XP|WF|LBP)\s*-?\s+([A-Z]?\d)/g;
const separateSuffix = /\b((?:(?:PGI|CLI|PG|CL|GI|LC|TN)-?\d{2,5}|\d{3}))\s+(XXL|XL|PGBK|BK|[CMY])\b/g;
function tokens(text: string): string[] {
  return clean(text).replace(codePrefix, '$1-$2').replace(separateSuffix, '$1$2')
    .match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || [];
}

export function labelBrands(lines: LabelLine[]): string[] {
  const brands = new Set(lines.flatMap(line => clean(line.text).match(brandPattern) || []));
  const context = lines.map(line => line.text).join(' ');
  for (const family of printerFamilies) if (family.name.test(context)) brands.add(family.brand.toUpperCase());
  if (/\bJETINTELLIGENCE\b/i.test(context)) brands.add('HP');
  if (/\b(?:PIXMA|MAXIFY)\b/i.test(context)) brands.add('CANON');
  if (/\bECOTANK\b/i.test(context)) brands.add('EPSON');
  return [...brands];
}

// The full-frame pass also protects references seen beside serial numbers during a later crop.
export function labelCandidates(lines: LabelLine[], privateCodes = new Set<string>(), previousBrands: string[] = []): LabelCandidate[] {
  const found = new Map<string, LabelCandidate>();
  const brands = new Set([...labelBrands(lines), ...previousBrands]);
  const context = lines.map(line => line.text).join(' ');
  const family = printerFamilies.find(family => brands.size === 1 && brands.has(family.brand.toUpperCase())
    && (family.name.test(context) || previousBrands.includes(family.brand.toUpperCase())));
  const packageLabel = /\b(?:TONER|CARTRIDGES?|CARTOUCHES?|DUAL PACK|DRUM UNIT|PRINT CARTRIDGE|FOR USE WITH)\b/i.test(context);
  let privateValueOnNextLine = false;
  const useful: LabelLine[] = [];
  for (const line of lines.slice(0, 100)) {
    const text = line.text.trim();
    if (!text) continue;
    if (privateLine.test(text)) {
      for (const token of tokens(text)) privateCodes.add(codeKey(token));
      privateValueOnNextLine = /(?:S\s*\/\s*N|SN|SERIAL(?:\s+(?:NUMBER|NO\.?))?|PASSWORD|MAC|RMN|EAN|UPC|GTIN)\s*[:#-]?$/i.test(text);
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
  for (const [index, line] of useful.entries()) {
    let text = line.text;
    // Canon sometimes prints the family number and its ink colour on separate lines.
    const below = useful[index + 1]?.text.trim() || '';
    if (brands.has('CANON') && /^\d{3}$/.test(text.trim()) && /^(?:PGBK|BK|[CMY]|XX?L)$/i.test(below)) {
      text = text.trim() + below;
    }
    for (const token of tokens(text)) {
      if (privateCodes.has(codeKey(token))) continue;
      const rule = rules.find(rule => rule.pattern.test(token));
      const shortHP = (!brands.size || brands.has('HP')) && (/^\d{2,3}(?:[AX]|XL)$/.test(token)
        || (/^\d{2,3}$/.test(token) && new RegExp('\\bHP\\s+' + token + '\\b', 'i').test(text)));
      const shortCanon = brands.has('CANON') && /^\d{3}(?:XXL|XL|PGBK|BK|[HCMY])?$/.test(token);
      const shortEpson = brands.has('EPSON') && /^\d{3}(?:XL)?$/.test(token);
      const numberedPrinter = !packageLabel && family && family.number.test(token)
        && !/^(?:19|20)\d{2}$/.test(token)
        && (!/^\d+$/.test(token) || family.name.test(text)
          || (text.trim() === token && family.name.test(useful[index - 1]?.text || '')));
      if (!rule && !shortHP && !shortCanon && !shortEpson && !numberedPrinter) continue;
      const brand = numberedPrinter ? family.brand : rule?.brand || (shortCanon ? 'Canon' : shortEpson ? 'Epson' : 'HP');
      const kind = numberedPrinter ? 'printer' : rule?.kind || 'supply';
      if (kind === 'printer' && packageLabel) continue;
      const word = line.words?.find(word => codeKey(word.text) === codeKey(token));
      const confidence = word?.confidence ?? line.confidence;
      const brandAgrees = brands.size === 1 ? brands.has(brand.toUpperCase()) : !brands.size && kind === 'supply';
      if (brands.size && !brands.has(brand.toUpperCase())) continue;
      const key = kind + ':' + brand + ':' + codeKey(token);
      const candidate = { brand, code: token, kind, certain: !shortHP && !shortCanon && !shortEpson && brandAgrees && confidence >= 85 };
      if (!found.has(key) || candidate.certain) found.set(key, candidate);
    }
  }
  return [...found.values()];
}

export type CatalogLink = { title: string; url: string; price?: number; brand?: string; oem?: string };
export type LabelOffers = { printers?: CatalogLink[]; products?: CatalogLink[]; warning?: string };

// Search suggestions can include related families. The scan accepts only complete references.
export function exactLabelOffers(candidate: LabelCandidate, response: LabelOffers): CatalogLink[] {
  const printer = candidate.kind === 'printer';
  const allowedPath = printer ? /^\/tlaciarne\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i : /^\/produkt\/[a-z0-9-]+\/?$/i;
  const result = (printer ? response.printers : response.products) || [];
  const target = codeKey(candidate.code);
  const seen = new Set<string>();
  return result.filter(item => {
    if (!item?.title || !allowedPath.test(item.url) || seen.has(item.url)) return false;
    const brands = clean(item.title).match(brandPattern) || [];
    if (![...brands, (item.brand || '').toUpperCase()].includes(candidate.brand.toUpperCase())) return false;
    const identities = tokens(item.title + (printer ? '' : ' ' + (item.oem || '')));
    const matches = identities.some(code => {
      const key = codeKey(code);
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
