import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCheckoutRequest } from "../src/lib/checkout-validation.ts";
import {
  productCompletenessRatio,
  requiredProductCount,
} from "../src/lib/product-cache-policy.ts";

const offlinePayments = new Set(["cod", "bank_prepaid", "invoice_org"]);

function validCheckout() {
  return {
    termsAccepted: true,
    contact: { email: "zakaznik@example.sk", phone: "+421 900 123 456" },
    billing: {
      firstName: "Ján",
      lastName: "Novák",
      address: "Hlavná 1",
      city: "Banská Bystrica",
      zip: "97401",
    },
    delivery: { differentAddress: false },
    shipping: { method: "dpd_courier", pickup: null },
    payment: "cod",
  };
}

test("serverová pokladňa prijme iba úplné a odsúhlasené údaje", () => {
  const result = validateCheckoutRequest(validCheckout(), offlinePayments);
  assert.equal(result.contact.email, "zakaznik@example.sk");
  assert.equal(result.shippingCode, "dpd_courier");
  assert.match(result.termsAcceptedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("serverová pokladňa odmietne chýbajúci súhlas, kontakt a adresu", () => {
  assert.throws(
    () => validateCheckoutRequest({ shipping: "dpd_courier", payment: "cod" }, offlinePayments),
    (error: any) => error?.status === 400 && error?.validationErrors?.length >= 5,
  );
});

test("výdajné miesto musí byť vybrané a patriť dopravcovi", () => {
  const input: any = validCheckout();
  input.shipping = { method: "dpd_pickup", pickup: null };
  assert.throws(() => validateCheckoutRequest(input, offlinePayments), /odberné miesto/i);

  input.shipping.pickup = { carrier: "GLS", pickup_id: "123", pickup_name: "Box" };
  assert.throws(() => validateCheckoutRequest(input, offlinePayments), /dopravcovi/i);
});

test("faktúra pre organizáciu vyžaduje firmu a platné IČO", () => {
  const input = validCheckout();
  input.payment = "invoice_org";
  assert.throws(() => validateCheckoutRequest(input, offlinePayments), /organizácie/i);
});

test("v zdrojoch nie je natvrdo vložený Heureka kľúč ani GoPay request s osobnými údajmi v logu", async () => {
  const heureka = await readFile(new URL("../src/pages/api/heureka-reviews.ts", import.meta.url), "utf8");
  const gopay = await readFile(new URL("../src/pages/api/gopay-create.ts", import.meta.url), "utf8");
  assert.doesNotMatch(heureka, /getHeurekaKey\(\)[\s\S]*\|\|\s*["'][a-f0-9]{24,}["']/i);
  assert.doesNotMatch(gopay, /console\.error\([\s\S]{0,300}request:\s*paymentBody/);
  assert.doesNotMatch(gopay, /gopay:\s*paymentData/);
});

test("administrátorské exporty zlyhajú bezpečne bez nakonfigurovaného kľúča", async () => {
  const dashboard = await readFile(new URL("../src/pages/api/admin-dashboard.ts", import.meta.url), "utf8");
  const catalog = await readFile(new URL("../src/pages/api/catalog-quality.csv.ts", import.meta.url), "utf8");
  assert.match(dashboard, /!expected\s*\|\|\s*!constantTimeEqual/);
  assert.match(catalog, /!adminKey\s*\|\|\s*!constantTimeEqual/);
});

test("prvé načítanie katalógu neblokuje zastaraný pevný odhad počtu produktov", async () => {
  const productsCache = await readFile(new URL("../src/lib/tm-products-cache.ts", import.meta.url), "utf8");
  const readiness = await readFile(new URL("../src/pages/api/readiness.ts", import.meta.url), "utf8");

  assert.doesNotMatch(productsCache, /WOO_SYNC_EXPECTED_MIN_PRODUCTS[\s\S]{0,100}\|\|\s*7000/);
  assert.doesNotMatch(readiness, /WOO_SYNC_EXPECTED_MIN_PRODUCTS[\s\S]{0,140}\|\|\s*7000/);
  assert.equal(requiredProductCount({ reportedTotal: 6421 }), 6357);
  assert.equal(requiredProductCount({ reportedTotal: 6421, configuredMinimum: 7000 }), 7000);
  assert.equal(productCompletenessRatio(6421, 6421), 1);
});

test("produkčné premenné z Coolify majú prednosť pred hodnotami vloženými pri builde", async () => {
  const runtimeConfiguredFiles = [
    "../src/lib/tm-products-cache.ts",
    "../src/lib/security.ts",
    "../src/lib/runtime-secret.ts",
    "../src/lib/openai-sales-assistant.ts",
    "../src/lib/merchant-feed.ts",
    "../src/pages/api/sync-products.ts",
  ];

  for (const relativePath of runtimeConfiguredFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /import\.meta\.env(?:\[[^\]]+\]|\.[A-Z0-9_]+)\s*\|\|\s*process\.env/,
      `${relativePath} nesmie prepisovať Coolify hodnotu build-time hodnotou`,
    );
  }
});
