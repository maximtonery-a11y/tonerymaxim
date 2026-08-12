import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

function env(name: string): string {
  const runtimeValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const buildValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
  return String(runtimeValue || buildValue || '').trim();
}

function existingOrDefault(preferred: string, fallback: string): string {
  return existsSync(preferred) ? preferred : fallback;
}

/**
 * Produkčné cesty Coolify (/app/...) sa nesmú použiť na Windows localhoste.
 * path.resolve('/app/data') by ich na Windows preložil na C:\app\data a lokálny
 * katalóg by následne zapisoval mimo projektu alebo zlyhal na oprávneniach.
 */
export function portableStoragePath(value: unknown, platform = process.platform): string {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (platform === 'win32' && /^\/app(?:\/|$)/i.test(clean.replace(/\\/g, '/'))) return '';
  return clean;
}

const configuredCacheRoot = portableStoragePath(env('TM_CACHE_DIR'));
const persistentDataRoot = portableStoragePath(env('TM_PERSISTENT_DATA_DIR'));

// Legacy runtime cache root. It may still contain profiler/old queue data, so keep
// honoring TM_CACHE_DIR for backward compatibility. Product catalog data has its
// own canonical root below and must never switch between two persistent volumes.
export const TM_CACHE_ROOT = resolve(
  configuredCacheRoot
    || (process.platform === 'win32'
      ? join(process.cwd(), '.tm-cache')
      : existingOrDefault('/app/tm-cache', join(process.cwd(), '.tm-cache'))),
);

// Single source of truth for the WooCommerce product catalog. When persistent
// data is configured (production/Coolify), always keep products below it. This
// prevents sync/readiness/search from diverging between /app/.tm-cache and
// /app/.tm-data/product-cache after deployments. TM_CACHE_DIR remains a local
// fallback only when no persistent data root is configured.
export const TM_PRODUCT_CACHE_ROOT = resolve(
  persistentDataRoot
    ? join(persistentDataRoot, 'product-cache')
    : configuredCacheRoot
      || (process.platform === 'win32'
        ? join(process.cwd(), '.tm-cache')
        : existingOrDefault(
            '/app/.tm-data/product-cache',
            existingOrDefault('/app/data/product-cache', existingOrDefault('/app/tm-cache', join(process.cwd(), '.tm-cache'))),
          )),
);
