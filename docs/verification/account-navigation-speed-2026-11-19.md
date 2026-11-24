# Account navigation latency — 19 November 2026

The account landing page previously waited for a complete lifetime order scan, and navigation between the landing, orders and printers pages performed separate WooCommerce reads. The mobile pending style also left the previous destination highlighted, making a successful tap look ambiguous.

## Changes

- Fetch the customer and initial orders concurrently. Share the first 20 orders across the three pages for 15 seconds and coalesce simultaneous reads.
- Calculate the complete lifetime spending total on explicit request (`/ucet?summary=1`) when the history exceeds 20 orders. The normal landing still shows the exact order count and latest order. Histories of up to 20 orders retain their immediate complete spending total; a partial sum is never shown as a lifetime total.
- Keep the existing full-history calculation, including refunds and currencies, available on demand.
- Invalidate private display reads after successful order writes and customer updates. Prevent an older in-flight customer read from overwriting a newly saved profile in the cache.
- Highlight only the tapped destination immediately and prevent another tap on the same pending destination from restarting navigation. Restore controls on page lifecycle changes, Escape or a 15-second recovery timeout.
- Extend the same pending handling to links inside the benefits and more drawers. Drawer opening remains a local, synchronous action.

Customer settings, printer/reminder metadata, saved addresses, order ownership checks, checkout calculations and payment behavior are preserved. The new display cache is process-local, bounded to 100 entries / 8 MiB, keyed by customer and resource; individual values over 256 KiB are not retained. HTML/API private no-store responses are unchanged. External order changes can take up to the short display TTL to appear; application writes invalidate immediately in that process.

## Controlled server comparison

Baseline: main `77b82bd47f903751a80a9ffbe169845c3a03eba0`, the published version when this investigation began. Both built Node/Astro servers used the same fake WooCommerce backend, with a 400 ms delay per Woo read. These are HTTP response timings in a local test, not physical-phone rendering or production network measurements.

61-order account, opening the routes in this sequence:

| Request | Before | After | Woo reads before → after |
| --- | ---: | ---: | ---: |
| First account landing | 854 ms | 579 ms | 3 → 2 |
| Orders after landing | 416 ms | 15 ms | 1 → 0 |
| Printers after orders | 410 ms | 6 ms | 1 → 0 |
| Eight simultaneous page-2 requests | 495 ms | 455 ms | 8 → 1 |

Six warm requests after the change took 2–7 ms and made no Woo reads. The first landing has no cached customer/order data; two upstream reads run concurrently. The concurrent page-2 test demonstrates reduced upstream load, not an eightfold latency improvement.

The same three-route sequence with three orders changed from 871 / 499 / 497 ms to 441 / 9 / 7 ms. This fixture also verifies the immediate complete spending total for small histories.

No external JavaScript bundle or framework was added by this account change. Before integration with concurrent main changes, 54 of 55 baseline client asset files were identical; the account stylesheet grew by 532 bytes before compression. The small inline menu handler adds the pending state and duplicate-tap protection.

The final change also incorporates main `f14ef09` (catalog/cart improvements) without replacing it. Repeated built-server budget checks after integration passed: the 61-order cold sequence took 563 / 102 / 8 ms with 2 / 0 / 0 Woo reads, warm responses took 2–11 ms, and eight concurrent page-2 reads still made one Woo request. The three-order sequence took 429 / 8 / 5 ms. Two newly introduced nullable assertions in the concurrent cart test were narrowed explicitly so the combined type check remains clean; cart behavior was not changed by that correction.

## Validation

- `npm run test:account-speed`: 20 tests passed, including customer isolation, bounded memory, expiry/errors, concurrent-read coalescing, successful-write invalidation, an old-read/profile-save race, repeat taps and recovery.
- `npm run test:toner-care`: 23 tests passed.
- `npm run check`: 603 files, zero errors and zero warnings; existing hints remain.
- Production build and release guard after main integration: 436 tests, 427 passed, 9 intentionally skipped, zero failures.
- Built account render smoke: pagination across 61 orders, invoice/reorder/auth behavior and explicitly requested complete spending summary passed.
- Built printer/guard render smoke: saved data and guard controls passed.
- Controlled large and small history benchmarks enforce upstream request counts, coalescing and warm-response budgets in CI through `--expect-fast-navigation`.
- Browser QA on the built fixture at 320 and 390 CSS pixels: benefits/more drawers opened and closed correctly. While a test-only 5-second HTML delay held printer navigation, the tapped printer button alone was yellow, the previous orders button was transparent, `aria-busy` was set, and the bar remained 74 px high at the bottom of the 800 px viewport.

Fixture tests do not send real emails, create production orders or charge GoPay. Physical Android browser chrome and live production latency require a post-deployment check.
