import { getCustomerMeta, getWooCustomerById, getWooCustomerOrders, parseJsonMeta, updateWooCustomer } from "./woo-client";
import { isLoyaltyCreditStatus } from "./order-statuses";
import { earnedPaperPacks } from "./loyalty-rules";
export { earnedPaperPacks } from "./loyalty-rules";

export const LOYALTY_META_POINTS = "tm_loyalty_points";
export const LOYALTY_META_HISTORY = "tm_loyalty_history";
export const LOYALTY_META_CREDITED = "tm_loyalty_credited_orders";
export const LOYALTY_META_USED = "tm_loyalty_used_orders";
export const LOYALTY_META_LIFETIME = "tm_loyalty_lifetime_points";
export const LOYALTY_META_PAPER_CLAIMED = "tm_loyalty_paper_claimed_packs";
export const LOYALTY_META_PAPER_ORDERS = "tm_loyalty_paper_reward_orders";
export const LOYALTY_PAPER_PRODUCT_SKU = "9999999999999";
export const LOYALTY_PAPER_REWARD_SKU = "TM-LOYALTY-PAPER-REWARD";
export const LOYALTY_PAPER_PRICE = 0.01;
const paperRewardClaimLocks = new Map<number, Promise<void>>();

export type LoyaltyHistoryItem = {
  date: string;
  title: string;
  points: number;
  orderId?: number;
};

function todaySk() {
  return new Date().toLocaleDateString("sk-SK");
}

