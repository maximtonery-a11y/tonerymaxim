export type CheckoutCustomerSource = {
  billing?: Record<string, any>;
  delivery?: Record<string, any>;
  contact?: Record<string, any>;
};

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function splitName(firstName: unknown, lastName: unknown, fallbackName = "") {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  if (first || last) return { first, last };
  const parts = String(fallbackName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1) || "" };
}

function addressFromCheckout(source: CheckoutCustomerSource, type: "billing" | "shipping") {
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

function shippingAddressFromCheckout(source: CheckoutCustomerSource) {
  const { email: _email, ...shipping } = addressFromCheckout(source, "shipping");
  return shipping;
}

/** Údaje uložené do profilu po úspešnom vytvorení objednávky. */
export function customerProfileUpdateFromOrder(source: CheckoutCustomerSource) {
  const billing = addressFromCheckout(source, "billing");
  return {
    first_name: billing.first_name,
    last_name: billing.last_name,
    billing,
    ...(source.delivery?.differentAddress ? { shipping: shippingAddressFromCheckout(source) } : {}),
  };
}
