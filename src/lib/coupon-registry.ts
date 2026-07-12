import { join } from "node:path";
import { readSignedJson, TM_DATA_ROOT, writeSignedJson } from "./secure-persistence";

export type CouponRegistryEntry = {
  code: string;
  issuedAt: string;
  sourceOrderId?: number;
  sourceOrderNumber?: string;
  customerId?: number;
  usedAt?: string;
  usedOrderId?: number;
};

type CouponRegistry = Record<string, CouponRegistryEntry>;
function normalizeCouponCode(value: unknown): string {
  return String(value || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
}

const REGISTRY_PATH = join(TM_DATA_ROOT, "coupons", "registry.json");
let lock: Promise<unknown> = Promise.resolve();

async function readRegistry(): Promise<CouponRegistry> {
  return (await readSignedJson<CouponRegistry>(REGISTRY_PATH)) || {};
}

async function mutate<T>(fn: (registry: CouponRegistry) => Promise<T> | T): Promise<T> {
  const operation = lock.then(async () => {
    const registry = await readRegistry();
    const result = await fn(registry);
    await writeSignedJson(REGISTRY_PATH, registry);
    return result;
  });
  lock = operation.catch(() => undefined);
  return operation;
}

export async function registerIssuedCoupon(input: {
  code: string;
  sourceOrderId?: number | string;
  sourceOrderNumber?: number | string;
  customerId?: number;
}): Promise<CouponRegistryEntry> {
  const code = normalizeCouponCode(input.code);
  if (!code) throw new Error("Chýba kód kupónu.");
  return mutate((registry) => {
    const current = registry[code];
    if (current) return current;
    const entry: CouponRegistryEntry = {
      code,
      issuedAt: new Date().toISOString(),
      sourceOrderId: Number(input.sourceOrderId) || undefined,
      sourceOrderNumber: input.sourceOrderNumber ? String(input.sourceOrderNumber) : undefined,
      customerId: Number(input.customerId) || undefined,
    };
    registry[code] = entry;
    return entry;
  });
}

export async function getIssuedCoupon(codeValue: unknown): Promise<CouponRegistryEntry | null> {
  const code = normalizeCouponCode(codeValue);
  if (!code) return null;
  const registry = await readRegistry();
  return registry[code] || null;
}

export async function markIssuedCouponUsed(codeValue: unknown, orderId?: number | string): Promise<void> {
  const code = normalizeCouponCode(codeValue);
  if (!code) return;
  await mutate((registry) => {
    const current = registry[code];
    if (!current) {
      registry[code] = {
        code,
        issuedAt: new Date().toISOString(),
        usedAt: new Date().toISOString(),
        usedOrderId: Number(orderId) || undefined,
      };
      return;
    }
    current.usedAt = current.usedAt || new Date().toISOString();
    current.usedOrderId = Number(orderId) || current.usedOrderId;
  });
}
