function readEnv(name: string): string {
  return String(import.meta.env[name] || process.env[name] || '').trim();
}

const DEV_FALLBACK = 'tonerymaxim-local-development-secret-change-me';

export function authSecret(): string {
  const value = readEnv('AUTH_SECRET') || readEnv('SESSION_SECRET');
  if (value.length >= 32) return value;

  if (import.meta.env.PROD) {
    throw new Error('AUTH_SECRET is required in production and must contain at least 32 characters.');
  }

  return DEV_FALLBACK;
}
