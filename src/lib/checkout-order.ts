import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getWooBaseUrl, getWooAuthHeader, wooRequest } from "./woo-client";
import { sendOrderConfirmationEmail } from "./mail";
import { reserveLoyaltyDiscount } from "./loyalty";
import { grantThankYouCoupon, markCouponUsed, type CouponResult } from "./coupons";
import { CheckoutProfiler } from "./checkout-profiler";

export type NormalizedCartItem = {
  id: string;
  productId?: string | number;
  product_id?: string | number;
  sku: string;
  name: string;
  price: number;
  qty: number;
  product_type_key?: string;
  product_type_label?: string;
};

export type CheckoutOrderSource = {
  orderNumber: string;
  paymentId?: string;
  paymentState?: string;
  amountCents?: number;
  currency: string;
  cart: NormalizedCartItem[];
  billing: Record<string, any>;
  delivery: Record<string, any>;
  contact: Record<string, any>;
  shippingCode: string;
  shippingLabel: string;
  shippingPrice: number;
  paymentCode: string;
  paymentLabel: string;
  paymentPrice: number;
  loyaltyDiscount?: number;
  loyaltyPointsUsed?: number;
  coupon?: CouponResult | null;
  subtotal: number;
  total: number;
  createdAt: string;
  customerId?: number;
  wooOrderId?: number;
  wooOrderNumber?: string;
  processedAt?: string;
};

export type GoPayPayment = {
  id?: string | number;
  state?: string;
  order_number?: string;
  amount?: number;
  currency?: string;
};

const STORE_DIR = join(process.cwd(), ".tm-cache", "gopay-orders");

function cleanKey(value: string) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

async function ensureStoreDir() {
  await mkdir(STORE_DIR, { recursive: true });
}

function storePath(paymentId: string) {
  return join(STORE_DIR, `${cleanKey(paymentId)}.json`);
}

