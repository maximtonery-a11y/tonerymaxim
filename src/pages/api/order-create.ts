import type { APIRoute } from "astro";
import { readCustomerSession } from "../../lib/auth-session";
import { createWooOrderFromCheckout } from "../../lib/gopay-order";

type CartItem = {
  id?: string | number;
  sku?: string;
  name?: string;
  price?: number | string;
  qty?: number | string;
  quantity?: number | string;
  product_type_key?: string;
  productTypeKey?: string;
  product_type_label?: string;
  productTypeLabel?: string;
};

const SHIPPING: Record<string, { label: string; price: number }> = {
  dpd_courier: { label: "DPD kuriér na adresu", price: 3.9 },
  dpd_pickup: { label: "DPD Pickup", price: 2.9 },
  dpd_box: { label: "DPD Pickup Box", price: 2.9 },
  gls_courier: { label: "GLS kuriér na adresu", price: 3.9 },
  gls_pickup: { label: "GLS ParcelShop / Balíkomat", price: 2.9 },
};

const PAYMENT: Record<string, { label: string; price: number }> = {
  cod: { label: "Dobierka", price: 1.2 },
  bank_prepaid: { label: "Platba prevodným príkazom vopred", price: 0 },
  invoice_org: { label: "Prevodný príkaz pre organizácie a firmy", price: 0 },
};

function normalizePrice(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  if (typeof value === "string") {
    const number = Number(value.replace(/\s/g, "").replace("€", "").replace(",", "."));
    return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
  }
  return 0;
}

function normalizeQty(value: unknown) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number) || number < 1) return 1;
  if (number > 99) return 99;
  return number;
}

function normalizeCart(cart: CartItem[]) {
  return cart
    .map((item, index) => {
      const name = String(item.name || item.sku || item.id || `Produkt ${index + 1}`).trim();
      const price = normalizePrice(item.price);
      const qty = normalizeQty(item.qty ?? item.quantity ?? 1);
      return {
        id: String(item.id || item.sku || name),
        sku: String(item.sku || item.id || ""),
        name: name.slice(0, 128),
        price,
        qty,
        product_type_key: String(item.product_type_key || item.productTypeKey || ""),
        product_type_label: String(item.product_type_label || item.productTypeLabel || ""),
      };
    })
    .filter((item) => item.name && item.price > 0 && item.qty > 0);
}

function isCompatibleDiscountItem(item: ReturnType<typeof normalizeCart>[number]) {
  const type = String(item.product_type_key || "").toLowerCase();
  const label = String(item.product_type_label || item.name || "").toLowerCase();
  return type === "compatible" || label.includes("kompatibil");
}

function discountRate(item: ReturnType<typeof normalizeCart>[number]) {
  if (!isCompatibleDiscountItem(item)) return 0;
  if (item.qty >= 4) return 0.25;
  if (item.qty >= 2) return 0.10;
  return 0;
}

function discountedLine(item: ReturnType<typeof normalizeCart>[number]) {
  const original = item.price * item.qty;
  const discount = Math.round(original * discountRate(item) * 100) / 100;
  return Math.max(0, Math.round((original - discount) * 100) / 100);
}

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = readCustomerSession(cookies);
    const body = await request.json().catch(() => ({}));
    const cart = normalizeCart(Array.isArray(body.cart) ? body.cart : []);

    if (cart.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "Košík je prázdny." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const shippingCode = String(typeof body.shipping === "string" ? body.shipping : body.shipping?.method || "dpd_courier");
    const paymentCode = String(typeof body.payment === "string" ? body.payment : body.payment?.method || "cod");

    if (!PAYMENT[paymentCode]) {
      return new Response(JSON.stringify({ ok: false, error: "Neplatná platobná metóda pre uloženie objednávky." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const shipping = SHIPPING[shippingCode] || SHIPPING.dpd_courier;
    const payment = PAYMENT[paymentCode];
    const subtotal = cart.reduce((sum, item) => sum + discountedLine(item), 0);
    const shippingPrice = subtotal >= 29 ? 0 : shipping.price;
    const paymentPrice = payment.price;
    const total = Math.round((subtotal + shippingPrice + paymentPrice) * 100) / 100;
    const orderNumber = `TM-${Date.now()}`;

    const result = await createWooOrderFromCheckout({
      orderNumber,
      currency: "EUR",
      cart,
      billing: body.billing || {},
      delivery: { ...(body.delivery || {}), pickup: body.shipping?.pickup || body.delivery?.pickup || null },
      contact: body.contact || {},
      shippingCode,
      shippingLabel: shipping.label,
      shippingPrice,
      paymentCode,
      paymentLabel: payment.label,
      paymentPrice,
      subtotal: Math.round(subtotal * 100) / 100,
      total,
      amountCents: Math.round(total * 100),
      createdAt: new Date().toISOString(),
      customerId: session?.id || undefined,
    });

    return new Response(JSON.stringify({
      ok: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("Order create error:", error?.message || error, error?.details || "");
    return new Response(JSON.stringify({
      ok: false,
      error: error?.message || "Nepodarilo sa vytvoriť objednávku vo WooCommerce.",
      details: error?.details || null,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