function moneyNumber(value: unknown) {
  const number = Number(String(value ?? "0").replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function pointsFromGross(total: unknown) {
  return Math.max(0, Math.floor(moneyNumber(total)));
}

export function loyaltyDiscountFromPoints(points: number) {
  const value = Number(points || 0);
  if (!Number.isFinite(value) || value < 20) return 0;
  return Math.floor(value) / 100;
}

export async function syncCustomerLoyaltyPoints(customerId: number) {
  const customer = await getWooCustomerById(customerId);
  if (!customer) return { points: 0, lifetimePoints: 0, claimedPacks: 0, history: [] as LoyaltyHistoryItem[], creditedOrders: [] as string[] };

  const currentPoints = Number(getCustomerMeta(customer, LOYALTY_META_POINTS) || 0);
  const history = parseJsonMeta<LoyaltyHistoryItem[]>(getCustomerMeta(customer, LOYALTY_META_HISTORY), []);
  const creditedOrders = parseJsonMeta<string[]>(getCustomerMeta(customer, LOYALTY_META_CREDITED), []);
  const storedLifetime = Number(getCustomerMeta(customer, LOYALTY_META_LIFETIME) || 0);
  const claimedPacks = Math.max(0, Math.floor(Number(getCustomerMeta(customer, LOYALTY_META_PAPER_CLAIMED) || 0)));
  const historyLifetime = history.reduce((sum, item) => sum + Math.max(0, Number(item?.points || 0)), 0);
  const creditedSet = new Set((creditedOrders || []).map(String));
  const orders = await getWooCustomerOrders(customerId, 100);

  let points = Number.isFinite(currentPoints) ? currentPoints : 0;
  let lifetimePoints = Math.max(Number.isFinite(storedLifetime) ? storedLifetime : 0, historyLifetime);
  let changed = lifetimePoints > (Number.isFinite(storedLifetime) ? storedLifetime : 0);

  for (const order of orders) {
    const id = String(order.id || "");
    if (!id || creditedSet.has(id) || !isLoyaltyCreditStatus(order.status)) continue;
    const add = pointsFromGross(order.total);
    if (add <= 0) continue;
    points += add;
    lifetimePoints += add;
    creditedSet.add(id);
    history.unshift({
      date: todaySk(),
      title: `Objednávka #${order.number || order.id}`,
      points: add,
      orderId: Number(order.id),
    });
    changed = true;
  }

  if (changed) {
    await updateWooCustomer(customerId, {
      meta_data: [
        { key: LOYALTY_META_POINTS, value: String(points) },
        { key: LOYALTY_META_HISTORY, value: JSON.stringify(history.slice(0, 100)) },
        { key: LOYALTY_META_CREDITED, value: JSON.stringify([...creditedSet]) },
        { key: LOYALTY_META_LIFETIME, value: String(lifetimePoints) },
      ],
    });
  }

  return { points, lifetimePoints, claimedPacks, history: history.slice(0, 100), creditedOrders: [...creditedSet] };
}

export async function getCustomerLoyalty(customerId: number) {
  const synced = await syncCustomerLoyaltyPoints(customerId);
  const paper = earnedPaperPacks(synced.lifetimePoints);
  return {
    ...synced,
    discountValue: loyaltyDiscountFromPoints(synced.points),
    paperReward: {
      ...paper,
      claimedPacks: synced.claimedPacks,
      availablePacks: Math.max(0, paper.earnedPacks - synced.claimedPacks),
      sku: LOYALTY_PAPER_REWARD_SKU,
      price: LOYALTY_PAPER_PRICE,
      name: "Vernostná odmena – Kancelársky papier A4, 80 g, 500 hárkov",
    },
  };
}

async function claimPaperRewardUnlocked(customerId: number, orderId: number | string, packs: number) {
  const requested = Math.max(0, Math.floor(Number(packs) || 0));
  if (!customerId || !orderId || requested < 1) return { claimed: 0 };
  const loyalty = await getCustomerLoyalty(customerId);
  const customer = await getWooCustomerById(customerId);
  if (!customer) return { claimed: 0 };
  const orders = parseJsonMeta<Array<{ orderId: string; packs: number }>>(getCustomerMeta(customer, LOYALTY_META_PAPER_ORDERS), []);
  const key = String(orderId);
  const existing = orders.find((item) => String(item?.orderId) === key);
  if (existing) return { claimed: Math.max(0, Math.floor(Number(existing.packs) || 0)), alreadyClaimed: true };
  const claimed = Math.min(requested, loyalty.paperReward.availablePacks);
  if (claimed < 1) return { claimed: 0 };
  const claimedPacks = loyalty.paperReward.claimedPacks + claimed;
  await updateWooCustomer(customerId, { meta_data: [
    { key: LOYALTY_META_PAPER_CLAIMED, value: String(claimedPacks) },
    { key: LOYALTY_META_PAPER_ORDERS, value: JSON.stringify([{ orderId: key, packs: claimed }, ...orders].slice(0, 100)) },
  ] });
  return { claimed, alreadyClaimed: false };
}

export async function claimPaperReward(customerId: number, orderId: number | string, packs: number) {
  const key = Math.max(0, Math.floor(Number(customerId) || 0));
  if (!key) return { claimed: 0 };

  const previous = paperRewardClaimLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  paperRewardClaimLocks.set(key, current);

  await previous.catch(() => {});
  try {
    return await claimPaperRewardUnlocked(key, orderId, packs);
  } finally {
    release();
    if (paperRewardClaimLocks.get(key) === current) paperRewardClaimLocks.delete(key);
  }
}

export async function reserveLoyaltyDiscount(customerId: number, orderId: number | string, requestedEuro: unknown) {
  const requested = Math.max(0, Math.round(moneyNumber(requestedEuro) * 100) / 100);
  if (!customerId || requested < 0.2) return { discount: 0, pointsUsed: 0 };

  const synced = await syncCustomerLoyaltyPoints(customerId);
  const maxDiscount = loyaltyDiscountFromPoints(synced.points);
  const discount = Math.round(Math.min(requested, maxDiscount) * 100) / 100;
  if (discount < 0.2) return { discount: 0, pointsUsed: 0 };

  const pointsUsed = Math.min(synced.points, Math.round(discount * 100));
  const remaining = Math.max(0, synced.points - pointsUsed);
  const history = [
    {
      date: todaySk(),
      title: `Použitá zľava pri objednávke #${orderId}`,
      points: -pointsUsed,
      orderId: Number(orderId) || undefined,
    },
    ...(synced.history || []),
  ];

  await updateWooCustomer(customerId, {
    meta_data: [
      { key: LOYALTY_META_POINTS, value: String(remaining) },
      { key: LOYALTY_META_HISTORY, value: JSON.stringify(history.slice(0, 100)) },
    ],
  });

  return { discount, pointsUsed };
}
