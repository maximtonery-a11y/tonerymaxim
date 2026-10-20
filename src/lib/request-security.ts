import { createHash, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

const peers = new WeakMap<Request, string>();
// Coolify/Traefik normally connects over an isolated private Docker network.
// Narrow this to the actual proxy subnet with TM_TRUSTED_PROXY_CIDRS.
const DEFAULT_PROXY_CIDRS = '127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7';
let proxyConfig = '';
let proxyList = new BlockList();

export function productionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || Boolean((import.meta as any).env?.PROD);
}

export function normalizeIp(value: unknown): string {
  let raw = String(value || '').trim().toLowerCase();
  if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1);
  if (isIP(raw) === 4) return raw;
  if (isIP(raw) !== 6 || raw.includes('%')) return '';
  try {
    const canonical = new URL('http://[' + raw + ']/').hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
    return canonical;
  } catch { return ''; }
}

function trustedProxy(ip: string): boolean {
  const configured = process.env.TM_TRUSTED_PROXY_CIDRS;
  const raw = configured === undefined ? DEFAULT_PROXY_CIDRS : configured.trim();
  if (raw !== proxyConfig) {
    const list = new BlockList();
    try {
      for (const entry of raw.split(',').map(value => value.trim()).filter(Boolean)) {
        const [address, prefix, extra] = entry.split('/');
        const normalized = normalizeIp(address);
        const version = isIP(normalized);
        const bits = prefix === undefined ? (version === 4 ? 32 : 128) : Number(prefix);
        if (!version || extra !== undefined || !Number.isInteger(bits) || bits < 1 || bits > (version === 4 ? 32 : 128)) throw new Error('Invalid proxy CIDR');
        list.addSubnet(normalized, bits, version === 4 ? 'ipv4' : 'ipv6');
      }
      proxyList = list;
    } catch {
      // A typo must never cause arbitrary incoming headers to become trusted.
      proxyList = new BlockList();
    }
    proxyConfig = raw;
  }
  return proxyList.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}

export function rememberRequestPeer(request: Request, address: unknown): void {
  peers.set(request, normalizeIp(address));
}

export function clientIp(request: Request, peerAddress?: string): string {
  const peer = peers.get(request) || normalizeIp(peerAddress);
  if (!peer) return 'unknown';
  if (!trustedProxy(peer)) return peer;
  const forwarded = request.headers.get('x-forwarded-for') || '';
  if (!forwarded || forwarded.length > 4096) return peer;
  // Traefik appends its observed client address on the right. A client-controlled
  // prefix, CF-Connecting-IP and X-Real-IP cannot change this identity.
  const last = forwarded.slice(forwarded.lastIndexOf(',') + 1);
  return normalizeIp(last) || peer;
}

export function securityPath(pathname: string): string {
  let path = pathname;
  try { path = decodeURIComponent(path); } catch { /* malformed URLs do not gain an exemption */ }
  return path.replace(/\/+$/, '') || '/';
}

export function localDevelopmentHost(hostname: string): boolean {
  return !productionRuntime() && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

const TRUSTED_ORIGINS = new Set([
  'https://tonerymaxim.sk', 'https://www.tonerymaxim.sk',
  'https://tonerymaxim.info', 'https://www.tonerymaxim.info',
]);
const SERVER_CALLBACKS = new Set(['/api/gopay-notify', '/api/admin/newsletter']);

export function syncHeaderPresent(request: Request): boolean {
  return Boolean(request.headers.get('x-sync-token') || request.headers.get('x-sync-secret')
    || /^Bearer\s+\S+$/i.test(request.headers.get('authorization') || ''));
}

export function requestOriginAllowed(request: Request, url: URL): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return true;
  const path = securityPath(url.pathname);
  if (SERVER_CALLBACKS.has(path)) return true;
  const source = request.headers.get('origin') || request.headers.get('referer');
  if (!source) {
    if (path === '/api/sync-products') return syncHeaderPresent(request);
    return request.headers.get('sec-fetch-site') === 'same-origin';
  }
  try {
    const origin = new URL(source);
    if (TRUSTED_ORIGINS.has(origin.origin)) return true;
    const local = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    return local.has(origin.hostname) && local.has(url.hostname) && origin.port === url.port;
  } catch { return false; }
}

export function secureTokenEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

export function safeLoginRedirect(value: unknown, fallback = '/ucet'): string {
  const path = String(value || '');
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(path) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path)) return fallback;
  try {
    return new URL(path, 'https://redirect.invalid').origin === 'https://redirect.invalid' ? path : fallback;
  } catch { return fallback; }
}
