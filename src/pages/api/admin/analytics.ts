import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import {
  analyticsForDate,
  bratislavaDate,
  buildVisits,
  readAnalyticsEvents,
  type TMVisit,
} from '../../../lib/tm-analytics';

export const prerender = false;

function env(name: string): string {
  return String(
    process.env[name] ??
      (import.meta.env as Record<string, string | undefined>)[name] ??
      '',
  ).trim();
}

function authorized(request: Request): boolean {
  const configured = env('TM_ANALYTICS_ADMIN_KEY') || env('ADMIN_API_SECRET');
  if (!configured) return false;
  const url = new URL(request.url);
  const supplied = url.searchParams.get('key') || request.headers.get('x-tm-admin-key') || '';
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function cleanDate(value: string | null): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '')
    ? String(value)
    : bratislavaDate(new Date().toISOString());
}

function publicVisit(visit: TMVisit) {
  return {
    sessionId: visit.sessionId,
    visitorId: visit.visitorId,
    owner: visit.owner,
    startedAt: visit.startedAt,
    lastSeenAt: visit.lastSeenAt,
    durationMs: visit.durationMs,
    activeMs: visit.activeMs,
    pageviews: visit.pageviews,
    device: visit.device,
    source: visit.source,
    referrer: visit.referrer,
    userAgent: visit.userAgent,
    browser: visit.browser,
    os: visit.os,
    country: visit.country,
    region: visit.region,
    city: visit.city,
    language: visit.language,
    viewport: visit.viewport,
    landingPage: visit.landingPage,
    exitPage: visit.exitPage,
    returning: visit.returning,
    googleQuery: visit.googleQuery,
    campaign: visit.campaign,
    clicks: visit.clicks,
    maxScroll: visit.maxScroll,
    cartAdds: visit.cartAdds,
    cartRemoves: visit.cartRemoves,
    checkoutStarted: visit.checkoutStarted,
    orderCompleted: visit.orderCompleted,
    orderNumber: visit.orderNumber,
    orderValue: visit.orderValue,
    shipping: visit.shipping,
    payment: visit.payment,
    pages: visit.pages,
    searches: visit.searches,
    products: visit.products,
    events: visit.events.map((event) => ({
      type: event.type,
      ts: event.ts,
      path: event.path,
      title: event.title || '',
      durationMs: event.durationMs || 0,
      activeMs: event.activeMs || 0,
      search: event.search || '',
      product: event.product || '',
      value: event.value,
      meta: event.meta,
    })),
  };
}

export const GET: APIRoute = async ({ request }) => {
  if (!authorized(request)) return json({ ok: false, error: 'Unauthorized' }, 401);

  try {
    const url = new URL(request.url);
    const date = cleanDate(url.searchParams.get('date'));
    const includeOwner = url.searchParams.get('includeOwner') !== '0';
    const events = await readAnalyticsEvents(50000);
    const allVisits = buildVisits(events);
    const selected = analyticsForDate(events, date, includeOwner);

    const dailyCounts = new Map<string, { total: number; owner: number }>();
    for (const visit of allVisits) {
      const day = bratislavaDate(visit.startedAt);
      const value = dailyCounts.get(day) || { total: 0, owner: 0 };
      value.total += 1;
      if (visit.owner) value.owner += 1;
      dailyCounts.set(day, value);
    }

    const today = bratislavaDate(new Date().toISOString());
    const todaySummary = analyticsForDate(events, today, includeOwner);

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      date,
      today,
      includeOwner,
      online: selected.online.map(publicVisit),
      onlineCount: selected.onlineVisits,
      todayCount: todaySummary.totalVisits,
      selectedCount: selected.totalVisits,
      visits: selected.visits.map(publicVisit),
      dailyCounts: Array.from(dailyCounts.entries())
        .map(([day, counts]) => ({ day, ...counts }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    });
  } catch (error) {
    console.error('[TM Analytics admin API]', error);
    return json({ ok: false, error: 'Analytické dáta sa nepodarilo načítať.' }, 500);
  }
};
