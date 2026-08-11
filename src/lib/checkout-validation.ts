const SHIPPING_CODES = new Set([
  "dpd_courier",
  "dpd_pickup",
  "dpd_box",
  "gls_courier",
  "gls_pickup",
]);

const PICKUP_CODES = new Set(["dpd_pickup", "dpd_box", "gls_pickup"]);

function text(value: unknown, max = 160) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function multilineText(value: unknown, max = 1000) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function digits(value: unknown) {
  return text(value, 32).replace(/\D/g, "");
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value) && value.length <= 254;
}

function validPhone(value: string) {
  const count = digits(value).length;
  return count >= 9 && count <= 15;
}

function validZip(value: string) {
  return digits(value).length === 5;
}

function required(value: string, label: string, errors: string[]) {
  if (!value) errors.push(`Chýba ${label}.`);
}

export type ValidatedCheckout = {
  shippingCode: string;
  paymentCode: string;
  contact: { email: string; phone: string };
  billing: Record<string, string | boolean>;
  delivery: Record<string, string | boolean | Record<string, string> | null>;
  pickup: Record<string, string> | null;
  termsAcceptedAt: string;
  heurekaConsent: boolean;
  heurekaConsentAt?: string;
  orderNote: string;
};

export function validateCheckoutRequest(
  raw: any,
  allowedPayments: ReadonlySet<string>,
): ValidatedCheckout {
  const errors: string[] = [];
  const heurekaConsent = raw?.heurekaConsent === true;
  const orderNote = multilineText(raw?.orderNote, 1000);
  const shippingCode = text(typeof raw?.shipping === "string" ? raw.shipping : raw?.shipping?.method, 40);
  const paymentCode = text(typeof raw?.payment === "string" ? raw.payment : raw?.payment?.method, 40);

  if (!SHIPPING_CODES.has(shippingCode)) errors.push("Vyberte platný spôsob dopravy.");
  if (!allowedPayments.has(paymentCode)) errors.push("Vyberte platný spôsob platby.");
  if (raw?.termsAccepted !== true) errors.push("Objednávku je možné odoslať až po súhlase s obchodnými podmienkami.");

  const contact = {
    email: text(raw?.contact?.email, 254).toLowerCase(),
    phone: text(raw?.contact?.phone, 32),
  };
  if (!validEmail(contact.email)) errors.push("Zadajte platnú e-mailovú adresu.");
  if (!validPhone(contact.phone)) errors.push("Zadajte platné telefónne číslo.");

  const billing = {
    companyEnabled: raw?.billing?.companyEnabled === true,
    company: text(raw?.billing?.company, 160),
    ico: digits(raw?.billing?.ico).slice(0, 8),
    dic: digits(raw?.billing?.dic).slice(0, 12),
    icDph: text(raw?.billing?.icDph ?? raw?.billing?.ic_dph, 16).toUpperCase(),
    firstName: text(raw?.billing?.firstName, 80),
    lastName: text(raw?.billing?.lastName, 80),
    address: text(raw?.billing?.address, 160),
    city: text(raw?.billing?.city, 100),
    zip: digits(raw?.billing?.zip).slice(0, 5),
  };

  required(billing.firstName, "meno", errors);
  required(billing.lastName, "priezvisko", errors);
  required(billing.address, "fakturačná adresa", errors);
  required(billing.city, "mesto", errors);
  if (!validZip(billing.zip)) errors.push("PSČ musí obsahovať 5 číslic.");

  if (billing.companyEnabled) {
    required(billing.company, "názov firmy", errors);
    if (billing.ico.length !== 8) errors.push("IČO musí obsahovať 8 číslic.");
  }
  if (paymentCode === "invoice_org" && (!billing.companyEnabled || !billing.company || billing.ico.length !== 8)) {
    errors.push("Platba pre organizácie je dostupná iba po vyplnení názvu firmy a platného IČO.");
  }

  const differentAddress = raw?.delivery?.differentAddress === true && !PICKUP_CODES.has(shippingCode);
  const delivery = {
    differentAddress,
    firstName: text(raw?.delivery?.firstName, 80),
    lastName: text(raw?.delivery?.lastName, 80),
    email: text(raw?.delivery?.email, 254).toLowerCase(),
    phone: text(raw?.delivery?.phone, 32),
    street: text(raw?.delivery?.street, 160),
    city: text(raw?.delivery?.city, 100),
    zip: digits(raw?.delivery?.zip).slice(0, 5),
  };

  if (differentAddress) {
    required(delivery.firstName, "meno pre doručenie", errors);
    required(delivery.lastName, "priezvisko pre doručenie", errors);
    required(delivery.street, "doručovacia adresa", errors);
    required(delivery.city, "mesto doručenia", errors);
    if (!validZip(delivery.zip)) errors.push("PSČ doručenia musí obsahovať 5 číslic.");
    if (delivery.email && !validEmail(delivery.email)) errors.push("Doručovací e-mail nie je platný.");
    if (delivery.phone && !validPhone(delivery.phone)) errors.push("Doručovací telefón nie je platný.");
  }

  const pickupRaw = raw?.shipping?.pickup ?? raw?.delivery?.pickup;
  const pickup = pickupRaw && typeof pickupRaw === "object"
    ? {
        carrier: text(pickupRaw.carrier, 20).toUpperCase(),
        delivery_type: text(pickupRaw.delivery_type, 20),
        pickup_id: text(pickupRaw.pickup_id ?? pickupRaw.id, 120),
        pickup_name: text(pickupRaw.pickup_name ?? pickupRaw.name, 160),
        pickup_address: text(pickupRaw.pickup_address ?? pickupRaw.address, 160),
        pickup_city: text(pickupRaw.pickup_city ?? pickupRaw.city, 100),
        pickup_zip: digits(pickupRaw.pickup_zip ?? pickupRaw.zip).slice(0, 5),
        pickup_country: text(pickupRaw.pickup_country ?? pickupRaw.country ?? "SK", 3).toUpperCase(),
      }
    : null;

  if (PICKUP_CODES.has(shippingCode)) {
    if (!pickup?.pickup_id || !pickup.pickup_name) errors.push("Vyberte konkrétne odberné miesto alebo box.");
    const expectedCarrier = shippingCode.startsWith("dpd_") ? "DPD" : "GLS";
    if (pickup?.carrier && pickup.carrier !== expectedCarrier) errors.push("Vybrané odberné miesto nepatrí zvolenému dopravcovi.");
  }

  if (errors.length) {
    const error = new Error(errors[0]) as Error & { status?: number; validationErrors?: string[] };
    error.status = 400;
    error.validationErrors = [...new Set(errors)];
    throw error;
  }

  return {
    shippingCode,
    paymentCode,
    contact,
    billing,
    delivery: { ...delivery, pickup },
    pickup,
    termsAcceptedAt: new Date().toISOString(),
    heurekaConsent,
    heurekaConsentAt: heurekaConsent ? new Date().toISOString() : undefined,
    orderNote,
  };
}
