import test from "node:test";
import assert from "node:assert/strict";
import { BANK_TRANSFER_DETAILS, bankTransferVariableSymbol, isBankPrepaidPayment } from "../src/lib/bank-details.ts";
import { getOrderStatusLabel, isAwaitingBankPaymentStatus, isLoyaltyCreditStatus } from "../src/lib/order-statuses.ts";

test("zákaznícky účet zobrazuje všetky administratívne stavy po slovensky", () => {
  assert.equal(getOrderStatusLabel("tm-await-pay"), "Čaká na úhradu");
  assert.equal(getOrderStatusLabel("wc-tm-paid"), "Uhradená");
  assert.equal(getOrderStatusLabel("tm-processing"), "Spracováva sa");
  assert.equal(getOrderStatusLabel("tm-shipped"), "Expedovaná");
  assert.equal(getOrderStatusLabel("tm-returned"), "Vrátená");
  assert.equal(getOrderStatusLabel("expedovaná"), "Expedovaná");
});

test("body sa pripíšu pri expedovaní a zostávajú kompatibilné s dokončenými objednávkami", () => {
  assert.equal(isLoyaltyCreditStatus("tm-shipped"), true);
  assert.equal(isLoyaltyCreditStatus("wc-expedovana"), true);
  assert.equal(isLoyaltyCreditStatus("completed"), true);
  assert.equal(isLoyaltyCreditStatus("tm-paid"), false);
});

test("platobné údaje používajú číslo objednávky ako variabilný symbol", () => {
  assert.equal(BANK_TRANSFER_DETAILS.accountHolder, "Roman Babčan INkarus");
  assert.equal(bankTransferVariableSymbol("TM-300901"), "300901");
  assert.equal(isBankPrepaidPayment("bank_prepaid"), true);
  assert.equal(isBankPrepaidPayment("invoice_org", "Prevod pre firmy"), false);
  assert.equal(isAwaitingBankPaymentStatus("tm-await-pay"), true);
  assert.equal(isAwaitingBankPaymentStatus("tm-paid"), false);
});

