import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultShippingAddress,
  getCustomerShippingAddresses,
  parseShippingAddresses,
  shippingAddressToWoo,
} from "../src/lib/customer-addresses.ts";

const base = {
  first_name: "Roman",
  last_name: "Babčan",
  address_1: "Tajov 265",
  city: "Tajov",
  postcode: "97634",
  country: "SK",
};

test("načíta JSON meta, zachová viac adries a jednu predvolenú", () => {
  const result = parseShippingAddresses(JSON.stringify([
    { ...base, id: "office", label: "Firma" },
    { ...base, id: "warehouse", label: "Sklad", address_1: "Skladová 1", is_default: true },
  ]));
  assert.equal(result.length, 2);
  assert.equal(result.filter((item) => item.is_default).length, 1);
  assert.equal(defaultShippingAddress(result)?.id, "warehouse");
});

test("ak meta chýba, použije štandardnú WooCommerce dodaciu adresu", () => {
  const result = getCustomerShippingAddresses({
    id: 7,
    email: "test@tonerymaxim.sk",
    shipping: { ...base, company: "ToneryMAXIM" },
    meta_data: [],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].is_default, true);
  assert.equal(result[0].label, "Predvolená dodacia adresa");
});

test("predvolená adresa sa prevedie do WooCommerce shipping formátu", () => {
  const result = shippingAddressToWoo({
    ...base,
    id: "home",
    label: "Domov",
    company: "",
    address_2: "",
    phone: "+421900000000",
    is_default: true,
  });
  assert.equal(result.address_1, "Tajov 265");
  assert.equal(result.phone, "+421900000000");
  assert.equal("label" in result, false);
});
