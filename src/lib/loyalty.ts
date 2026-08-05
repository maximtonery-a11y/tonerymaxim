import { getCustomerMeta, getWooCustomerById, getWooCustomerOrders, parseJsonMeta, updateWooCustomer } from "./woo-client";
import { isLoyaltyCreditStatus } from "./order-statuses";

export const LOYALTY_META_POINTS = "tm_loyalty_points";
export const LOYALTY_META_HISTORY = "tm_loyalty_history";
export const LOYALTY_META_CREDITED = "tm_loyalty_credited_orders";
export const LOYALTY_META_USED = "tm_loyalty_used_orders";

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
  return Math.round(value / 10) / 10;
}

export async function syncCustomerLoyaltyPoints(customerId: number) {
  const customer = await getWooCustomerById(customerId);
  if (!customer) return { points: 0, history: [] as LoyaltyHistoryItem[], creditedOrders: [] as string[] };

  const currentPoints = Number(getCustomerMeta(customer, LOYALTY_META_POINTS) || 0);
  const history = parseJsonMeta<LoyaltyHistoryItem[]>(getCustomerMeta(customer, LOYALTY_META_HISTORY), []);
  const creditedOrders = parseJsonMeta<string[]>(getCustomerMeta(customer, LOYALTY_META_CREDITED), []);
  const creditedSet = new Set((creditedOrders || []).map(String));
  const orders = await getWooCustomerOrders(customerId, 100);

  let points = Number.isFinite(currentPoints) ? currentPoints : 0;
  let changed = false;

  for (const order of orders) {
    const id = String(order.id || "");
    if (!id || creditedSet.has(id) || !isLoyaltyCreditStatus(order.status)) continue;
    const add = pointsFromGross(order.total);
    if (add <= 0) continue;
    points += add;
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
      ],
    });
  }

  return { points, history: history.slice(0, 100), creditedOrders: [...creditedSet] };
}

export async function getCustomerLoyalty(customerId: number) {
  const synced = await syncCustomerLoyaltyPoints(customerId);
  return {
    ...synced,
    discountValue: loyaltyDiscountFromPoints(synced.points),
  };
}

export async function reserveLoyaltyDiscount(customerId: number, orderId: number | string, requestedEuro: unknown) {
  const requested = Math.max(0, Math.round(moneyNumber(requestedEuro) * 10) / 10);
  if (!customerId || requested <= 0) return { discount: 0, pointsUsed: 0 };

  const synced = await syncCustomerLoyaltyPoints(customerId);
  const maxDiscount = loyaltyDiscountFromPoints(synced.points);
  const discount = Math.min(requested, maxDiscount);
  if (discount <= 0) return { discount: 0, pointsUsed: 0 };

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
