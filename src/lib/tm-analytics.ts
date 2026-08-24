import { appendFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { decryptPrivateLine, encryptPrivateLine, persistenceSecret, TM_DATA_ROOT } from './secure-persistence.ts';

export type TMAnalyticsEvent = {
  type: string;
  ts: string;
  path: string;
  url?: string;
  title?: string;
  referrer?: string;
  durationMs?: number;
  activeMs?: number;
  viewport?: string;
  device?: string;
  language?: string;
  userAgent?: string;
  source?: string;
  country?: string;
  region?: string;
  city?: string;
  search?: string;
  product?: string;
  value?: number;
  meta?: Record<string, unknown>;
  sessionId: string;
  visitorId?: string;
  owner?: boolean;
  ipHash?: string;
};

export type TMVisit = {
  sessionId: string;
  visitorId: string;
  owner: boolean;
  startedAt: string;
  lastSeenAt: string;
  durationMs: number;
  activeMs: number;
  pageviews: number;
  device: string;
  source: string;
  referrer: string;
  userAgent: string;
  browser: string;
  os: string;
  country: string;
  region: string;
  city: string;
  language: string;
  viewport: string;
  landingPage: string;
  exitPage: string;
  returning: boolean;
  googleQuery: string;
  campaign: { source: string; medium: string; campaign: string; term: string; content: string; gclid: string; campaignId:string; adGroupId:string; adId:string; assetId:string; assetGroupId:string; keywordId:string; productId:string; matchType:string; network:string };
  clicks: number;
  maxScroll: number;
  cartAdds: number;
  cartRemoves: number;
  checkoutStarted: boolean;
  orderCompleted: boolean;
  orderNumber: string;
  orderValue: number;
  shipping: string;
  payment: string;
  pages: Array<{ path: string; title: string; enteredAt: string; durationMs: number }>;
  searches: string[];
  products: string[];
  events: TMAnalyticsEvent[];
};

const ANALYTICS_DIR = path.join(TM_DATA_ROOT, 'analytics');
const EVENTS_FILE = path.join(ANALYTICS_DIR, 'events.jsonl');
const MAX_BODY_SIZE = 16_000;
const MAX_READ_BYTES = 24_000_000;
const ONLINE_WINDOW_MS = 90_000;
const SESSION_MAX_MS = 8 * 60 * 60 * 1000;

function cleanText(value: unknown, max = 500): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanPath(value: unknown): string {
  const text = cleanText(value, 1000);
  if (!text.startsWith('/')) return '/';
  try { return new URL(text, 'https://www.tonerymaxim.sk').pathname; } catch { return '/'; }
}
function cleanNumber(value: unknown, max = 86_400_000): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : undefined;
}
function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}
function detectDevice(userAgent: string, viewport = ''): string {
  if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile/i.test(userAgent)) return 'mobile';
  const width = Number(viewport.split('x')[0] || 0);
  return width > 0 && width < 768 ? 'mobile' : width < 1100 && width >= 768 ? 'tablet' : 'desktop';
}
function detectSource(referrer: string, utmSource = ''): string {
  const v = `${referrer} ${utmSource}`.toLowerCase().trim();
  if (!v) return 'direct';
  if (/chatgpt|openai/.test(v)) return 'AI – ChatGPT';
  if (/perplexity/.test(v)) return 'AI – Perplexity';
  if (/copilot|bing\.com\/chat/.test(v)) return 'AI – Copilot';
  if (/gemini|bard\.google/.test(v)) return 'AI – Gemini';
  if (/claude\.ai|anthropic/.test(v)) return 'AI – Claude';
  if (/you\.com|phind|mistral|lechat|meta\.ai|grok|x\.ai/.test(v)) return 'AI – ostatné';
  if (v.includes('google.')) return 'google';
  if (v.includes('facebook.') || v.includes('fb.')) return 'facebook';
  if (v.includes('instagram.')) return 'instagram';
  if (v.includes('bing.')) return 'bing';
  if (v.includes('heureka.')) return 'heureka';
  if (v.includes('tonerymaxim.sk') || v.includes('tonerymaxim.info')) return 'internal';
  return 'referral';
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return 'Iný';
}
function detectOs(ua: string): string {
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Iný';
}
function metaText(event: TMAnalyticsEvent | undefined, key: string): string {
  return cleanText(event?.meta?.[key], 300);
}

