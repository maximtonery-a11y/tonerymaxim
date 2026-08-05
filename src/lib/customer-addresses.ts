import type { WooCustomer } from "./woo-client";

export const SHIPPING_ADDRESSES_META_KEY = "tm_shipping_addresses";

function customerMeta(customer: WooCustomer, key: string): unknown {
  const meta = Array.isArray(customer.meta_data) ? customer.meta_data : [];
  return [...meta].reverse().find((entry) => entry?.key === key)?.value;
}

export type SavedShippingAddress = {
  id: string;
  label: string;
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  postcode: string;
  country: string;
  phone: string;
  is_default: boolean;
};

const text = (value: unknown, max = 160) => String(value ?? "").trim().slice(0, max);

export function normalizeShippingAddress(input: any, index = 0): SavedShippingAddress {
  return {
    id: text(input?.id, 80) || `address-${index + 1}`,
    label: text(input?.label, 80) || `Dodacia adresa ${index + 1}`,
    first_name: text(input?.first_name ?? input?.firstName, 80),
    last_name: text(input?.last_name ?? input?.lastName, 80),
    company: text(input?.company, 120),
    address_1: text(input?.address_1 ?? input?.address, 160),
    address_2: text(input?.address_2, 160),
    city: text(input?.city, 100),
    postcode: text(input?.postcode ?? input?.zip, 20),
    country: (text(input?.country, 2) || "SK").toUpperCase(),
    phone: text(input?.phone, 40),
    is_default: Boolean(input?.is_default ?? input?.isDefault),
  };
}

export function isCompleteShippingAddress(address: Partial<SavedShippingAddress> | null | undefined): boolean {
  return Boolean(address?.first_name && address?.last_name && address?.address_1 && address?.city && address?.postcode);
}

export function parseShippingAddresses(raw: unknown): SavedShippingAddress[] {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = []; }
  }
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  const result = value
    .slice(0, 20)
    .map((item, index) => normalizeShippingAddress(item, index))
    .filter(isCompleteShippingAddress)
    .map((address, index) => {
      let id = address.id || `address-${index + 1}`;
      while (ids.has(id)) id = `${id}-${index + 1}`;
      ids.add(id);
      return { ...address, id };
    });

  if (result.length && !result.some((address) => address.is_default)) result[0].is_default = true;
  if (result.filter((address) => address.is_default).length > 1) {
    let found = false;
    for (const address of result) {
      if (address.is_default && !found) found = true;
      else address.is_default = false;
    }
  }
  return result;
}

export function getCustomerShippingAddresses(customer: WooCustomer): SavedShippingAddress[] {
  const saved = parseShippingAddresses(customerMeta(customer, SHIPPING_ADDRESSES_META_KEY));
  if (saved.length) return saved;

  const fallback = normalizeShippingAddress({
    ...(customer.shipping || {}),
    id: "default-shipping",
    label: "Predvolená dodacia adresa",
    is_default: true,
  });
  return isCompleteShippingAddress(fallback) ? [fallback] : [];
}

export function defaultShippingAddress(addresses: SavedShippingAddress[]): SavedShippingAddress | null {
  return addresses.find((address) => address.is_default) || addresses[0] || null;
}

export function shippingAddressToWoo(address: SavedShippingAddress | null) {
  if (!address) return {};
  return {
    first_name: address.first_name,
    last_name: address.last_name,
    company: address.company,
    address_1: address.address_1,
    address_2: address.address_2,
    city: address.city,
    postcode: address.postcode,
    country: address.country || "SK",
    phone: address.phone,
  };
}
