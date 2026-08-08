import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TM_CACHE_ROOT } from './runtime-paths';
import { readSignedJson, writeSignedJson, TM_DATA_ROOT } from "./secure-persistence";
import { wooRequest } from "./woo-client";
import { sendOrderAdminCopyEmail, sendOrderConfirmationEmail } from "./mail";
import { reserveLoyaltyDiscount } from "./loyalty";
import { grantThankYouCoupon, markCouponUsed, thankYouCouponCode, type CouponResult } from "./coupons";
import { registerIssuedCoupon } from "./coupon-registry";
import { CheckoutProfiler } from "./checkout-profiler";
import { sendHeurekaVerifiedOrder } from "./heureka-verified";

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
  originalSubtotal?: number;
  quantityDiscount?: number;
  subtotal: number;
  total: number;
  createdAt: string;
  termsAcceptedAt?: string;
  heurekaConsent?: boolean;
  heurekaConsentAt?: string;
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

const STORE_DIR = join(TM_DATA_ROOT, "gopay-orders");
const LEGACY_STORE_DIR = join(TM_CACHE_ROOT, 'gopay-orders');

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
let STANDARD_TAX_RATE_ID: number | null = null;

async function resolveStandardTaxRateId() {
  if (STANDARD_TAX_RATE_ID !== null) return STANDARD_TAX_RATE_ID;
  try {
    const rates = await wooRequest<any[]>("/taxes", { query: { per_page: 100 } });
    const preferred = (Array.isArray(rates) ? rates : []).find((rate: any) =>
      Number(rate?.rate) === 23 &&
      (!rate?.country || String(rate.country).toUpperCase() === "SK") &&
      (!rate?.class || String(rate.class) === "standard")
    ) || (Array.isArray(rates) ? rates : []).find((rate: any) => Number(rate?.rate) === 23);
    STANDARD_TAX_RATE_ID = Number(preferred?.id || 0);
  } catch (error) {
    console.error("Woo tax rate lookup failed:", (error as any)?.message || error);
    STANDARD_TAX_RATE_ID = 0;
  }
  return STANDARD_TAX_RATE_ID;
}

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