function isBot(userAgent: string): boolean {
  return !userAgent || /bot|crawler|spider|slurp|headless|lighthouse|pagespeed|uptime|monitor|curl|wget|python|facebookexternalhit/i.test(userAgent);
}
function requestHeader(request: Request, name: string): string {
  return cleanText(request.headers.get(name), 120);
}

function ipHash(request: Request): string {
  const ip = cleanText(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip'), 80);
  return ip ? createHash('sha256').update(`${ip}|${persistenceSecret()}|analytics`).digest('hex').slice(0, 16) : '';
}

function hasAnalyticsConsent(request: Request): boolean {
  return cookieValue(request, 'tm_analytics_consent') === '1'
    && request.headers.get('x-tm-analytics-consent') === '1';
}

function isSensitivePath(value: unknown): boolean {
  const pathname = cleanPath(value);
  return pathname === '/kosik'
    || pathname === '/pokladna'
    || pathname === '/platba-dokoncena'
    || pathname === '/prihlasenie'
    || pathname === '/registracia'
    || pathname === '/zabudnute-heslo'
    || pathname === '/reset-hesla'
    || pathname.startsWith('/ucet');
}

const SAFE_SENSITIVE_EVENTS = new Set(['pageview','heartbeat','page_duration','scroll','checkout_start','shipping_select','payment_select','order_submit','order_complete','payment_failed']);
function safeSensitiveMeta(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','campaign_id','campaignid','ad_group_id','adgroupid','ad_id','creative','asset_id','assetid','asset_group_id','assetgroupid','keyword_id','keywordid','product_id','productid','matchtype','network','device','order_number','label','value','returning','item_id','item_ids','item_count']) {
    if (source[key] != null) result[key] = cleanText(source[key], key === 'order_number' ? 80 : key === 'item_ids' ? 500 : 300);
  }
  return Object.keys(result).length ? result : undefined;
}

export async function saveAnalyticsEvent(request: Request, payload: unknown): Promise<{ ok: true; ignored?: boolean }> {
  const raw = JSON.stringify(payload ?? {});
  if (raw.length > MAX_BODY_SIZE) throw new Error('Payload je príliš veľký.');
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const sensitive = isSensitivePath(data.path);
  const eventType = cleanText(data.type || 'event', 60) || 'event';
  if (!hasAnalyticsConsent(request) || (sensitive && !SAFE_SENSITIVE_EVENTS.has(eventType))) return { ok: true, ignored: true };
  const userAgent = cleanText(request.headers.get('user-agent'), 500);
  if (isBot(userAgent)) return { ok: true, ignored: true };
  const sessionId = cleanText(data.sessionId, 100);
  if (!sessionId) return { ok: true, ignored: true };
  const referrer = sensitive ? '' : cleanText(data.referrer || request.headers.get('referer'), 700);
  const viewport = cleanText(data.viewport, 40);
  const meta = sensitive ? safeSensitiveMeta(data.meta) : (typeof data.meta === 'object' && data.meta ? data.meta as Record<string, unknown> : undefined);
  const utmSource = cleanText(meta?.utm_source, 120);
  const event: TMAnalyticsEvent = {
    type: eventType,
    ts: new Date().toISOString(),
    path: cleanPath(data.path),
    // Ukladáme iba cestu bez query parametrov. Tie môžu obsahovať e-mail,
    // resetovací token, číslo objednávky alebo identifikátor platby.
    url: cleanPath(data.url || data.path), title: sensitive ? '' : cleanText(data.title, 200), referrer,
    durationMs: cleanNumber(data.durationMs), activeMs: cleanNumber(data.activeMs), viewport,
    device: cleanText(data.device, 40) || detectDevice(userAgent, viewport),
    language: cleanText(data.language, 40), userAgent, source: detectSource(referrer, utmSource),
    country: requestHeader(request, 'cf-ipcountry') || requestHeader(request, 'x-vercel-ip-country') || requestHeader(request, 'x-country-code'),
    region: requestHeader(request, 'x-vercel-ip-country-region') || requestHeader(request, 'x-region'),
    city: requestHeader(request, 'x-vercel-ip-city') || requestHeader(request, 'x-city'),
    search: sensitive ? '' : cleanText(data.search, 200), product: sensitive ? '' : cleanText(data.product, 300),
    value: cleanNumber(data.value, 1_000_000),
    meta,
    sessionId, visitorId: cleanText(data.visitorId, 100), owner: cookieValue(request, 'tm_analytics_owner') === '1', ipHash: ipHash(request),
  };
  await mkdir(ANALYTICS_DIR, { recursive: true, mode: 0o700 });
  await appendFile(EVENTS_FILE, encryptPrivateLine(JSON.stringify(event)) + '\n', { encoding: 'utf8', mode: 0o600 });
  return { ok: true };
}

