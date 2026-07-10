import { getCustomerMeta, getWooCustomerById, updateWooCustomer, welcomeCouponCode } from "./woo-client";
import type { NormalizedCartItem } from "./checkout-order";

export type CouponType = "welcome5" | "thankyou7" | "marketing";
export type CouponScope = "all" | "compatible";
export type CouponStatus = "active" | "used" | "expired";

export type StoredCoupon = {
  code: string;
  type: CouponType;
  label: string;
  percent: number;
  scope: CouponScope;
  status: CouponStatus;
  createdAt: string;
  expiresAt?: string;
  sourceOrderId?: number;
  sourceOrderNumber?: string;
  usedAt?: string;
  usedOrderId?: number;
};

export type CouponResult = {
  ok: boolean;
  code: string;
  type?: CouponType;
  label?: string;
  percent?: number;
  scope?: CouponScope;
  discount?: number;
  expiresAt?: string;
  reason?: string;
};

export const CUSTOMER_COUPONS_META = "tm_coupon_wallet";

function money(value: unknown) {
  const number = Number(String(value ?? "0").replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function isExpired(expiresAt: unknown) {
  if (!expiresAt) return false;
  const time = new Date(String(expiresAt || "")).getTime();
  return !Number.isFinite(time) || time <= Date.now();
}

function compatibleItem(item: NormalizedCartItem) {
  const type = String(item.product_type_key || "").toLowerCase();
  const label = String(item.product_type_label || item.name || "").toLowerCase();
  return type === "compatible" || label.includes("kompatibil");
}

function lineDiscountRate(item: NormalizedCartItem) {
  if (!compatibleItem(item)) return 0;
  if (item.qty >= 4) return 0.25;
  if (item.qty >= 2) return 0.1;
  return 0;
}

function lineAfterQuantityDiscount(item: NormalizedCartItem) {
  const gross = money(item.price * item.qty);
  return money(gross - gross * lineDiscountRate(item));
}

function subtotalAfterQuantityDiscount(cart: NormalizedCartItem[]) {
  return money(cart.reduce((sum, item) => sum + lineAfterQuantityDiscount(item), 0));
}

function compatibleSubtotalAfterQuantityDiscount(cart: NormalizedCartItem[]) {
  return money(cart.filter(compatibleItem).reduce((sum, item) => sum + lineAfterQuantityDiscount(item), 0));
}

function safeParseCoupons(value: unknown): StoredCoupon[] {
  if (Array.isArray(value)) return value.filter(Boolean) as StoredCoupon[];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function normalizeCouponCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

export function thankYouCouponCode(orderIdOrNumber: number | string): string {
  return `MAXIM${String(orderIdOrNumber || "").replace(/\D/g, "") || Date.now()}`;
}

export function activeStoredCoupon(coupon: StoredCoupon) {
  return coupon.status === "active" && !isExpired(coupon.expiresAt);
}

export function couponUsageText(coupon: Pick<StoredCoupon, "type" | "scope" | "expiresAt">) {
  if (coupon.type === "thankyou7") return "Platný na ďalšiu objednávku";
  if (coupon.expiresAt) return `Platí do ${new Date(coupon.expiresAt).toLocaleDateString("sk-SK")}`;
  return coupon.scope === "compatible" ? "Platný na kompatibilné produkty" : "Platný na celý sortiment";
}

export async function getBestAutoCoupon(customerId: number | undefined, cart: NormalizedCartItem[]): Promise<CouponResult | null> {
  if (!customerId || !cart.length) return null;

  const customer = await getWooCustomerById(customerId);
  if (!customer) return null;

  const candidates: CouponResult[] = [];
  const expectedWelcome = normalizeCouponCode(welcomeCouponCode(customerId));
  const welcomeUsed = String(getCustomerMeta(customer, "tm_welcome_discount_used") || "no").toLowerCase() === "yes";
  const welcomeExpires = String(getCustomerMeta(customer, "tm_welcome_discount_expires") || "");
  const welcomePercent = Number(getCustomerMeta(customer, "tm_welcome_discount_percent") || 5) || 5;
  if (!welcomeUsed && welcomeExpires && !isExpired(welcomeExpires)) {
    const discount = couponDiscount({ percent: welcomePercent, scope: "all" }, cart);
    if (discount > 0) candidates.push({ ok: true, code: expectedWelcome, type: "welcome5", label: `Uvítacia zľava ${welcomePercent} %`, percent: welcomePercent, scope: "all", discount, expiresAt: welcomeExpires });
  }

  const coupons = await getCustomerStoredCoupons(customerId);
  for (const coupon of coupons.filter(activeStoredCoupon)) {
    const discount = couponDiscount(coupon, cart);
    if (discount > 0) {
      candidates.push({ ok: true, code: coupon.code, type: coupon.type, label: coupon.label, percent: coupon.percent, scope: coupon.scope, discount, expiresAt: coupon.expiresAt });
    }
  }

  candidates.sort((a, b) => Number(b.discount || 0) - Number(a.discount || 0));
  return candidates[0] || null;
}

export async function getCustomerStoredCoupons(customerId: number): Promise<StoredCoupon[]> {
  const customer = await getWooCustomerById(customerId);
  if (!customer) return [];
  const coupons = safeParseCoupons(getCustomerMeta(customer, CUSTOMER_COUPONS_META));
  let changed = false;
  const normalized = coupons.map((coupon) => {
    if (coupon.status === "active" && isExpired(coupon.expiresAt)) {
      changed = true;
      return { ...coupon, status: "expired" as CouponStatus };
    }
    return coupon;
  });
  if (changed) {
    await updateWooCustomer(customerId, { meta_data: [{ key: CUSTOMER_COUPONS_META, value: JSON.stringify(normalized) }] });
  }
  return normalized;
}

export async function getCustomerActiveCoupons(customerId: number): Promise<StoredCoupon[]> {
  const coupons = await getCustomerStoredCoupons(customerId);
  return coupons.filter(activeStoredCoupon);
}

export async function grantThankYouCoupon(customerId: number | undefined, orderId: number | string, orderNumber?: string | number) {
  if (!customerId || !orderId) return null;
  const customer = await getWooCustomerById(customerId);
  if (!customer) return null;

  const coupons = safeParseCoupons(getCustomerMeta(customer, CUSTOMER_COUPONS_META));
  const sourceOrderId = Number(orderId) || undefined;
  if (sourceOrderId && coupons.some((coupon) => Number(coupon.sourceOrderId || 0) === sourceOrderId && coupon.type === "thankyou7")) {
    return coupons.find((coupon) => Number(coupon.sourceOrderId || 0) === sourceOrderId && coupon.type === "thankyou7") || null;
  }

  const visibleNumber = String(orderNumber || orderId);
  const coupon: StoredCoupon = {
    code: thankYouCouponCode(visibleNumber),
    type: "thankyou7",
    label: "Zľava 7 % na kompatibilné produkty",
    percent: 7,
    scope: "compatible",
    status: "active",
    createdAt: new Date().toISOString(),
    sourceOrderId,
    sourceOrderNumber: visibleNumber,
  };

  const updated = [coupon, ...coupons].slice(0, 100);
  await updateWooCustomer(customerId, { meta_data: [{ key: CUSTOMER_COUPONS_META, value: JSON.stringify(updated) }] });
  return coupon;
}

function discountBaseForCoupon(coupon: Pick<StoredCoupon, "scope">, cart: NormalizedCartItem[]) {
  return coupon.scope === "compatible" ? compatibleSubtotalAfterQuantityDiscount(cart) : subtotalAfterQuantityDiscount(cart);
}

function couponDiscount(coupon: Pick<StoredCoupon, "percent" | "scope">, cart: NormalizedCartItem[]) {
  return money(discountBaseForCoupon(coupon, cart) * (Number(coupon.percent || 0) / 100));
}

function isGuestThankYouCouponCode(code: string) {
  return /^MAXIM\d{4,}$/.test(normalizeCouponCode(code));
}

function guestThankYouCouponResult(code: string, cart: NormalizedCartItem[]): CouponResult {
  const coupon = { percent: 7, scope: "compatible" as CouponScope };
  const discount = couponDiscount(coupon, cart);
  if (discount <= 0) {
    return { ok: false, code, reason: "Kupón platí iba na kompatibilné produkty." };
  }
  return {
    ok: true,
    code: normalizeCouponCode(code),
    type: "thankyou7",
    label: "Zľava 7 % na kompatibilné produkty",
    percent: 7,
    scope: "compatible",
    discount,
  };
}

export async function validateCheckoutCoupon(customerId: number | undefined, rawCode: unknown, cart: NormalizedCartItem[]): Promise<CouponResult> {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { ok: false, code: "", reason: "Zadajte kód kupónu." };
  if (isGuestThankYouCouponCode(code)) return guestThankYouCouponResult(code, cart);
  if (!customerId) return { ok: false, code, reason: "Pre použitie kupónu sa prihláste alebo použite kupón z poslednej objednávky." };

  const customer = await getWooCustomerById(customerId);
  if (!customer) return { ok: false, code, reason: "Zákaznícky účet sa nenašiel." };

  const expectedWelcome = normalizeCouponCode(welcomeCouponCode(customerId));
  if (code === expectedWelcome) {
    const expiresAt = String(getCustomerMeta(customer, "tm_welcome_discount_expires") || "");
    const used = String(getCustomerMeta(customer, "tm_welcome_discount_used") || "no").toLowerCase() === "yes";
    const percent = Number(getCustomerMeta(customer, "tm_welcome_discount_percent") || 5) || 5;
    if (!expiresAt || isExpired(expiresAt)) return { ok: false, code, reason: "Uvítací kupón už expiroval." };
    if (used) return { ok: false, code, reason: "Uvítací kupón už bol použitý." };
    const coupon = { percent, scope: "all" as CouponScope };
    const discount = couponDiscount(coupon, cart);
    if (discount <= 0) return { ok: false, code, reason: "Kupón nie je možné použiť na prázdny košík." };
    return { ok: true, code, type: "welcome5", label: `Uvítacia zľava ${percent} %`, percent, scope: "all", discount, expiresAt };
  }

  const coupons = await getCustomerStoredCoupons(customerId);
  const coupon = coupons.find((item) => normalizeCouponCode(item.code) === code);
  if (!coupon) return { ok: false, code, reason: "Neplatný alebo neznámy kupón." };
  if (coupon.status === "used") return { ok: false, code, reason: "Kupón už bol použitý." };
  if (!activeStoredCoupon(coupon)) return { ok: false, code, reason: "Kupón už expiroval." };

  const discount = couponDiscount(coupon, cart);
  if (discount <= 0) {
    return {
      ok: false,
      code,
      reason: coupon.scope === "compatible" ? "Kupón platí iba na kompatibilné produkty." : "Kupón nie je možné použiť na prázdny košík.",
    };
  }

  return {
    ok: true,
    code: coupon.code,
    type: coupon.type,
    label: coupon.label,
    percent: coupon.percent,
    scope: coupon.scope,
    discount,
    expiresAt: coupon.expiresAt,
  };
}

export async function markCouponUsed(customerId: number | undefined, coupon: CouponResult | undefined, orderId?: number | string) {
  if (!customerId || !coupon?.ok || !coupon.type) return;
  if (coupon.type === "welcome5") {
    await updateWooCustomer(customerId, { meta_data: [{ key: "tm_welcome_discount_used", value: "yes" }] });
    return;
  }

  const customer = await getWooCustomerById(customerId);
  if (!customer) return;
  const coupons = safeParseCoupons(getCustomerMeta(customer, CUSTOMER_COUPONS_META));
  const code = normalizeCouponCode(coupon.code);
  const updated = coupons.map((item) => {
    if (normalizeCouponCode(item.code) !== code) return item;
    return {
      ...item,
      status: "used" as CouponStatus,
      usedAt: new Date().toISOString(),
      usedOrderId: Number(orderId) || item.usedOrderId,
    };
  });
  await updateWooCustomer(customerId, { meta_data: [{ key: CUSTOMER_COUPONS_META, value: JSON.stringify(updated) }] });
}
