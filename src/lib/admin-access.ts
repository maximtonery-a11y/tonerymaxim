import { isStrongSecret } from './secret-validation.ts';
import { localDevelopmentHost, secureTokenEqual } from './request-security.ts';

export function getAdminAccessKey(locals?: any): string {
  const runtime = locals?.runtime?.env || {};
  const value = String(
    runtime.TM_ANALYTICS_ADMIN_KEY ||
    runtime.ADMIN_API_SECRET ||
    process.env.TM_ANALYTICS_ADMIN_KEY ||
    process.env.ADMIN_API_SECRET ||
    (import.meta as any).env?.TM_ANALYTICS_ADMIN_KEY ||
    (import.meta as any).env?.ADMIN_API_SECRET ||
    ''
  ).trim();
  return isStrongSecret(value, 24) ? value : '';
}

export function constantTimeEqual(left: string, right: string): boolean {
  return secureTokenEqual(left, right);
}

export function isAdminLocked(options: {
  adminKey: string;
  suppliedKey: string;
  allowLocal?: boolean;
  hostname?: string;
}): boolean {
  const hostname = String(options.hostname || '').toLowerCase();
  const local = localDevelopmentHost(hostname);
  if (options.allowLocal && local) return false;
  if (!options.adminKey) return true;
  return !constantTimeEqual(options.adminKey, options.suppliedKey);
}
