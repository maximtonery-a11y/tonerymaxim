export const PAPER_REWARD_SKU = "TM-LOYALTY-PAPER-REWARD";
export const LEGACY_PAPER_PRODUCT_SKU = "9999999999999";

export function isPaperRewardCartItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.loyalty_reward === true) return true;
  const sku = String(item.sku || item.code || "").trim();
  const name = String(item.name || item.title || "").trim().toLowerCase();
  const price = Number(String(item.price ?? item.unitPrice ?? "").replace(",", "."));
  return name.startsWith("vernostná odmena")
    || sku === PAPER_REWARD_SKU
    || (sku === LEGACY_PAPER_PRODUCT_SKU && Number.isFinite(price) && price > 0 && price <= 0.011);
}

export function collapsePaperRewardCart(cart) {
  const input = Array.isArray(cart) ? cart : [];
  const regular = input.filter((item) => !isPaperRewardCartItem(item));
  const rewards = input.filter(isPaperRewardCartItem);
  if (!rewards.length || !regular.length) return regular;

  const source = rewards.find((item) => String(item?.image || "").trim()) || rewards[0];
  const qty = Math.max(1, ...rewards.map((item) => Math.max(1, Math.floor(Number(item?.qty || item?.quantity || 1)))));
  return [...regular, { ...source, qty, price: 0.01, loyalty_reward: true }];
}

export function syncPaperRewardCart(cart, reward) {
  const regular = (Array.isArray(cart) ? cart : []).filter((item) => !isPaperRewardCartItem(item));
  const available = Math.max(0, Math.floor(Number(reward?.availablePacks || 0)));
  if (available < 1 || regular.length < 1) return regular;

  const sku = PAPER_REWARD_SKU;
  return [...regular, {
    id: sku,
    productId: "",
    product_id: "",
    sku,
    name: String(reward?.name || "Vernostná odmena – Kancelársky papier A4, 80 g, 500 hárkov"),
    price: 0.01,
    qty: available,
    image: "",
    url: "/produkt/kancelarsky-papier-a4-80g-500-harkov",
    stock_status: "instock",
    stock_quantity: null,
    loyalty_reward: true,
  }];
}
