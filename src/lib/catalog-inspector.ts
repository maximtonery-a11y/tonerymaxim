import { getProductsCache, normalize, stripHtml, type TmProduct } from './tm-products-cache';

export type CatalogIssueSeverity = 'critical' | 'important' | 'content' | 'logical';

export type CatalogIssue = {
  severity: CatalogIssueSeverity;
  code: string;
  label: string;
  message: string;
  productId: string;
  sku: string;
  name: string;
  slug: string;
  detailUrl: string;
};

export type CatalogInspection = {
  generatedAt: string;
  cacheGeneratedAt: string;
  totalProducts: number;
  durationMs: number;
  issues: CatalogIssue[];
  counts: Record<CatalogIssueSeverity, number>;
  productsWithIssues: number;
  rules: Array<{ code: string; label: string; severity: CatalogIssueSeverity; count: number }>;
};

const SEVERITIES: CatalogIssueSeverity[] = ['critical', 'important', 'content', 'logical'];
const PLACEHOLDER_IMAGE_MARKERS = ['tm-product-placeholder', 'tm-ink-placeholder', 'no-image', 'image-placeholder', 'image-coming-soon'];
const PLACEHOLDER_TEXT = ['bude doplnen', 'doplnime', 'neuvedene', 'pripravujeme', 'coming soon'];
const GRAMMAR_PATTERNS: Array<[RegExp, string]> = [
  [/renovovan[eé]ho\s+toner\b/i, 'Nesprávny tvar „renovovaného toner“ (má byť „tonera“).'],
  [/renovovan[eé]ho\s+valec\b/i, 'Nesprávny tvar „renovovaného valec“ (má byť „valca“).'],
  [/kompatibiln[eé]ho\s+toner\b/i, 'Nesprávny tvar „kompatibilného toner“ (má byť „tonera“).'],
];

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compact(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]+/g, '');
}

function attributeValues(product: TmProduct, names: string[]) {
  const wanted = new Set(names.map(compact));
  const attrs = Array.isArray(product?.attributes_all)
    ? product.attributes_all
    : Array.isArray(product?.attributes)
      ? product.attributes
      : [];
  const values: string[] = [];
  for (const attr of attrs) {
    const key = compact(attr?.slug || attr?.name || '');
    if (!wanted.has(key)) continue;
    const raw = Array.isArray(attr?.values) ? attr.values : [attr?.value];
    for (const item of raw) {
      const clean = text(item);
      if (clean) values.push(clean);
    }
  }
  return [...new Set(values)];
}

function productText(product: TmProduct) {
  return `${text(product?.name)} ${stripHtml(product?.short_description_html)} ${stripHtml(product?.description_html)}`.trim();
}

function isPrintableSupply(product: TmProduct) {
  const haystack = normalize(`${product?.name || ''} ${product?.product_type_key || ''} ${product?.search_text || ''}`);
  return /toner|atrament|ink|napln|kazet|cartridge/.test(haystack);
}

