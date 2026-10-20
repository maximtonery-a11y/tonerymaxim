import { isStrongSecret } from './secret-validation.ts';
import { secureTokenEqual } from './request-security.ts';

type SyncAccess = { ok: true } | { ok: false; status: number; error: string };

export function validateSyncAccess(url: URL, request: Request, secret: string): SyncAccess {
  if (!isStrongSecret(secret, 24)) {
    return { ok: false, status: 503, error: 'SYNC_SECRET nie je správne nastavený.' };
  }
  if (url.searchParams.has('token')) {
    return { ok: false, status: 400, error: 'Sync token posielajte iba v autentifikačnej hlavičke.' };
  }
  const authorization = request.headers.get('authorization');
  if (authorization && !/^Bearer\s+\S+$/i.test(authorization)) {
    return { ok: false, status: 401, error: 'Neplatný alebo chýbajúci sync token.' };
  }
  const candidates = [
    request.headers.get('x-sync-token'),
    request.headers.get('x-sync-secret'),
    authorization?.replace(/^Bearer\s+/i, ''),
  ].filter((value): value is string => Boolean(value));
  if (!candidates.length || candidates.some(token => token.length > 4096 || !secureTokenEqual(secret, token))) {
    return { ok: false, status: 401, error: 'Neplatný alebo chýbajúci sync token.' };
  }
  return { ok: true };
}
