import { mkdir, appendFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type TMAnalyticsEvent = {
  type: string;
  ts: string;
  path: string;
  url?: string;
  title?: string;
  referrer?: string;
  durationMs?: number;
  viewport?: string;
  device?: string;
  language?: string;
  userAgent?: string;
  country?: string;
  region?: string;
  city?: string;
  source?: string;
  search?: string;
  product?: string;
  value?: number;
  meta?: Record<string, unknown>;
};

const ANALYTICS_DIR = path.join(process.cwd(), '.tm-cache', 'analytics');
const EVENTS_FILE = path.join(ANALYTICS_DIR, 'events.jsonl');
const MAX_BODY_SIZE = 16_000;
const MAX_READ_BYTES = 4_000_000;

function cleanText(value: unknown, max = 500): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanPath(value: unknown): string {
  const text = cleanText(value, 1000);
  if (!text || !text.startsWith('/')) return '/';
  return text;
}

function cleanNumber(value: unknown, max = 86_400_000): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.min(Math.round(number), max);
}

function getHeader(request: Request, name: string): string {
  return cleanText(request.headers.get(name), 120);
}

function detectDevice(userAgent: string, viewport = ''): string {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile/i.test(userAgent)) return 'mobile';
  const width = Number(String(viewport).split('x')[0] || 0);
  if (width > 0 && width < 768) return 'mobile';
  if (width >= 768 && width < 1100) return 'tablet';
  return 'desktop';
}

function detectSource(referrer: string): string {
  const value = referrer.toLowerCase();
  if (!value) return 'direct';
  if (value.includes('google.')) return 'google';
  if (value.includes('facebook.') || value.includes('fb.')) return 'facebook';
  if (value.includes('instagram.')) return 'instagram';
  if (value.includes('bing.')) return 'bing';
  if (value.includes('heureka.')) return 'heureka';
  if (value.includes('tonerymaxim.sk') || value.includes('tonerymaxim.info')) return 'internal';
  return 'referral';
}

export async function saveAnalyticsEvent(request: Request, payload: unknown): Promise<{ ok: true }> {
  const raw = JSON.stringify(payload ?? {});
  if (raw.length > MAX_BODY_SIZE) throw new Error('Payload je príliš veľký.');

  const data = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  const userAgent = cleanText(request.headers.get('user-agent'), 500);
  const referrer = cleanText(data.referrer || request.headers.get('referer'), 700);
  const viewport = cleanText(data.viewport, 40);

  const event: TMAnalyticsEvent = {
    type: cleanText(data.type || 'event', 60) || 'event',
    ts: new Date().toISOString(),
    path: cleanPath(data.path),
    url: cleanText(data.url, 1000),
    title: cleanText(data.title, 200),
    referrer,
    durationMs: cleanNumber(data.durationMs),
    viewport,
    device: cleanText(data.device, 40) || detectDevice(userAgent, viewport),
    language: cleanText(data.language, 40),
    userAgent,
    country: getHeader(request, 'cf-ipcountry') || getHeader(request, 'x-vercel-ip-country') || getHeader(request, 'x-country-code'),
    region: getHeader(request, 'x-vercel-ip-country-region') || getHeader(request, 'x-region'),
    city: getHeader(request, 'x-vercel-ip-city') || getHeader(request, 'x-city'),
    source: detectSource(referrer),
    search: cleanText(data.search, 200),
    product: cleanText(data.product, 300),
    value: cleanNumber(data.value, 1_000_000),
    meta: typeof data.meta === 'object' && data.meta ? data.meta as Record<string, unknown> : undefined,
  };

  await mkdir(ANALYTICS_DIR, { recursive: true });
  await appendFile(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf8');
  return { ok: true };
}

export async function readAnalyticsEvents(limit = 10000): Promise<TMAnalyticsEvent[]> {
  if (!existsSync(EVENTS_FILE)) return [];
  const fileStat = await stat(EVENTS_FILE);
  const start = Math.max(0, fileStat.size - MAX_READ_BYTES);
  const buffer = await readFile(EVENTS_FILE, 'utf8');
  const content = start > 0 ? buffer.slice(start) : buffer;
  const lines = content.split('\n').filter(Boolean).slice(-limit);
  const events: TMAnalyticsEvent[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as TMAnalyticsEvent;
      if (parsed?.type && parsed?.ts) events.push(parsed);
    } catch {
      // ignoruj poškodený riadok
    }
  }

  return events;
}

export function summarizeAnalytics(events: TMAnalyticsEvent[]) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const todayEvents = events.filter((event) => Date.parse(event.ts) >= dayAgo);
  const weekEvents = events.filter((event) => Date.parse(event.ts) >= weekAgo);
  const pageviews = weekEvents.filter((event) => event.type === 'pageview');
  const sessions = new Set(pageviews.map((event) => [event.userAgent, event.referrer, event.language, event.device].join('|')));

  function top(items: string[], max = 10) {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = cleanText(item, 300) || 'neuvedené';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, max);
  }

  const checkoutStarts = weekEvents.filter((event) => event.type === 'checkout_start').length;
  const orderSubmits = weekEvents.filter((event) => event.type === 'order_submit').length;
  const cartAdds = weekEvents.filter((event) => event.type === 'add_to_cart').length;

  return {
    totalEvents: events.length,
    todayPageviews: todayEvents.filter((event) => event.type === 'pageview').length,
    weekPageviews: pageviews.length,
    estimatedSessions: sessions.size,
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
