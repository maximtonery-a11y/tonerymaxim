import { isStrongSecret } from './secret-validation';

function readEnv(name: string): string {
  return String(process.env[name] || import.meta.env[name] || '').trim();
}

const DEV_FALLBACK = 'tonerymaxim-local-development-secret-change-me';

export function authSecret(): string {
  const value = readEnv('AUTH_SECRET') || readEnv('SESSION_SECRET');
  if (isStrongSecret(value, 32)) return value;

  if (import.meta.env.PROD) {
    throw new Error('AUTH_SECRET musí byť v produkcii jedinečný, nesmie byť ukážkový a musí mať aspoň 32 znakov.');
  }

  return DEV_FALLBACK;
}
