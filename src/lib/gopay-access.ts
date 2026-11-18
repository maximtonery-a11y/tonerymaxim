import { readCustomerSession } from './auth-session';
import { verifyPaymentAccessToken } from './payment-access';
import type { CheckoutOrderSource } from './checkout-order';

export function ownsGoPayOrder(pending: CheckoutOrderSource, cookies: any, token?: unknown): boolean {
  const session = readCustomerSession(cookies);
  if (session?.id && Number(pending.customerId) === session.id) return true;
  return verifyPaymentAccessToken(token || cookies.get('tm_gopay_access')?.value, pending.orderNumber);
}

export function goPayOrderPreview(source: CheckoutOrderSource) {
  return {
    orderNumber: source.orderNumber, cart: source.cart, contact: source.contact,
    billing: source.billing, delivery: source.delivery,
    shipping: { method: source.shippingCode, label: source.shippingLabel, price: source.shippingPrice, pickup: source.delivery?.pickup || null },
    payment: source.paymentCode, paymentPrice: source.paymentPrice,
    pricing: { subtotal: source.originalSubtotal, discount: source.quantityDiscount },
    coupon: source.coupon, loyalty: { apply: Number(source.loyaltyDiscount || 0) > 0, discount: source.loyaltyDiscount },
    total: source.total, createdAt: source.createdAt,
  };
}