function money(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/\s/g, "").replace("€", "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

const VAT_RATE = 0.23;

function netFromGross(value: unknown) {
  return money(money(value) / (1 + VAT_RATE));
}

function vatFromGross(value: unknown) {
  return money(money(value) - netFromGross(value));
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function isCompatibleDiscountItem(item: NormalizedCartItem) {
  const type = String(item.product_type_key || "").toLowerCase();
  const label = String(item.product_type_label || item.name || "").toLowerCase();
  return type === "compatible" || label.includes("kompatibil");
}

function discountRate(item: NormalizedCartItem) {
  if (!isCompatibleDiscountItem(item)) return 0;
  if (item.qty >= 4) return 0.25;
  if (item.qty >= 2) return 0.10;
  return 0;
}

function discountedLineTotal(item: NormalizedCartItem) {
  const original = money(item.price * item.qty);
  const discount = money(original * discountRate(item));
  return money(Math.max(0, original - discount));
}

function splitName(firstName: unknown, lastName: unknown, fallbackName = "") {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  if (first || last) return { first, last };

  const parts = String(fallbackName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1) || "" };
}

function addressFromOrder(source: CheckoutOrderSource, type: "billing" | "shipping") {
  const billing = source.billing || {};
  const delivery = source.delivery || {};
  const contact = source.contact || {};
  const different = Boolean(delivery.differentAddress);
  const base = type === "shipping" && different ? delivery : billing;
  const names = splitName(base.firstName, base.lastName, contact.name);

  return {
    first_name: names.first,
    last_name: names.last,
    company: String(billing.company || ""),
    address_1: String(base.address || base.street || ""),
    address_2: "",
    city: String(base.city || ""),
    state: "",
    postcode: digits(base.zip || base.postcode || ""),
    country: "SK",
    email: String((type === "billing" ? contact.email : delivery.email) || contact.email || ""),
    phone: String((type === "billing" ? contact.phone : delivery.phone) || contact.phone || ""),
  };
}

const PRODUCT_ID_CACHE = new Map<string, number>();

function numericProductId(item: NormalizedCartItem) {
  const raw = (item as any).product_id || (item as any).productId || item.id;
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

async function resolveProductIdBySku(sku: string) {
  const cleanSku = String(sku || "").trim();
  if (!cleanSku) return 0;
  if (PRODUCT_ID_CACHE.has(cleanSku)) return PRODUCT_ID_CACHE.get(cleanSku) || 0;

  try {
    const products = await wooRequest<any[]>("/products", { query: { sku: cleanSku, per_page: 1 } });
    const id = Number(Array.isArray(products) && products[0]?.id ? products[0].id : 0);
    PRODUCT_ID_CACHE.set(cleanSku, Number.isInteger(id) && id > 0 ? id : 0);
    return PRODUCT_ID_CACHE.get(cleanSku) || 0;
  } catch (error) {
    console.error("Woo product lookup by SKU failed:", cleanSku, (error as any)?.message || error);
    PRODUCT_ID_CACHE.set(cleanSku, 0);
    return 0;
  }
}

async function lineItems(source: CheckoutOrderSource) {
  const lines = [];

  for (const item of source.cart) {
    const total = discountedLineTotal(item);
    const productId = numericProductId(item) || await resolveProductIdBySku(item.sku);

    const line: Record<string, any> = {
      name: item.name,
      quantity: item.qty,
      subtotal: total.toFixed(2),
      total: total.toFixed(2),
      tax_status: "taxable",
      meta_data: [
        { key: "sku", value: item.sku || "" },
        { key: "product_type_key", value: item.product_type_key || "" },
        { key: "product_type_label", value: item.product_type_label || "" },
      ],
    };

    if (productId > 0) line.product_id = productId;
    else if (!item.sku) throw new Error(`ID produktu alebo SKU je povinné: ${item.name}`);

    lines.push(line);
  }

  return lines;
}


function pickupValue(pickup: any, keys: string[]) {
  for (const key of keys) {
    const value = pickup?.[key] ?? pickup?.raw?.[key] ?? pickup?.raw_result?.[key] ?? pickup?.data?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function selectedPickup(source: CheckoutOrderSource) {
  const pickup = source.delivery?.pickup || {};
  const id = pickupValue(pickup, ["id", "parcelshop_id", "parcelShopId", "parcel_shop_id", "pudo_id", "pickup_id", "depot", "code"]);
  const name = pickupValue(pickup, ["name", "parcelshop_name", "parcelShopName", "shop_name"]);
  const street = pickupValue(pickup, ["street", "address", "address1"]);
  const city = pickupValue(pickup, ["city", "town"]);
  const postcode = pickupValue(pickup, ["zip", "postalcode", "postal_code", "postcode"]);
  const country = pickupValue(pickup, ["country", "countrycode", "country_code"]) || "SK";
  const isLocker = /box|locker|bal[ií]komat|parcelocker/i.test(`${source.shippingCode} ${pickupValue(pickup, ["type", "name", "description"])} ${pickup?.isparcelocker || ""}`);

  return { id, name, street, city, postcode, country, isLocker, raw: pickup };
}

function pickupLabel(source: CheckoutOrderSource) {
  const p = selectedPickup(source);
  const parts = [p.name, p.street, [p.postcode, p.city].filter(Boolean).join(" ")].filter(Boolean);
  return parts.join(", ");
}

function shippingLine(source: CheckoutOrderSource) {
  const p = selectedPickup(source);
  const carrier = source.shippingCode.startsWith("gls_") ? "gls" : source.shippingCode.startsWith("dpd_") ? "dpd" : "shipping";
  const isPickup = ["gls_pickup", "dpd_pickup", "dpd_box"].includes(source.shippingCode);
  const title = isPickup && pickupLabel(source) ? `${source.shippingLabel} – ${pickupLabel(source)}` : source.shippingLabel || "Doprava";

  const meta = [
    { key: "tm_shipping_code", value: source.shippingCode || "" },
    { key: "tm_shipping_pickup_id", value: p.id },
    { key: "tm_shipping_pickup_name", value: p.name },
    { key: "tm_shipping_pickup_street", value: p.street },
    { key: "tm_shipping_pickup_city", value: p.city },
    { key: "tm_shipping_pickup_postcode", value: p.postcode },
    { key: "tm_shipping_pickup_country", value: p.country },
  ];

  if (carrier === "gls") {
    meta.push(
      { key: "gls_pickup_id", value: p.id },
      { key: "_gls_pickup_id", value: p.id },
      { key: "gls_parcelshop_id", value: p.id },
      { key: "_gls_parcelshop_id", value: p.id },
      { key: "gls_parcelshop_name", value: p.name },
      { key: "gls_parcelshop_address", value: pickupLabel(source) },
    );
  }

  if (carrier === "dpd") {
    meta.push(
      { key: "dpd_pickup_id", value: p.id },
      { key: "_dpd_pickup_id", value: p.id },
      { key: "dpd_parcelshop_id", value: p.id },
      { key: "_dpd_parcelshop_id", value: p.id },
      { key: "dpd_pudo_id", value: p.id },
      { key: "_dpd_pudo_id", value: p.id },
      { key: "dpd_pickup_type", value: p.isLocker ? "box" : "pickup" },
      { key: "dpd_pickup_address", value: pickupLabel(source) },
    );
  }

  return {
    method_id: source.shippingCode || "shipping",
    method_title: title,
    total: money(source.shippingPrice).toFixed(2),
    meta_data: meta.filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== ""),
  };
}

function orderMeta(source: CheckoutOrderSource, paymentId: string, isCompany: boolean, payment: ReturnType<typeof wooPaymentMethod>) {
  const p = selectedPickup(source);
  const pickupText = pickupLabel(source);
  const meta = [
    { key: "source", value: "tonerymaxim" },
    { key: "sales_channel", value: "tonerymaxim" },
    { key: "created_via", value: source.paymentCode === "gopay" ? "tonerymaxim_astro_gopay" : "tonerymaxim_astro_checkout" },
    { key: "tm_order_number", value: source.orderNumber || "" },
    { key: "gopay_payment_id", value: paymentId },
    { key: "gopay_order_number", value: source.orderNumber || "" },
    { key: "gopay_state", value: String(source.paymentState || "") },
    { key: "tm_payment_amount_cents", value: String(source.amountCents || "") },
    { key: "tm_payment_code", value: source.paymentCode || "" },
    { key: "tm_payment_title", value: payment.title || source.paymentLabel || "" },
    { key: "tm_loyalty_discount", value: money(source.loyaltyDiscount).toFixed(2) },
    { key: "tm_loyalty_points_used", value: String(source.loyaltyPointsUsed || "") },
    { key: "tm_coupon_code", value: String(source.coupon?.code || "") },
    { key: "tm_coupon_type", value: String(source.coupon?.type || "") },
    { key: "tm_coupon_discount", value: money(source.coupon?.discount).toFixed(2) },
    { key: "tm_shipping_code", value: source.shippingCode || "" },
    { key: "tm_shipping_title", value: source.shippingLabel || "" },
    { key: "tm_company_order", value: isCompany ? "1" : "0" },
    { key: "tm_ico", value: String(source.billing?.ico || "") },
    { key: "tm_dic", value: String(source.billing?.dic || "") },
    { key: "tm_ic_dph", value: String(source.billing?.icDph || source.billing?.ic_dph || "") },
    { key: "tm_customer_email", value: String(source.contact?.email || source.billing?.email || "") },
    { key: "tm_shipping_pickup", value: JSON.stringify(source.delivery?.pickup || {}) },
    { key: "tm_shipping_pickup_id", value: p.id },
    { key: "tm_shipping_pickup_text", value: pickupText },
  ];

  if (source.shippingCode.startsWith("gls_")) {
    meta.push(
      { key: "gls_pickup_id", value: p.id },
      { key: "_gls_pickup_id", value: p.id },
      { key: "gls_parcelshop_id", value: p.id },
      { key: "_gls_parcelshop_id", value: p.id },
    );
  }

  if (source.shippingCode.startsWith("dpd_")) {
    meta.push(
      { key: "dpd_pickup_id", value: p.id },
      { key: "_dpd_pickup_id", value: p.id },
      { key: "dpd_parcelshop_id", value: p.id },
      { key: "_dpd_parcelshop_id", value: p.id },
      { key: "dpd_pudo_id", value: p.id },
      { key: "_dpd_pudo_id", value: p.id },
    );
  }

  return meta.filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== "");
}

function feeLines(source: CheckoutOrderSource) {
  const fees = [];
  if (money(source.coupon?.discount) > 0) {
    fees.push({
      name: source.coupon?.label || `Kupón ${source.coupon?.code || ""}`.trim(),
      total: `-${money(source.coupon?.discount).toFixed(2)}`,
      tax_status: "taxable",
    });
  }
  if (money(source.loyaltyDiscount) > 0) {
    fees.push({
      name: "Vernostná zľava",
      total: `-${money(source.loyaltyDiscount).toFixed(2)}`,
      tax_status: "taxable",
    });
  }
  if (source.paymentPrice > 0) {
    fees.push({
      name: source.paymentLabel,
      total: money(source.paymentPrice).toFixed(2),
      tax_status: "taxable",
    });
  }
  return fees;
}

function wooPaymentMethod(source: CheckoutOrderSource) {
  switch (source.paymentCode) {
    case "cod":
      return { method: "cod", title: "Dobierka", status: "processing", paid: false };
    case "bank_prepaid":
      return { method: "bacs", title: "Platba prevodom vopred", status: "on-hold", paid: false };
    case "invoice_org":
      return { method: "invoice_org", title: "Prevodný príkaz pre organizácie a firmy", status: "processing", paid: false };
    case "gopay":
    case "applepay":
    case "googlepay": {
      const state = String(source.paymentState || "").toUpperCase();
      const paid = state === "PAID" || state === "AUTHORIZED";
      return {
        method: "gopay",
        title: source.paymentLabel || "GoPay",
        status: paid ? "processing" : "pending",
        paid,
      };
    }
    default:
      return { method: "gopay", title: source.paymentLabel || "GoPay", status: "pending", paid: false };
  }
}

export async function createWooOrderFromCheckout(source: CheckoutOrderSource, options: { gopayPayment?: GoPayPayment; customerNote?: string; waitForEmail?: boolean } = {}) {
  const profiler = new CheckoutProfiler("woo-order", { orderNumber: source.orderNumber, paymentCode: source.paymentCode });
  const billing = addressFromOrder(source, "billing");
  const shipping = addressFromOrder(source, "shipping");
  profiler.mark("prepare-addresses");
  const isCompany = Boolean(source.billing?.company || source.billing?.ico || source.billing?.dic || source.billing?.icDph);
  const payment = wooPaymentMethod(source);
  const paymentId = String(options.gopayPayment?.id || source.paymentId || "");

  const customerEmail = String(source.contact?.email || source.billing?.email || billing.email || "").trim();
  const customerId = Number(source.customerId || 0);
  const billingForCreate = {
    ...billing,
    email: customerEmail || billing.email || "",
  };

  const lineItemsPayload = await profiler.measure("woo-line-items-resolve", () => lineItems(source));

  const order = await profiler.measure("woo-post-order", () => wooRequest<any>("/orders", {
    method: "POST",
    body: {
      status: payment.status,
      set_paid: payment.paid,
      prices_include_tax: true,
      currency: source.currency || String(options.gopayPayment?.currency || "EUR"),
      payment_method: payment.method,
      payment_method_title: payment.title,
      transaction_id: paymentId || undefined,
      customer_id: customerId > 0 ? customerId : undefined,
      customer_note: options.customerNote || "Objednávka vytvorená z pokladne ToneryMaxim.sk.",
      billing: billingForCreate,
      shipping,
      line_items: lineItemsPayload,
      shipping_lines: [shippingLine(source)],
      fee_lines: feeLines(source),
      meta_data: orderMeta({ ...source, paymentState: String(options.gopayPayment?.state || source.paymentState || "") }, paymentId, isCompany, payment),
    },
  }));

  if (Number(source.customerId || 0) > 0 && source.coupon?.ok) {
    await profiler.measure("coupon-mark-used", () => markCouponUsed(Number(source.customerId), source.coupon, order.id)).catch((error) => console.error("Coupon used meta error:", error?.message || error));
  }

  if (Number(source.customerId || 0) > 0 && order?.id) {
    await profiler.measure("coupon-grant-thank-you", () => grantThankYouCoupon(Number(source.customerId), order.id, order.number || order.id)).catch((error) => console.error("Thank you coupon grant error:", error?.message || error));
  }

  if (Number(source.customerId || 0) > 0 && money(source.loyaltyDiscount) > 0) {
    const used = await profiler.measure("loyalty-reserve", () => reserveLoyaltyDiscount(Number(source.customerId), order.id, source.loyaltyDiscount)).catch((error) => {
      console.error("Loyalty discount reserve error:", error?.message || error);
      return { discount: 0, pointsUsed: 0 };
    });
    if (used.pointsUsed > 0) {
      await profiler.measure("woo-update-billing-email", () => wooRequest<any>(`/orders/${order.id}`, {
        method: "PUT",
        body: {
          meta_data: [
            { key: "tm_loyalty_discount", value: used.discount.toFixed(2) },
            { key: "tm_loyalty_points_used", value: String(used.pointsUsed) },
          ],
        },
      })).catch((error) => console.error("Woo loyalty meta update error:", error?.message || error));
    }
  }

  if (customerEmail) {
    const emailPromise = sendOrderConfirmationEmail({
      to: customerEmail,
      orderNumber: String(order.number || order.id || ""),
      source,
      paymentTitle: payment.title,
      shippingTitle: shippingLine(source).method_title,
    });

    if (options.waitForEmail) {
      await profiler.measure("order-email-send", () => emailPromise).catch((error) => console.error("ToneryMaxim order email error:", error?.message || error));
    } else {
      profiler.mark("email-dispatch-started");
      emailPromise.catch((error) => console.error("ToneryMaxim order email error:", error?.message || error));
    }
  }

  profiler.done({ orderId: order?.id, orderNumber: order?.number || order?.id });

  return {
    created: true,
    orderId: Number(order.id),
    orderNumber: String(order.number || order.id || ""),
    raw: order,
  };
}

export async function savePendingGoPayOrder(source: CheckoutOrderSource) {
  if (!source.paymentId) throw new Error("Chýba GoPay paymentId pre uloženie objednávky.");
  await ensureStoreDir();
  await writeFile(storePath(source.paymentId), JSON.stringify(source, null, 2), "utf8");
  return source;
}

export async function readPendingGoPayOrder(paymentId: string): Promise<CheckoutOrderSource | null> {
  if (!paymentId) return null;
  try {
    const text = await readFile(storePath(paymentId), "utf8");
    return JSON.parse(text) as CheckoutOrderSource;
  } catch {
    return null;
  }
}

async function markWooGoPayOrderPaid(source: CheckoutOrderSource, payment: GoPayPayment) {
  const orderId = Number(source.wooOrderId || 0);
  if (!orderId) return null;

  const paymentId = String(payment?.id || source.paymentId || "");
  const updated = await wooRequest<any>(`/orders/${orderId}`, {
    method: "PUT",
    body: {
      status: "processing",
      set_paid: true,
      transaction_id: paymentId || undefined,
      meta_data: [
        { key: "gopay_payment_id", value: paymentId },
        { key: "gopay_state", value: String(payment?.state || "PAID") },
        { key: "tm_payment_paid_at", value: new Date().toISOString() },
      ],
    },
  });

  return {
    created: false,
    orderId: Number(updated?.id || orderId),
    orderNumber: String(updated?.number || source.wooOrderNumber || orderId),
  };
}

const GOPAY_PROCESS_LOCKS = new Map<string, Promise<{ created: boolean; orderId: number; orderNumber: string }>>();

async function processPaidGoPayOrderInternal(payment: GoPayPayment) {
  const paymentId = String(payment?.id || "");
  if (!paymentId) throw new Error("Chýba ID GoPay platby.");

  const source = await readPendingGoPayOrder(paymentId);
  if (!source) throw new Error(`Nenájdené uložené dáta objednávky pre GoPay platbu ${paymentId}.`);

  if (source.wooOrderId) {
    const paidUpdate = await markWooGoPayOrderPaid(source, payment);
    const updated: CheckoutOrderSource = {
      ...source,
      paymentState: String(payment.state || "PAID"),
      wooOrderId: paidUpdate?.orderId || source.wooOrderId,
      wooOrderNumber: paidUpdate?.orderNumber || source.wooOrderNumber || String(source.wooOrderId),
      processedAt: new Date().toISOString(),
    };
    await savePendingGoPayOrder(updated);
    return paidUpdate || {
      created: false,
      orderId: source.wooOrderId,
      orderNumber: source.wooOrderNumber || String(source.wooOrderId),
    };
  }

  const result = await createWooOrderFromCheckout(
    { ...source, paymentState: String(payment.state || "PAID") },
    {
      gopayPayment: payment,
      customerNote: "Objednávka vytvorená automaticky po úspešnej GoPay platbe.",
    }
  );

  const updated: CheckoutOrderSource = {
    ...source,
    paymentState: String(payment.state || "PAID"),
    wooOrderId: result.orderId,
    wooOrderNumber: result.orderNumber,
    processedAt: new Date().toISOString(),
  };

  await savePendingGoPayOrder(updated);

  return {
    created: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
  };
}

export async function processPaidGoPayOrder(payment: GoPayPayment) {
  const paymentId = String(payment?.id || "");
  if (!paymentId) throw new Error("Chýba ID GoPay platby.");

  const running = GOPAY_PROCESS_LOCKS.get(paymentId);
  if (running) return running;

  const job = processPaidGoPayOrderInternal(payment);
  GOPAY_PROCESS_LOCKS.set(paymentId, job);

  try {
    return await job;
  } finally {
    GOPAY_PROCESS_LOCKS.delete(paymentId);
  }
}
