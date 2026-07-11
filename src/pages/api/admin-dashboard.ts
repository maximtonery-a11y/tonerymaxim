import type { APIRoute } from 'astro';
import { readAnalyticsEvents, summarizeAnalytics, type TMAnalyticsEvent } from '../../lib/tm-analytics';
import { readCheckoutProfiles, summarizeCheckoutProfiles } from '../../lib/checkout-profiler';
import { readEmailQueueState } from '../../lib/email-queue';
import { getAsyncOrderQueueStats } from '../../lib/async-order-queue';
import { readSecurityEvents, securityStatus } from '../../lib/security';

export const prerender = false;

function sameKey(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

function countBy<T>(items: T[], key: (item: T) => string, limit = 8) {
  const map = new Map<string, number>();
  for (const item of items) {
    const value = key(item).trim() || 'neuvedené';
    map.set(value, (map.get(value) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function sourceLabel(source = '') {
  const labels: Record<string, string> = {
    google: 'Google', direct: 'Priamo', heureka: 'Heureka', facebook: 'Facebook',
    instagram: 'Instagram', bing: 'Bing', internal: 'Interné', referral: 'Odkazy',
  };
  return labels[source] || source || 'Neznáme';
}

function liveVisitors(events: TMAnalyticsEvent[], now: number) {
  const cutoff = now - 90_000;
  const live = events.filter((event) => Date.parse(event.ts) >= cutoff && ['heartbeat', 'pageview'].includes(event.type));
  const ids = new Set(live.map((event) => event.sessionId || [event.userAgent, event.device, event.language].join('|')));
  return ids.size;
}

function buildHourly(events: TMAnalyticsEvent[], now: number) {
  const rows: Array<{ label: string; pageviews: number; orders: number }> = [];
  for (let i = 23; i >= 0; i -= 1) {
    const start = new Date(now - i * 3_600_000);
    start.setMinutes(0, 0, 0);
    const end = start.getTime() + 3_600_000;
    const bucket = events.filter((event) => {
      const ts = Date.parse(event.ts);
      return ts >= start.getTime() && ts < end;
    });
    rows.push({
      label: start.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }),
      pageviews: bucket.filter((event) => event.type === 'pageview').length,
      orders: bucket.filter((event) => event.type === 'order_submit').length,
    });
  }
  return rows;
}

export const GET: APIRoute = async ({ request, url, locals }) => {
  const expected = locals?.runtime?.env?.TM_ANALYTICS_ADMIN_KEY || process.env.TM_ANALYTICS_ADMIN_KEY || process.env.ADMIN_API_SECRET || '';
  const supplied = url.searchParams.get('key') || request.headers.get('x-admin-key') || '';
  if (expected && !sameKey(expected, supplied)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const now = Date.now();
  const [events, profiles, emailQueue, orderQueue] = await Promise.all([
    readAnalyticsEvents(30_000),
    readCheckoutProfiles(200),
    readEmailQueueState().catch(() => null),
    getAsyncOrderQueueStats().catch(() => ({ pending: 0, processing: 0, done: 0, failed: 0 })),
  ]);

  const analytics = summarizeAnalytics(events);
  const performance = summarizeCheckoutProfiles(profiles);
  const dayEvents = events.filter((event) => Date.parse(event.ts) >= now - 86_400_000);
  const pageviewsToday = dayEvents.filter((event) => event.type === 'pageview');
  const checkoutToday = dayEvents.filter((event) => event.type === 'checkout_start').length;
  const ordersToday = dayEvents.filter((event) => event.type === 'order_submit').length;
  const cartToday = dayEvents.filter((event) => event.type === 'add_to_cart').length;
  const failedPayments = dayEvents.filter((event) => ['payment_failed', 'gopay_failed'].includes(event.type)).length;
  const successfulPayments = dayEvents.filter((event) => ['payment_success', 'payment_return'].includes(event.type)).length;
  const avgDuration = dayEvents.filter((event) => event.type === 'page_duration' && event.durationMs).map((event) => Number(event.durationMs));
  const securityEvents = readSecurityEvents(200);
  const blockedToday = securityEvents.filter((event) => Date.parse(event.ts) >= now - 86_400_000).length;
  const security = securityStatus(url.hostname);

  const avgPageTimeMs = avgDuration.length ? Math.round(avgDuration.reduce((a, b) => a + b, 0) / avgDuration.length) : 0;
  const conversion = checkoutToday ? Math.round((ordersToday / checkoutToday) * 1000) / 10 : 0;
  const queueProblems = Number(orderQueue.pending || 0) + Number(orderQueue.failed || 0) + Number(emailQueue?.failedEmails || 0);
  const performancePenalty = Math.min(20, Math.round((performance.avgMs || 0) / 500));
  const healthScore = Math.max(0, Math.min(100,
    100
    - queueProblems * 4
    - (blockedToday > 50 ? 5 : 0)
    - performancePenalty
    - (failedPayments > 0 ? Math.min(10, failedPayments * 2) : 0)
    - (security.ok ? 0 : 15)
  ));

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    live: {
      visitors: liveVisitors(events, now),
      last90Seconds: events.filter((event) => Date.parse(event.ts) >= now - 90_000).length,
    },
    today: {
      pageviews: pageviewsToday.length,
      estimatedVisitors: new Set(pageviewsToday.map((event) => event.sessionId || [event.userAgent, event.referrer, event.device].join('|'))).size,
      cartAdds: cartToday,
      checkoutStarts: checkoutToday,
      orders: ordersToday,
      conversion,
      avgPageTimeMs,
    },
    traffic: {
      sources: countBy(pageviewsToday, (event) => sourceLabel(event.source), 8),
      devices: countBy(pageviewsToday, (event) => event.device || 'desktop', 5),
      locations: countBy(pageviewsToday, (event) => event.city || event.region || event.country || 'neuvedené', 8),
      topPages: countBy(pageviewsToday, (event) => event.path || '/', 10),
      searches: countBy(dayEvents.filter((event) => event.type === 'search'), (event) => event.search || 'neuvedené', 10),
      products: countBy(dayEvents.filter((event) => event.product), (event) => event.product || 'neuvedené', 10),
      hourly: buildHourly(events, now),
    },
    checkout: {
      avgMs: Math.round(performance.avgMs || 0),
      p95Ms: Math.round(performance.p95Ms || 0),
      completed: performance.completed || 0,
      failed: performance.failed || 0,
      successfulPayments,
      failedPayments,
    },
    queues: {
      orders: orderQueue,
      emails: emailQueue ? {
        sent: emailQueue.sentEmails,
        failed: emailQueue.failedEmails,
        running: emailQueue.running,
        lastScanAt: emailQueue.lastScanAt,
        lastError: emailQueue.lastError,
      } : null,
    },
    security: {
      ok: security.ok,
      blockedToday,
      warnings: security.warnings,
    },
    health: {
      score: healthScore,
      label: healthScore >= 90 ? 'Výborný stav' : healthScore >= 75 ? 'Dobrý stav' : healthScore >= 55 ? 'Vyžaduje pozornosť' : 'Kritický stav',
    },
    recent: analytics.recent.slice(0, 30),
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
};
