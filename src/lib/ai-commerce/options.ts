export const SHIPPING_OPTIONS = [
  { id:'dpd_courier', label:'DPD kuriér na adresu', price:3.9, countries:['SK','CZ'] },
  { id:'gls_courier', label:'GLS kuriér na adresu', price:3.9, countries:['SK','CZ'] },
  { id:'dpd_pickup', label:'DPD Pickup', price:2.9, countries:['SK'], requiresPickup:true },
  { id:'dpd_box', label:'DPD Pickup Box', price:2.9, countries:['SK'], requiresPickup:true },
  { id:'gls_pickup', label:'GLS ParcelShop / Balíkomat', price:2.9, countries:['SK'], requiresPickup:true },
] as const;
export const PAYMENT_OPTIONS = [
  { id:'gopay', label:'Platba online GoPay', price:0 },
  { id:'applepay', label:'Apple Pay', price:0 },
  { id:'googlepay', label:'Google Pay', price:0 },
  { id:'cod', label:'Dobierka', price:1.2 },
  { id:'bank_prepaid', label:'Bankový prevod', price:0 },
  { id:'invoice_org', label:'Prevod pre organizácie a firmy', price:0, companyOnly:true },
] as const;

export function availableOptions(country: unknown, goodsTotal: number, shippingId?: string) {
  const c = String(country || 'SK').toUpperCase() === 'CZ' ? 'CZ' : 'SK';
  const shipping = SHIPPING_OPTIONS.filter(x => (x.countries as readonly string[]).includes(c)).map(x => ({ ...x, price: goodsTotal >= 29 ? 0 : x.price }));
  const selected = shipping.find(x => x.id === shippingId);
  return { country:c, freeShippingThreshold:29, shipping, payment:PAYMENT_OPTIONS, selectedShipping:selected || null };
}
