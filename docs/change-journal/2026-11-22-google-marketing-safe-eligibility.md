# Google marketing audit and paid candidate safety (2026-11-22)

Stav: IN_PROGRESS – branch only, tests awaiting PR CI; never deployed.
Baseline: main commit `f14ef0984b076d85d759eacae2ad6cfd323dd85b` at the start of this work. No production Lighthouse baseline in this session.
Scope: Read-only audit of Google Ads/GA4/Merchant and a minimal change to the *planning-only* Ads Intelligence engine, not Google Ads campaign writes.

## Baseline external evidence
- Google Ads account 610-099-7864: customer_auto_tagging_enabled=True. Last-28d campaign-status report: 614 REMOVED, 72 PAUSED; no ENABLED campaigns reported; 4 clicks and EUR 1.45 historical cost in paused pilot campaign. Ads conversion action report returned zero rows, which is inconclusive (no proof that conversion goals are absent).
- Google Merchant Center 9068319: source `xml feed` FILE, source `tonerymaxim.sk` AUTOFEED; status in Slovakia: FREE_LISTINGS 3821 active/5 disapproved; SHOPPING_ADS 1234 active/2 disapproved.
- GA4 property 348505707: 28-day window indicated 424 sessions and 42 purchase events; 36 begin_checkout; GoPay referral traffic and potentially misattributed AI traffic. Data integrity not yet verified against fulfilled orders. No GA4 admin settings were changed.
- Astro `public/tm-ecommerce.js` records purchase via checkout success handler and localStorage deduplication; GoPay state handling must be verified in sandbox prior to editing. `src/lib/ads-intelligence-settings.ts` originally defaulted to EUR 30/day even though the owner approved EUR 10/day; `decideCampaignV2` did not exclude products priced at or below EUR 10 or lacking verified supplier cost.

## Changes on isolated PR branch
- Default planning budget 30 -> 10 EUR/day. This is a fallback default, **not** an actual Google Ads campaign budget; existing persisted settings may override it.
- Exclude from paid candidate allocation products priced <=10 EUR (gross catalog price) and products with no verified Abix supplier price. No products deleted from the organic feed, and no Google Ads campaign modified.
- Add regression tests for both rules, positive verified-price case, and robust no-eligible-products behavior.
- Scope confined to planning-worker files plus tests and this journal; Astro storefront, checkout, Google tags, DPD and GoPay unchanged.

## Test/verification status
Testy pred zmenou: Baseline code and scripts reviewed via GitHub, no executable local test run; **NOT VERIFIED**.
Testy po zmene: Require GitHub CI `npm run check && npm test && npm run build`, plus security checks, before merge. **NOT VERIFIED until CI reports success**.
Výkon pred / po / rozdiel: No storefront runtime bundle modified; Lighthouse staging and live baseline **NOT VERIFIED**. Do not claim unchanged speed without comparative measurement.
Security and checkout: No edited runtime payment/cart/account routes. No live purchase test. API security unchanged.
Risks/blockers: Existing saved marketing settings may hold budget 30; new default is not a production daily spending limit. Ads API and GA4 admin write access unavailable here. Product cost matching depends on SKU -> Abix XML freshness. Excluding unverified COGS may sharply reduce candidates, as intended for safety.
Rollback: Close PR (no merge) or revert commits; no production changes have been made.
Deployment: NOT DEPLOYED. All Google campaigns left as-is.
