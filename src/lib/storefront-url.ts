export const STOREFRONT_ORIGIN = "https://www.tonerymaxim.sk";

const STOREFRONT_HOSTS = new Set([
  "tonerymaxim.sk",
  "www.tonerymaxim.sk",
  "tonerymaxim.info",
  "www.tonerymaxim.info",
]);

/**
 * Builds customer-facing links on the canonical .sk storefront.
 * Old absolute .info links can remain saved in WooCommerce customer metadata,
 * so the hostname is normalised here instead of trusting the environment or
 * the stored value.
 */
export function storefrontUrl(value: unknown = "/", fallback = "/"): string {
  const fallbackUrl = new URL(String(fallback || "/"), STOREFRONT_ORIGIN);

  try {
    const url = new URL(String(value || fallback), STOREFRONT_ORIGIN);
    if (!STOREFRONT_HOSTS.has(url.hostname.toLowerCase())) return fallbackUrl.toString();

    url.protocol = "https:";
    url.hostname = "www.tonerymaxim.sk";
    url.port = "";
    return url.toString();
  } catch {
    return fallbackUrl.toString();
  }
}
