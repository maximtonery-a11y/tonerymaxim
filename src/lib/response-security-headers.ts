// These directives protect the document without restricting the scripts,
// frames, API calls or redirects used by DPD, GLS and GoPay. In particular,
// frame-ancestors controls who may embed us, not which maps we may embed.
export const BASELINE_CONTENT_SECURITY_POLICY =
  "base-uri 'self'; object-src 'none'; frame-ancestors 'self'";

const HSTS_HOSTS = new Set(['tonerymaxim.sk', 'www.tonerymaxim.sk']);

export function applyResponseSecurityHeaders(headers: Headers, url: URL): void {
  // Preserve stricter endpoint policies, including the invoice PDF sandbox.
  if (/^text\/html(?:\s*;|\s*$)/i.test(headers.get('content-type') || '')
    && !headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', BASELINE_CONTENT_SECURITY_POLICY);
  }

  // Public production hosts are HTTPS-only; Traefik terminates TLS and may
  // forward HTTP to Astro. Select known hosts without trusting proxy headers.
  // Browsers only honor HSTS received over HTTPS. Local/staging hosts and
  // other subdomains are deliberately excluded.
  if (HSTS_HOSTS.has(url.hostname)
    && !headers.has('Strict-Transport-Security')) {
    headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
}