function hasValidImage(product: TmProduct) {
  const image = text(product?.image || product?.images?.[0]);
  if (!image) return false;
  if (image.startsWith('/')) return true;
  try {
    const parsed = new URL(image);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function issue(product: TmProduct, severity: CatalogIssueSeverity, code: string, label: string, message: string): CatalogIssue {
  return {
    severity,
    code,
    label,
    message,
    productId: text(product?.id),
    sku: text(product?.sku),
    name: text(product?.name) || '(bez názvu)',
    slug: text(product?.slug),
    detailUrl: text(product?.detail_url) || (product?.slug ? `/novy/produkt/${product.slug}` : ''),
  };
}

function pushDuplicateIssues(products: TmProduct[], issues: CatalogIssue[], keyName: 'sku' | 'slug') {
  const groups = new Map<string, TmProduct[]>();
  for (const product of products) {
    const raw = text(product?.[keyName]);
    if (!raw) continue;
    const key = compact(raw);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(product);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const joined = list.map((p) => `${text(p.sku) || 'bez SKU'} / ${text(p.name)}`).join(' | ');
    for (const product of list) {
      issues.push(issue(product, 'critical', `duplicate_${keyName}`, `Duplicitný ${keyName.toUpperCase()}`, `Rovnakú hodnotu používa ${list.length} produktov: ${joined}`));
    }
  }
}

export async function inspectCatalog(): Promise<CatalogInspection> {
  const started = performance.now();
  const cache = await getProductsCache();
  const products = Array.isArray(cache?.products) ? cache.products : [];
  const issues: CatalogIssue[] = [];

  const descriptionGroups = new Map<string, TmProduct[]>();
  for (const product of products) {
    const fullDescription = stripHtml(product?.description_html);
    const descriptionKey = compact(fullDescription);
    if (descriptionKey.length >= 120) {
      const list = descriptionGroups.get(descriptionKey) || [];
      list.push(product);
      descriptionGroups.set(descriptionKey, list);
    }
  }

  for (const product of products) {
    const name = text(product?.name);
    const sku = text(product?.sku);
    const slug = text(product?.slug);
    const detailUrl = text(product?.detail_url);
    const image = text(product?.image || product?.images?.[0]);
    const price = Number(product?.price);
    const regularPrice = Number(product?.regular_price);
    const salePrice = Number(product?.sale_price);
    const stockQty = product?.stock_quantity;
    const description = stripHtml(product?.description_html);
    const shortDescription = stripHtml(product?.short_description_html);
    const combined = productText(product);
    const combinedNormalized = normalize(combined);
    const categories = Array.isArray(product?.categories) ? product.categories.filter(Boolean) : [];
    const printers = Array.isArray(product?.compatible_printers)
      ? product.compatible_printers.filter(Boolean)
      : Array.isArray(product?.printers) ? product.printers.filter(Boolean) : [];
    const oem = attributeValues(product, ['oem', 'mpn', 'kodvyrobcu', 'originalnykod']);
    const brand = attributeValues(product, ['vyrobcatlaciarne', 'vyrobca', 'brand', 'znacka']);
    const color = text(product?.color || product?.farba || attributeValues(product, ['farba', 'color'])[0]);
    const capacity = text(product?.capacity || product?.kapacita || product?.yield || product?.page_yield || attributeValues(product, ['vytaznost', 'kapacita', 'yield'])[0]);

    if (!text(product?.id)) issues.push(issue(product, 'critical', 'missing_id', 'Chýba ID', 'Produkt nemá interné ID.'));
    if (!sku) issues.push(issue(product, 'critical', 'missing_sku', 'Chýba SKU', 'Produkt nemá SKU.'));
    if (!name) issues.push(issue(product, 'critical', 'missing_name', 'Chýba názov', 'Produkt nemá názov.'));
    if (!slug) issues.push(issue(product, 'critical', 'missing_slug', 'Chýba slug', 'Produkt nemá URL slug.'));
    if (!detailUrl) issues.push(issue(product, 'critical', 'missing_detail_url', 'Chýba detail URL', 'Produkt nemá odkaz na detail.'));
    if (!Number.isFinite(price) || price <= 0) issues.push(issue(product, 'critical', 'invalid_price', 'Neplatná cena', `Cena je „${text(product?.price) || 'prázdna'}“.`));
    if (!image) issues.push(issue(product, 'critical', 'missing_image', 'Chýba obrázok', 'Produkt nemá obrázok.'));
    else if (!hasValidImage(product)) issues.push(issue(product, 'critical', 'invalid_image_url', 'Neplatná URL obrázka', image));
    if (typeof stockQty === 'number' && stockQty < 0) issues.push(issue(product, 'critical', 'negative_stock', 'Záporný sklad', `Skladové množstvo: ${stockQty}.`));

    if (!categories.length) issues.push(issue(product, 'important', 'missing_category', 'Chýba kategória', 'Produkt nie je zaradený do kategórie.'));
    if (!oem.length) issues.push(issue(product, 'important', 'missing_oem', 'Chýba OEM/MPN', 'Nie je uvedený originálny kód výrobcu.'));
    if (!brand.length) issues.push(issue(product, 'important', 'missing_brand', 'Chýba výrobca', 'Nie je uvedený výrobca tlačiarne alebo značka.'));
    if (!text(product?.product_type_key) || product?.product_type_key === 'product') issues.push(issue(product, 'important', 'missing_product_type', 'Neurčený typ produktu', 'Produkt nie je rozpoznaný ako kompatibilný, originálny alebo renovovaný.'));
    if (!printers.length) issues.push(issue(product, 'important', 'missing_compatibility', 'Chýba kompatibilita', 'Nie sú uvedené kompatibilné modely tlačiarní.'));
    if (isPrintableSupply(product) && !capacity) issues.push(issue(product, 'important', 'missing_capacity', 'Chýba výťažnosť', 'Toner alebo atrament nemá uvedenú kapacitu/výťažnosť.'));
    if (isPrintableSupply(product) && !color) issues.push(issue(product, 'important', 'missing_color', 'Chýba farba', 'Toner alebo atrament nemá uvedenú farbu.'));
    if (!description) issues.push(issue(product, 'important', 'missing_description', 'Chýba hlavný popis', 'Produkt nemá hlavný popis.'));
    if (!shortDescription) issues.push(issue(product, 'important', 'missing_short_description', 'Chýba krátky popis', 'Produkt nemá krátky popis.'));

    if (description && description.length < 140) issues.push(issue(product, 'content', 'short_description_text', 'Príliš krátky hlavný popis', `Hlavný popis má iba ${description.length} znakov.`));
    for (const marker of PLACEHOLDER_TEXT) {
      if (combinedNormalized.includes(normalize(marker))) {
        issues.push(issue(product, 'content', 'placeholder_text', 'Dočasný alebo neúplný text', `Text obsahuje výraz „${marker}“.`));
        break;
      }
    }
    for (const [pattern, message] of GRAMMAR_PATTERNS) {
      if (pattern.test(combined)) issues.push(issue(product, 'content', 'grammar_template', 'Gramatická chyba šablóny', message));
    }
    if (description && /(?:\bna\s+Tone(?:ry)?|\bn\.{2,}|…)$/.test(description.trim())) {
      issues.push(issue(product, 'content', 'truncated_description', 'Pravdepodobne orezaný popis', `Koniec popisu: „${description.slice(-90)}“`));
    }
    if (image && PLACEHOLDER_IMAGE_MARKERS.some((marker) => normalize(image).includes(normalize(marker)))) {
      issues.push(issue(product, 'content', 'placeholder_image', 'Zástupný obrázok', 'Produkt používa všeobecný zástupný obrázok.'));
    }

    const nameNormalized = normalize(name);
    if (!capacity && /\b\d{2,5}\s*(?:stran|strany|pages?)\b|\b\d+(?:[.,]\d+)?\s*k\b/.test(nameNormalized)) {
      issues.push(issue(product, 'logical', 'capacity_in_name_only', 'Výťažnosť je iba v názve', 'Názov obsahuje pravdepodobnú výťažnosť, ale samostatný údaj je prázdny.'));
    }
    if (!color && /\b(black|cyan|magenta|yellow|cierna|cierny|azurova|purpurova|zlta|modra|cervena)\b/.test(nameNormalized)) {
      issues.push(issue(product, 'logical', 'color_in_name_only', 'Farba je iba v názve', 'Názov obsahuje farbu, ale samostatný údaj je prázdny.'));
    }
    if (Number.isFinite(salePrice) && salePrice > 0 && Number.isFinite(regularPrice) && regularPrice > 0 && salePrice >= regularPrice) {
      issues.push(issue(product, 'logical', 'invalid_sale_price', 'Akciová cena nie je nižšia', `Bežná cena ${regularPrice}, akciová cena ${salePrice}.`));
    }
    if (product?.stock_status === 'outofstock' && typeof stockQty === 'number' && stockQty > 0) {
      issues.push(issue(product, 'logical', 'stock_status_mismatch', 'Nesúlad skladu', `Stav je „outofstock“, ale množstvo je ${stockQty}.`));
    }
  }

  pushDuplicateIssues(products, issues, 'sku');
  pushDuplicateIssues(products, issues, 'slug');

  for (const list of descriptionGroups.values()) {
    if (list.length < 5) continue;
    for (const product of list) {
      issues.push(issue(product, 'content', 'duplicate_description', 'Duplicitný hlavný popis', `Rovnaký popis používa ${list.length} produktov.`));
    }
  }

  issues.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.label.localeCompare(b.label, 'sk') || a.name.localeCompare(b.name, 'sk'));
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, issues.filter((item) => item.severity === severity).length])) as Record<CatalogIssueSeverity, number>;
  const productKeys = new Set(issues.map((item) => item.productId || item.sku || item.slug || item.name));
  const ruleMap = new Map<string, { code: string; label: string; severity: CatalogIssueSeverity; count: number }>();
  for (const item of issues) {
    const current = ruleMap.get(item.code) || { code: item.code, label: item.label, severity: item.severity, count: 0 };
    current.count += 1;
    ruleMap.set(item.code, current);
  }

  return {
    generatedAt: new Date().toISOString(),
    cacheGeneratedAt: text(cache?.generated_at),
    totalProducts: products.length,
    durationMs: Math.round((performance.now() - started) * 10) / 10,
    issues,
    counts,
    productsWithIssues: productKeys.size,
    rules: [...ruleMap.values()].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.count - a.count),
  };
}

export function filterCatalogIssues(issues: CatalogIssue[], options: { severity?: string; rule?: string; query?: string }) {
  const severity = text(options.severity);
  const rule = text(options.rule);
  const query = normalize(options.query || '');
  return issues.filter((item) => {
    if (severity && severity !== 'all' && item.severity !== severity) return false;
    if (rule && rule !== 'all' && item.code !== rule) return false;
    if (query) {
      const haystack = normalize(`${item.name} ${item.sku} ${item.slug} ${item.label} ${item.message}`);
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
