import assert from "node:assert/strict";
import test from "node:test";
import { annotateProductsWithPriceHistory, evolvePriceHistory, type PriceHistoryFile } from "../src/lib/price-history.ts";
import { nextNightlyPriceRun } from "../src/lib/nightly-price-worker.ts";

const DAY = 24 * 60 * 60 * 1000;
const at = (day: number, hour = 2) => new Date(Date.UTC(2026, 0, 1 + day, hour));
const product = (price: number, regular = price, sale = 0): Record<string, any> => ({
  id: 101,
  sku: "TM-101",
  slug: "test-toner",
  price: price.toFixed(2),
  regular_price: regular.toFixed(2),
  sale_price: sale ? sale.toFixed(2) : "",
});

function observe(history: PriceHistoryFile | null, value: Record<string, any>, day: number) {
  return evolvePriceHistory(history, [value], at(day));
}

test("30-dňová cena sa zobrazí až pri novej akcii po úplnej histórii", () => {
  let history: PriceHistoryFile | null = null;
  for (let day = 0; day <= 30; day += 1) {
    const price = day >= 10 && day < 20 ? 90 : 100;
    history = observe(history, product(price), day);
  }
  const saleProduct = product(80, 110, 80);
  history = observe(history, saleProduct, 31);
  annotateProductsWithPriceHistory([saleProduct], history);
  assert.equal(saleProduct.lowest_price_30d, "90.00");
  assert.equal(saleProduct.lowest_price_30d_valid, true);
});

test("aktuálna akciová cena sa nezahrnie do referenčného minima", () => {
  let history: PriceHistoryFile | null = null;
  for (let day = 0; day <= 30; day += 1) history = observe(history, product(100), day);
  const firstSale = product(75, 100, 75);
  history = observe(history, firstSale, 31);
  history = observe(history, product(70, 100, 70), 32);
  const ongoingSale = product(70, 100, 70);
  annotateProductsWithPriceHistory([ongoingSale], history);
  assert.equal(ongoingSale.lowest_price_30d, "100.00");
});

test("akcia aktívna už pri začiatku merania nedostane neúplnú referenčnú cenu", () => {
  let history: PriceHistoryFile | null = null;
  for (let day = 0; day <= 35; day += 1) history = observe(history, product(80, 100, 80), day);
  const current = product(80, 100, 80);
  annotateProductsWithPriceHistory([current], history!);
  assert.equal(current.lowest_price_30d_valid, undefined);
});

test("výpadok dlhší než 36 hodín začne bezpečne novú históriu", () => {
  let history = observe(null, product(100), 0);
  history = evolvePriceHistory(history, [product(90)], new Date(at(0).getTime() + 37 * 60 * 60 * 1000));
  assert.equal(history.products["id:101"].tracked_at, history.last_observed_at);
  assert.deepEqual(history.products["id:101"].events.map((event) => event.price), [90]);
});

test("nočný termín je vždy medzi 01:00 a 04:00 v Bratislave", () => {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bratislava", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const now of [new Date("2026-01-10T00:00:00Z"), new Date("2026-07-10T12:00:00Z")]) {
    const next = nextNightlyPriceRun(now, 179, "Europe/Bratislava");
    const [hour, minute] = formatter.format(next).split(":").map(Number);
    assert(hour >= 1 && hour <= 3, `${hour}:${minute} nie je v nočnom okne`);
    assert(next.getTime() > now.getTime());
    assert(next.getTime() - now.getTime() <= 2 * DAY);
  }
});
