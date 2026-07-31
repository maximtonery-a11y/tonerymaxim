import type { APIRoute } from 'astro';
import { readProductsCache } from '../../lib/tm-products-cache';
import {
  normalizedCompletenessRatio,
  productCompletenessRatio,
  requiredProductCount,
} from '../../lib/product-cache-policy';

export const prerender = false;

export const GET: APIRoute = async () => {
  const cache = await readProductsCache();
  const total = Number(cache?.total || cache?.products?.length || 0);
  const configuredMinimum = Math.max(0, Number(process.env.WOO_SYNC_EXPECTED_MIN_PRODUCTS || import.meta.env.WOO_SYNC_EXPECTED_MIN_PRODUCTS || 0));
  const reported = Number(cache?.woo_reported_total || total);
  const completenessTarget = normalizedCompletenessRatio(
    process.env.WOO_SYNC_COMPLETENESS_RATIO || import.meta.env.WOO_SYNC_COMPLETENESS_RATIO || 0.99,
  );
  const expected = requiredProductCount({
    reportedTotal: reported,
    configuredMinimum,
    safeMinimum: 100,
    completenessRatio: completenessTarget,
  });
  const ratio = productCompletenessRatio(total, reported);
  const generated = Date.parse(String(cache?.generated_at || ""));
  const maxAgeMs = Math.max(60 * 60_000, Number(process.env.WOO_READINESS_MAX_CACHE_AGE_MS || import.meta.env.WOO_READINESS_MAX_CACHE_AGE_MS || 36 * 60 * 60_000));
  const fresh = Number.isFinite(generated) && Date.now() - generated <= maxAgeMs;
  const ready = Boolean(cache && total >= expected && ratio >= completenessTarget && fresh);

  return new Response(JSON.stringify({
    ok: ready,
    service: 'tonerymaxim',
    products: total,
    expected_products: expected,
    configured_min_products: configuredMinimum,
    woo_reported_total: reported,
    completeness_ratio: Math.round(ratio * 10_000) / 10_000,
    cache_fresh: fresh,
    generated_at: cache?.generated_at || null,
    error: ready ? null : 'Produktová cache nie je úplná, aktuálna alebo nedosahuje očakávaný počet produktov.',
  }), {
    status: ready ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(ready ? {} : { 'Retry-After': '15' }),
    },
  });
};
