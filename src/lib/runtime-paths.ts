import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

function env(name: string): string {
  const runtimeValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const buildValue = import.meta.env[name];
  return String(runtimeValue || buildValue || '').trim();
}

function existingOrDefault(preferred: string, fallback: string): string {
  return existsSync(preferred) ? preferred : fallback;
}

export const TM_CACHE_ROOT = resolve(
  env('TM_CACHE_DIR') || existingOrDefault('/app/tm-cache', join(process.cwd(), '.tm-cache')),
);
