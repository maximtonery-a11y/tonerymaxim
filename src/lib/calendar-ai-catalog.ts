import fallbackCalendarRows from '../data/calendar-products.json' with { type: 'json' };

const CALENDAR_SOURCE = 'kalendare-2027';
const DEFAULT_URL = 'https://www.tonerymaxim.sk/kalendare/api/products';

type CalendarRow = Record<string, any>;
type CachedRows = { expires: number; rows: CalendarRow[] };

let cache: CachedRows | null = null;
let inFlight: Promise<CalendarRow[]> | null = null;
let lastWarningAt = 0;

function bundledRows() {
  return (Array.isArray(fallbackCalendarRows) ? fallbackCalendarRows : [])
    .filter((row: any) => row && row.sku && row.name) as CalendarRow[];
}

const normalize = (value: unknown) => String(value || '').toLocaleLowerCase('sk-SK')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function endpoint() {
  return String(process.env.CALENDAR_PRODUCTS_URL || (import.meta as any).env?.CALENDAR_PRODUCTS_URL || DEFAULT_URL).trim();
}

function refreshRows() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(endpoint(), { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Calendar feed HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error('Calendar feed is not an array');
      const rows = payload.filter((row) => row && row.sku && row.name);
      if (!rows.length) throw new Error('Calendar feed contains no valid products');
      cache = { expires: Date.now() + 5 * 60_000, rows };
      return rows;
    } catch (error: any) {
      const rows = cache?.rows?.length ? cache.rows : bundledRows();
      // Pri poruche živého feedu skúšame zdroj znovu po minúte. Záložný
      // katalóg zabráni HTTP 500, ale nič v ňom neupravujeme ani nedohadujeme.
      cache = { expires: Date.now() + 60_000, rows };
      if (Date.now() - lastWarningAt > 60_000) {
        lastWarningAt = Date.now();
        console.warn('[AI Tomas calendars] Live feed unavailable, using bundled fallback:', error?.message || error);
      }
      return rows;
    } finally {
      clearTimeout(timeout);
      inFlight = null;
    }
  })();
  return inFlight;
}

async function loadRows() {
  if (cache && cache.expires > Date.now()) return cache.rows;

  // AI odpovie okamžite z posledného overeného/zabudovaného katalógu a živý
  // katalóg obnoví na pozadí. Pomalý kalendárový endpoint tak nezdrží chat.
  const rows = cache?.rows?.length ? cache.rows : bundledRows();
  cache = { expires: Date.now() + 60_000, rows };
  void refreshRows();
  return rows;
}

export function isCalendarQuery(query: string) {
  const n = normalize(query);
  return /\b(kalendar|kalendare|kalendara|kalendary|diar|diare|minidiar|planovac|pf|novorocn)\w*\b/.test(n)
    || /\b(nastenn|stolov|trojmesac|trojspiral|rodinn|pracovn)\w*\b/.test(n) && /\b202[6-9]\b/.test(n);
}

function imageUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `/kalendare${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function asProduct(row: CalendarRow) {
  const inStock = row?.availability?.inStock === true;
  return {
    id: `calendar:${row.sku}`,
    sku: String(row.sku),
    name: String(row.name),
    price: Number(row.price || 0),
    stock_status: inStock ? 'instock' : 'outofstock',
    stock_quantity: null,
    type: 'calendar',
    product_type_key: 'calendar',
    product_type_label: String(row.category || 'Kalendár 2027'),
    image: imageUrl(row.gallery?.[0] || row.image),
    url: `/kalendare/produkt/${encodeURIComponent(String(row.slug || ''))}`,
    slug: String(row.slug || ''),
    color: '',
    capacity: String(row.format || ''),
    compatible_printers: [],
    purchasable: inStock && Number(row.price || 0) > 0,
    source: CALENDAR_SOURCE,
    category: String(row.category || ''),
    description: String(row.description || ''),
    technical_info: String(row.technical_info || ''),
    print_info: String(row.print_info || ''),
    price_tiers: Array.isArray(row.price_tiers) ? row.price_tiers : [],
  };
}

export async function searchCalendarProducts(query: string) {
  const rows = await loadRows();
  const n = normalize(query);
  const ignored = new Set(['ake','aky','aku','mate','predavate','ponukate','ponuke','sortiment','chcem','hladam','potrebujem','kalendar','kalendare','kalendara','diar','diare','diara','prosim','ukaz','mi','v','vo','na','do','pre','s','so','a','aj','alebo']);
  const aliases: Record<string, string> = { psami: 'psy', psov: 'psy', psiky: 'psy', mackami: 'macky', maciek: 'macky', tatrach: 'tatry' };
  const canonicalToken = (token: string) => {
    const aliased = aliases[token] || token;
    if (/^tyzden/.test(aliased)) return 'tyzden';
    if (/^mesac/.test(aliased)) return 'mesac';
    if (/^denn/.test(aliased)) return 'denn';
    if (/^minidiar/.test(aliased)) return 'minidiar';
    if (/^nastenn/.test(aliased)) return 'nastenn';
    if (/^stolov/.test(aliased)) return 'stolov';
    if (/^prirod/.test(aliased)) return 'prirod';
    return aliased;
  };
  const tokens = n.split(' ').filter((token) => token.length > 1 && !ignored.has(token) && !/^202[6-9]$/.test(token)).map(canonicalToken);
  const generic = tokens.length === 0 || tokens.every((token) => /^202[6-9]$/.test(token));
  const wantsDiary = /\b(?:diar|diare|minidiar)\w*\b/.test(n);
  const wantsNature = tokens.includes('prirod');
  const isNatureTheme = (row: CalendarRow) => /\b(slovensko|tatry|polovnik|kvety|rozkvitnut|luka|hory|more|krajina|pobrezie|huby|rybarsk)\w*\b/.test(normalize(row.name));
  const scopedRows = wantsDiary
    ? rows.filter((row) => /\b(?:diar|minidiar)\w*\b/.test(normalize(`${row.name} ${row.category || ''}`)))
    : wantsNature ? rows.filter(isNatureTheme) : rows;
  const scored = scopedRows.map((row) => {
    const identity = normalize(`${row.name} ${row.sku} ${row.category} ${row.variant || ''} ${row.format || ''}`);
    const detail = normalize(`${identity} ${row.description || ''} ${row.technical_info || ''} ${row.print_info || ''}`);
    let score = generic ? 20 : 0;
    let missed = 0;
    let identityMissed = 0;
    for (const token of tokens) {
      if (token === 'prirod' && isNatureTheme(row)) score += 70;
      else if (normalize(row.sku) === token) score += 300;
      else if (identity.includes(token)) score += 70;
      else {
        identityMissed += 1;
        if (detail.includes(token)) score += 25;
        else missed += 1;
      }
    }
    if (row?.availability?.inStock === true) score += 8;
    return { row, score, missed, identityMissed };
  }).filter((item) => generic || (item.score > 0 && item.missed === 0))
    .sort((a, b) => b.score - a.score || Number(a.row.price || 0) - Number(b.row.price || 0));

  // Ak názov/SKU/kategória obsahuje všetky hľadané výrazy, neprimiešavame
  // produkty, kde sa slovo objavilo iba v marketingovom popise (napr.
  // „Slovensko“ v popise PF pohľadnice).
  const strict = !generic ? scored.filter((item) => item.identityMissed === 0) : [];
  const relevant = strict.length ? strict : scored;

  const selected = generic
    ? [...new Map(relevant.map((item) => [String(item.row.category || ''), item])).values()].slice(0, 12)
    : relevant.slice(0, 40);
  return { products: selected.map((item) => asProduct(item.row)), source: 'calendar' as const };
}

export const calendarCatalogSource = CALENDAR_SOURCE;

// Používa sa iba v izolovaných regresných testoch poruchových stavov.
export function resetCalendarCatalogForTests() {
  cache = null;
  inFlight = null;
  lastWarningAt = 0;
}