async function lineItems(source: CheckoutOrderSource, taxRateId: number) {
  const lines = [];

  for (const item of source.cart) {
    const originalGross = money(item.price * item.qty);
    const finalGross = discountedLineTotal(item);
    const originalNet = netFromGross(originalGross);
    const finalNet = netFromGross(finalGross);
    const originalTax = money(originalGross - originalNet);
    const finalTax = money(finalGross - finalNet);
    const lineDiscountGross = money(originalGross - finalGross);
    const productId = numericProductId(item) || await resolveProductIdBySku(item.sku);

    const line: Record<string, any> = {
      name: item.name,
      quantity: item.qty,
      subtotal: originalNet.toFixed(2),
      subtotal_tax: originalTax.toFixed(2),
      total: finalNet.toFixed(2),
      total_tax: finalTax.toFixed(2),
      tax_status: "taxable",
      ...(taxRateId > 0 ? { taxes: [{ id: taxRateId, subtotal: originalTax.toFixed(2), total: finalTax.toFixed(2) }] } : {}),
      meta_data: [
        { key: "sku", value: item.sku || "" },
        { key: "product_type_key", value: item.product_type_key || "" },
        { key: "product_type_label", value: item.product_type_label || "" },
        { key: "tm_gross_line_subtotal", value: originalGross.toFixed(2) },
        { key: "tm_gross_line_total", value: finalGross.toFixed(2) },
        { key: "tm_gross_line_discount", value: lineDiscountGross.toFixed(2) },
        { key: "tm_quantity_discount_rate", value: String(discountRate(item)) },
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
  const id = pickupValue(pickup, ["pickup_id", "id", "parcelshop_id", "parcelShopId", "parcel_shop_id", "pudo_id", "depot", "code"]);
  const name = pickupValue(pickup, ["pickup_name", "name", "title", "company", "parcelshop_name", "parcelShopName", "shop_name"]);
  const street = pickupValue(pickup, ["pickup_address", "street", "address", "addressText", "address1", "parcelshop_address", "pickupPointAddress"]);
  const city = pickupValue(pickup, ["pickup_city", "city", "town", "municipality"]);
  const postcode = pickupValue(pickup, ["pickup_zip", "zip", "zipCode", "postalcode", "postalCode", "postal_code", "postcode"]);
  const country = pickupValue(pickup, ["pickup_country", "country", "countrycode", "countryCode", "country_code"]) || "SK";
  const isLocker = /box|locker|bal[ií]komat|parcelocker/i.test(`${source.shippingCode} ${pickupValue(pickup, ["type", "name", "description"])} ${pickup?.isparcelocker || ""}`);

  return { id, name, street, city, postcode, country, isLocker, raw: pickup };
}

function pickupLabel(source: CheckoutOrderSource) {
  const p = selectedPickup(source);
  const parts = [p.name, p.street, [p.postcode, p.city].filter(Boolean).join(" ")].filter(Boolean);
  return parts.join(", ");
}

function shippingLine(source: CheckoutOrderSource, taxRateId = 0) {
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

  const gross = money(source.shippingPrice);
  const net = netFromGross(gross);
  const tax = money(gross - net);

  return {
    method_id: source.shippingCode || "shipping",
    method_title: title,
    total: net.toFixed(2),
    total_tax: tax.toFixed(2),
    ...(taxRateId > 0 ? { taxes: [{ id: taxRateId, total: tax.toFixed(2) }] } : {}),
    meta_data: [
      ...meta,
      { key: "tm_gross_shipping_total", value: gross.toFixed(2) },
    ].filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== ""),
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
    { key: "tm_quantity_discount", value: money(source.quantityDiscount).toFixed(2) },
    { key: "tm_original_subtotal", value: money(source.originalSubtotal).toFixed(2) },
    { key: "tm_order_total_gross", value: money(source.total).toFixed(2) },
    { key: "tm_shipping_code", value: source.shippingCode || "" },
    { key: "tm_shipping_title", value: source.shippingLabel || "" },
    { key: "tm_company_order", value: isCompany ? "1" : "0" },
    { key: "tm_ico", value: String(source.billing?.ico || "") },
    { key: "tm_dic", value: String(source.billing?.dic || "") },
    { key: "tm_ic_dph", value: String(source.billing?.icDph || source.billing?.ic_dph || "") },
    { key: "billing_ico", value: String(source.billing?.ico || "") },
    { key: "_billing_ico", value: String(source.billing?.ico || "") },
    { key: "billing_dic", value: String(source.billing?.dic || "") },
    { key: "_billing_dic", value: String(source.billing?.dic || "") },
    { key: "billing_ic_dph", value: String(source.billing?.icDph || source.billing?.ic_dph || "") },
    { key: "_billing_ic_dph", value: String(source.billing?.icDph || source.billing?.ic_dph || "") },
    { key: "tm_customer_email", value: String(source.contact?.email || source.billing?.email || "") },
    { key: "tm_terms_accepted", value: source.termsAcceptedAt ? "1" : "0" },
    { key: "tm_terms_accepted_at", value: String(source.termsAcceptedAt || "") },
    { key: "tm_heureka_consent", value: source.heurekaConsent === true ? "1" : "0" },
    { key: "tm_heureka_consent_at", value: String(source.heurekaConsentAt || "") },
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

  const snapshot = {
    version: 2,
    orderNumber: source.orderNumber,
    currency: source.currency || "EUR",
    originalSubtotal: money(source.originalSubtotal),
    quantityDiscount: money(source.quantityDiscount),
    subtotal: money(source.subtotal),
    couponDiscount: money(source.coupon?.discount),
    couponCode: String(source.coupon?.code || ""),
    couponLabel: String(source.coupon?.label || "Kupónová zľava"),
    loyaltyDiscount: money(source.loyaltyDiscount),
    loyaltyPointsUsed: Number(source.loyaltyPointsUsed || 0),
    shippingPrice: money(source.shippingPrice),
    shippingLabel: source.shippingLabel || "",
    paymentPrice: money(source.paymentPrice),
    paymentCode: source.paymentCode || "",
    paymentLabel: payment.title || source.paymentLabel || "",
    total: money(source.total),
    billing: source.billing || {},
    delivery: source.delivery || {},
    contact: source.contact || {},
    heurekaConsent: source.heurekaConsent === true,
    heurekaConsentAt: source.heurekaConsentAt || "",
    items: source.cart.map((item) => ({
      name: item.name,
      sku: item.sku,
      qty: item.qty,
      unitGross: money(item.price),
      originalGross: money(item.price * item.qty),
      discountRate: discountRate(item),
      discountGross: money(item.price * item.qty - discountedLineTotal(item)),
      totalGross: discountedLineTotal(item),
    })),
  };
  meta.push({ key: "tm_order_snapshot", value: JSON.stringify(snapshot) });
  return meta.filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== "");
}

function feeLines(source: CheckoutOrderSource, taxRateId = 0) {
  const fees: Array<{
    name: string;
    total: string;
    total_tax: string;
    tax_status: string;
    taxes?: Array<{ id: number; total: string }>;
    meta_data: Array<{ key: string; value: string }>;
  }> = [];

  const addGrossFee = (name: string, grossValue: number) => {
    const gross = money(grossValue);
    const sign = gross < 0 ? -1 : 1;
    const absNet = netFromGross(Math.abs(gross));
    const net = money(absNet * sign);
    const tax = money((Math.abs(gross) - absNet) * sign);
    fees.push({
      name,
      total: net.toFixed(2),
      total_tax: tax.toFixed(2),
      tax_status: "taxable",
      ...(taxRateId > 0 ? { taxes: [{ id: taxRateId, total: tax.toFixed(2) }] } : {}),
      meta_data: [{ key: "tm_gross_fee_total", value: gross.toFixed(2) }],
    });
  };

  if (money(source.coupon?.discount) > 0) {
    addGrossFee(source.coupon?.label || `Kupón ${source.coupon?.code || ""}`.trim(), -money(source.coupon?.discount));
  }
  if (money(source.loyaltyDiscount) > 0) {
    addGrossFee("Vernostná zľava", -money(source.loyaltyDiscount));
  }
  if (source.paymentPrice > 0) {
    addGrossFee(source.paymentLabel, money(source.paymentPrice));
  }
  return fees;
}


function predictedWooGross(grossValue: number) {
  const gross = money(grossValue);
  const sign = gross < 0 ? -1 : 1;
  const net = money(Math.abs(gross) / (1 + VAT_RATE));
  const tax = money(net * VAT_RATE);
  return money((net + tax) * sign);
}

function roundingAdjustment(source: CheckoutOrderSource) {
  let predicted = 0;
  for (const item of source.cart) predicted += predictedWooGross(discountedLineTotal(item));
  predicted += predictedWooGross(source.shippingPrice);
  predicted += predictedWooGross(source.paymentPrice);
  predicted += predictedWooGross(-money(source.coupon?.discount));
  predicted += predictedWooGross(-money(source.loyaltyDiscount));
  return money(source.total - predicted);
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

export async function createWooOrderFromCheckout(source: CheckoutOrderSource, options: {
  gopayPayment?: GoPayPayment;
  customerNote?: string;
  waitForEmail?: boolean;
  sendConfirmationEmail?: boolean;
} = {}) {
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

  const taxRateId = await profiler.measure("woo-tax-rate-resolve", () => resolveStandardTaxRateId());
  const lineItemsPayload = await profiler.measure("woo-line-items-resolve", () => lineItems(source, taxRateId));
  const shippingPayload = shippingLine(source, taxRateId);
  const feePayload = feeLines(source, taxRateId);
  const adjustment = roundingAdjustment(source);
  if (Math.abs(adjustment) >= 0.01) {
    feePayload.push({
      name: "Zaokrúhlenie",
      total: adjustment.toFixed(2),
      total_tax: "0.00",
      tax_status: "none",
      meta_data: [{ key: "tm_rounding_adjustment", value: adjustment.toFixed(2) }],
    } as any);
  }

  const order = await profiler.measure("woo-post-order", () => wooRequest<any>("/orders", {
    method: "POST",
    body: {
      status: payment.status,
      set_paid: payment.paid,
      currency: source.currency || String(options.gopayPayment?.currency || "EUR"),
      payment_method: payment.method,
      payment_method_title: payment.title,
      transaction_id: paymentId || undefined,
      customer_id: customerId > 0 ? customerId : undefined,
      customer_note: options.customerNote || [
        "Objednávka vytvorená z pokladne ToneryMaxim.sk.",
        source.billing?.company ? `Firma: ${source.billing.company}` : "",
        source.billing?.ico ? `IČO: ${source.billing.ico}` : "",
        source.billing?.dic ? `DIČ: ${source.billing.dic}` : "",
        (source.billing?.icDph || source.billing?.ic_dph) ? `IČ DPH: ${source.billing?.icDph || source.billing?.ic_dph}` : "",
      ].filter(Boolean).join("\n"),
      billing: billingForCreate,
      shipping,
      line_items: lineItemsPayload,
      shipping_lines: [shippingPayload],
      fee_lines: feePayload,
      meta_data: orderMeta({ ...source, paymentState: String(options.gopayPayment?.state || source.paymentState || "") }, paymentId, isCompany, payment),
    },
  }));

  if (source.coupon?.ok) {
    await profiler.measure("coupon-mark-used", () => markCouponUsed(Number(source.customerId) || undefined, source.coupon || undefined, order.id)).catch((error) => console.error("Coupon used meta error:", error?.message || error));
  }

  if (order?.id) {
    const visibleOrderNumber = String(source.orderNumber || order.number || order.id);
    const rewardCode = thankYouCouponCode(visibleOrderNumber);
    await profiler.measure("coupon-register-thank-you", () => registerIssuedCoupon({ code: rewardCode, sourceOrderId: order.id, sourceOrderNumber: visibleOrderNumber, customerId: Number(source.customerId) || undefined })).catch((error) => console.error("Thank you coupon registry error:", error?.message || error));
    if (Number(source.customerId || 0) > 0) {
      await profiler.measure("coupon-grant-thank-you", () => grantThankYouCoupon(Number(source.customerId), order.id, visibleOrderNumber)).catch((error) => console.error("Thank you coupon grant error:", error?.message || error));
    }
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

  if (source.heurekaConsent === true && customerEmail) {
    const heureka = await profiler.measure("heureka-verified-order", () => sendHeurekaVerifiedOrder(source, Number(order?.id || 0))).catch((error) => {
      console.error("Heureka Overené zákazníkmi error:", error?.message || error);
      return { sent: false, reason: "request-failed" } as const;
    });
    await wooRequest<any>(`/orders/${order.id}`, {
      method: "PUT",
      body: {
        meta_data: [
          { key: "tm_heureka_sent", value: heureka.sent ? "1" : "0" },
          { key: "tm_heureka_sent_at", value: heureka.sent ? heureka.sentAt : "" },
          { key: "tm_heureka_status", value: heureka.sent ? "sent" : heureka.reason },
        ],
      },
    }).catch((error) => console.error("Woo Heureka meta update error:", error?.message || error));
  }

  if (customerEmail && options.sendConfirmationEmail !== false) {
    const emailPromise = sendOrderConfirmationEmail({
      to: customerEmail,
      orderNumber: String(source.orderNumber || order.number || order.id || ""),
      source,
      paymentTitle: payment.title,
      shippingTitle: shippingPayload.method_title,
    });
    const adminCopyPromise = sendOrderAdminCopyEmail({
      orderNumber: String(source.orderNumber || order.number || order.id || ""),
      source,
      paymentTitle: payment.title,
      shippingTitle: shippingPayload.method_title,
    });

    if (options.waitForEmail) {
      await profiler.measure("order-email-send", () => emailPromise).catch((error) => console.error("ToneryMaxim customer order email error:", error?.message || error));
      await profiler.measure("order-admin-copy-send", () => adminCopyPromise).catch((error) => console.error("ToneryMaxim admin order copy error:", error?.message || error));
    } else {
      profiler.mark("email-dispatch-started");
      emailPromise.catch((error) => console.error("ToneryMaxim customer order email error:", error?.message || error));
      adminCopyPromise.catch((error) => console.error("ToneryMaxim admin order copy error:", error?.message || error));
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
  await writeSignedJson(storePath(source.paymentId), source);
  return source;
}

export async function readPendingGoPayOrder(paymentId: string): Promise<CheckoutOrderSource | null> {
  if (!paymentId) return null;
  const path = storePath(paymentId);
  const value = await readSignedJson<CheckoutOrderSource>(path);
  if (value) return value;

  // Jednorazová bezpečná migrácia starších nepodpísaných dát.
  const legacyPath = join(LEGACY_STORE_DIR, `${cleanKey(paymentId)}.json`);
  try {
    const { readFile, unlink } = await import("node:fs/promises");
    const legacy = JSON.parse(await readFile(legacyPath, "utf8")) as CheckoutOrderSource;
    if (String(legacy?.paymentId || "") === String(paymentId)) {
      await writeSignedJson(path, legacy);
      await unlink(legacyPath).catch(() => undefined);
      return legacy;
    }
  } catch { /* no legacy record */ }

  return null;
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

export async function syncWooGoPayPaymentState(source: CheckoutOrderSource, payment: GoPayPayment) {
  const paymentId = String(payment?.id || source.paymentId || "");
  const state = String(payment?.state || source.paymentState || "UNKNOWN").toUpperCase();
  const now = new Date().toISOString();
  const updatedSource: CheckoutOrderSource = {
    ...source,
    paymentId,
    paymentState: state,
  };

  let orderId = Number(source.wooOrderId || 0);
  let orderNumber = String(source.wooOrderNumber || source.orderNumber || orderId || "");

  if (orderId > 0) {
    const metaData: Array<{ key: string; value: string }> = [
      { key: "gopay_payment_id", value: paymentId },
      { key: "gopay_state", value: state },
      { key: "tm_gopay_verified_at", value: now },
    ];
    if (["PAID", "AUTHORIZED"].includes(state)) {
      metaData.push({ key: "tm_payment_paid_at", value: now });
    }

    const body: Record<string, unknown> = {
      transaction_id: paymentId || undefined,
      meta_data: metaData,
    };
    if (["PAID", "AUTHORIZED"].includes(state)) {
      body.status = "processing";
      body.set_paid = true;
    } else if (["CANCELED", "TIMEOUTED", "FAILED"].includes(state)) {
      body.status = "failed";
      body.set_paid = false;
    }

    const woo = await wooRequest<any>(`/orders/${orderId}`, { method: "PUT", body });
    orderId = Number(woo?.id || orderId);
    orderNumber = String(woo?.number || orderNumber);
    updatedSource.wooOrderId = orderId;
    updatedSource.wooOrderNumber = orderNumber;
  }

  await savePendingGoPayOrder(updatedSource);
  return { created: false, orderId, orderNumber, state };
}
