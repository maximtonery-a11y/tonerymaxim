import type { CheckoutOrderSource } from "./checkout-order";

function env(name: string) {
  return String(process.env[name] || import.meta.env[name] || "").trim();
}

function itemId(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[^_\/0-9a-zA-Z-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}

function positiveOrderId(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits && Number(digits) > 0 ? String(Number(digits)) : "";
}

export async function sendHeurekaVerifiedOrder(source: CheckoutOrderSource, wooOrderId?: number) {
  if (source.heurekaConsent !== true) return { sent: false, reason: "no-consent" } as const;
  if (env("HEUREKA_VERIFIED_ENABLED") === "0") return { sent: false, reason: "disabled" } as const;

  const secretKey = env("HEUREKA_SECRET_KEY");
  if (!secretKey) return { sent: false, reason: "missing-key" } as const;

  const email = String(source.contact?.email || source.billing?.email || "").trim().toLowerCase();
  const orderId = positiveOrderId(source.orderNumber) || positiveOrderId(wooOrderId);
  const ids = [...new Set(source.cart.map((item) => itemId(item.id || item.productId || item.product_id || item.sku)).filter(Boolean))];
  if (!email || !orderId || ids.length === 0) return { sent: false, reason: "missing-data" } as const;

  const url = new URL("https://www.heureka.sk/direct/dotaznik/objednavka.php");
  url.searchParams.set("id", secretKey);
  url.searchParams.set("email", email);
  url.searchParams.set("orderid", orderId);
  ids.forEach((id) => url.searchParams.append("itemId[]", id));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/plain", "User-Agent": "ToneryMaxim.sk Heureka Verified/1.0" },
      signal: controller.signal,
    });
    const body = (await response.text()).trim().slice(0, 120);
    if (!response.ok || !/\bok\b/i.test(body)) {
      throw new Error(`Heureka odpovedala stavom ${response.status}.`);
    }
    return { sent: true, sentAt: new Date().toISOString() } as const;
  } finally {
    clearTimeout(timeout);
  }
}