export async function readAnalyticsEvents(limit = 100000): Promise<TMAnalyticsEvent[]> {
  if (!existsSync(EVENTS_FILE)) return [];
  const fileStat = await stat(EVENTS_FILE);
  const start = Math.max(0, fileStat.size - MAX_READ_BYTES);
  const handle = await import('node:fs/promises').then((m) => m.open(EVENTS_FILE, 'r'));
  try {
    const length = fileStat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let content = buffer.toString('utf8');
    if (start > 0) content = content.slice(content.indexOf('\n') + 1);
    const events: TMAnalyticsEvent[] = [];
    for (const line of content.split('\n').filter(Boolean).slice(-limit)) {
      try {
        const decrypted = decryptPrivateLine(line);
        if (!decrypted) continue;
        const e = JSON.parse(decrypted);
        if (e?.type && e?.ts && e?.sessionId) events.push(e);
      } catch {}
    }
    return events;
  } finally { await handle.close(); }
}

export function bratislavaDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function buildVisits(events: TMAnalyticsEvent[]): TMVisit[] {
  const groups = new Map<string, TMAnalyticsEvent[]>();
  for (const event of events) {
    const list = groups.get(event.sessionId) || [];
    list.push(event); groups.set(event.sessionId, list);
  }
  const visits: TMVisit[] = [];
  for (const [sessionId, list] of groups) {
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const pageviews = list.filter((e) => e.type === 'pageview');
    if (!pageviews.length) continue;
    const first = list[0], last = list[list.length - 1];
    const rawDuration = Math.max(0, Date.parse(last.ts) - Date.parse(first.ts));
    const activeMs = Math.min(SESSION_MAX_MS, list.reduce((sum, e) => sum + Math.min(e.activeMs || (e.type === 'heartbeat' ? 30000 : 0), 60000), 0));
    const pages = pageviews.map((pv, i) => {
      const next = pageviews[i + 1];
      const durationEvent = list.find((e) => e.type === 'page_duration' && e.path === pv.path && Date.parse(e.ts) >= Date.parse(pv.ts) && (!next || Date.parse(e.ts) <= Date.parse(next.ts) + 5000));
      const calculated = next ? Date.parse(next.ts) - Date.parse(pv.ts) : Math.max(0, Date.parse(last.ts) - Date.parse(pv.ts));
      return { path: pv.path, title: pv.title || '', enteredAt: pv.ts, durationMs: Math.min(SESSION_MAX_MS, durationEvent?.durationMs || calculated) };
    });
    const firstPage = pageviews[0];
    const lastPage = pageviews[pageviews.length - 1];
    const campaignEvent = list.find((e) => e.meta && (e.meta.utm_source || e.meta.gclid)) || firstPage;
    const orderEvent = [...list].reverse().find((e) => e.type === 'order_complete');
    const shippingEvent = [...list].reverse().find((e) => e.type === 'shipping_select');
    const paymentEvent = [...list].reverse().find((e) => e.type === 'payment_select');
    visits.push({
      sessionId, visitorId: first.visitorId || '', owner: list.some((e) => e.owner), startedAt: first.ts, lastSeenAt: last.ts,
      durationMs: Math.min(SESSION_MAX_MS, Math.max(rawDuration, activeMs)), activeMs, pageviews: pageviews.length,
      device: first.device || 'desktop', source: first.source || 'direct', referrer: first.referrer || '', userAgent: first.userAgent || '',
      browser: detectBrowser(first.userAgent || ''), os: detectOs(first.userAgent || ''), country: first.country || '', region: first.region || '', city: first.city || '', language: first.language || '', viewport: first.viewport || '',
      landingPage: firstPage?.path || '/', exitPage: lastPage?.path || '/', returning: metaText(firstPage, 'returning') === '1', googleQuery: metaText(firstPage, 'google_query'),
      campaign: { source: metaText(campaignEvent, 'utm_source'), medium: metaText(campaignEvent, 'utm_medium'), campaign: metaText(campaignEvent, 'utm_campaign'), term: metaText(campaignEvent, 'utm_term'), content: metaText(campaignEvent, 'utm_content'), gclid: metaText(campaignEvent, 'gclid'), campaignId:metaText(campaignEvent,'campaign_id')||metaText(campaignEvent,'campaignid'), adGroupId:metaText(campaignEvent,'ad_group_id')||metaText(campaignEvent,'adgroupid'), adId:metaText(campaignEvent,'ad_id')||metaText(campaignEvent,'creative'), assetId:metaText(campaignEvent,'asset_id')||metaText(campaignEvent,'assetid'), assetGroupId:metaText(campaignEvent,'asset_group_id')||metaText(campaignEvent,'assetgroupid'), keywordId:metaText(campaignEvent,'keyword_id')||metaText(campaignEvent,'keywordid'), productId:metaText(campaignEvent,'product_id')||metaText(campaignEvent,'productid'), matchType:metaText(campaignEvent,'matchtype'), network:metaText(campaignEvent,'network') },
      clicks: list.filter((e) => e.type === 'click').length, maxScroll: Math.max(0, ...list.filter((e) => e.type === 'scroll').map((e) => Number(e.value || 0))),
      cartAdds: list.filter((e) => e.type === 'add_to_cart').length, cartRemoves: list.filter((e) => e.type === 'remove_from_cart').length,
      checkoutStarted: list.some((e) => e.type === 'checkout_start'), orderCompleted: Boolean(orderEvent), orderNumber: metaText(orderEvent, 'order_number'), orderValue: Number(orderEvent?.value || 0),
      shipping: metaText(shippingEvent, 'label') || metaText(shippingEvent, 'value'), payment: metaText(paymentEvent, 'label') || metaText(paymentEvent, 'value'), pages,
      searches: [...new Set(list.filter((e) => e.search).map((e) => e.search!))], products: [...new Set(list.filter((e) => e.product).map((e) => e.product!))], events: list,
    });
  }
  return visits.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function analyticsForDate(events: TMAnalyticsEvent[], date: string, includeOwner = true) {
  const visits = buildVisits(events).filter((v) => bratislavaDate(v.startedAt) === date && (includeOwner || !v.owner));
  const now = Date.now();
  const online = buildVisits(events).filter((v) => now - Date.parse(v.lastSeenAt) <= ONLINE_WINDOW_MS && (includeOwner || !v.owner));
  return { date, visits, totalVisits: visits.length, onlineVisits: online.length, online };
}


/**
 * Kompatibilný súhrn pre existujúci Live Dashboard.
 * Reálne návštevy sú odvodené zo sessionId, nie z odhadov podľa User-Agentu.
 */
export function summarizeAnalytics(events: TMAnalyticsEvent[]) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const todayEvents = events.filter((event) => Date.parse(event.ts) >= dayAgo);
  const weekEvents = events.filter((event) => Date.parse(event.ts) >= weekAgo);
  const pageviews = weekEvents.filter((event) => event.type === 'pageview');
  const visits = buildVisits(weekEvents);

  function top(items: string[], max = 10): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = cleanText(item, 300) || 'neuvedené';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, max);
  }

  const checkoutStarts = weekEvents.filter((event) => event.type === 'checkout_start').length;
  const orderSubmits = weekEvents.filter((event) => event.type === 'order_submit').length;
  const cartAdds = weekEvents.filter((event) => event.type === 'add_to_cart').length;

  return {
    totalEvents: events.length,
    todayPageviews: todayEvents.filter((event) => event.type === 'pageview').length,
    weekPageviews: pageviews.length,
    estimatedSessions: visits.length,
    cartAdds,
    checkoutStarts,
    orderSubmits,
    conversionRate: checkoutStarts ? Math.round((orderSubmits / checkoutStarts) * 1000) / 10 : 0,
    topPages: top(pageviews.map((event) => event.path || '/')),
    topSearches: top(weekEvents.filter((event) => event.type === 'search').map((event) => event.search || '')),
    topProducts: top(weekEvents.filter((event) => event.product).map((event) => event.product || '')),
    devices: top(pageviews.map((event) => event.device || 'desktop'), 5),
    sources: top(pageviews.map((event) => event.source || 'direct'), 8),
    countries: top(pageviews.map((event) => event.country || 'neuvedené'), 8),
    recent: events.slice(-80).reverse(),
  };
}
