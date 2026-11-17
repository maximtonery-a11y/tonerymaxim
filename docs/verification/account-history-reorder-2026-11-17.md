# Customer account history and repeat orders — 17 November 2026

The account overview previously counted only its ten fetched orders. History stopped at fifty orders and reconstructed all tax using 23%. This change scans the customer's complete history for the overview, caches only a compact completed result for sixty seconds, paginates history in twenty-order pages and reads recorded order tax. It reports a temporary failure instead of presenting a partial lifetime sum.

The order count includes all returned customer orders. Spending includes processing/completed and the existing paid/shipped custom states, or an order with a recorded paid date, excluding pending/on-hold, cancelled, failed, refunded, returned and draft states. Partial refunds are deducted; currencies are kept separate. The overview explains this definition. Old invoices and order records are never recalculated or updated.

Each order now has **Objednať znova**. This opens a preview using current Woo product prices and availability, with clear warnings for removed/changed products, unsupported variants and old loyalty gifts. Confirming adds the available items to the existing cart in one storage write, then opens the standard cart. A changed cart or an expired preview requires a new confirmation. Orders, discounts, shipping choices and payments are not copied from the historical order. Current checkout still verifies the order normally.

Ownership comes exclusively from the signed customer session and the order's customer ID. Guest orders and other customers' orders are rejected even when emails match or a customer ID is supplied in the request. Server-side account requests are GET-only. There are no changes to order creation, GoPay, shipping, product data, WordPress plugins or database structure.

## Verification

- Fifteen focused tests cover 151-order histories, pagination beyond fifty, refunds, status exclusions, currency separation, historical 20%/23%/zero/missing tax, failed/inconsistent scans, caching and concurrent scans, authorization, exact product identity, current prices, deleted products, calendars, loyalty gifts and atomic cart merging.
- The compiled client script is exercised through its real click handlers: preview, cancel, confirm, preserving unrelated items, changed-cart detection and expired-preview refresh.
- The existing release guard also runs these tests before building.
- `node scripts/account-orders-render-smoke.mjs` starts the real production build against disposable, isolated Woo/catalog fixtures. It checks 61 orders across four pages, the overview, actual order tax, missing pages, unauthorized access, current-price repeat previews and unchanged public home/cart/checkout/health routes. All outgoing fixture requests are GET-only and restricted to an invalid test hostname.
- `npm run check`, `npm run build`, `npm run test:storefront` and `npm run test:release` are required before merging.
- The cloud browser cannot connect to the local preview port. The render/HTTP and compiled-client checks are local; visual verification on the live site follows the usual Coolify redeploy. No live order, email or payment is created by this verification.

## Deployment

Redeploy the Astro application from GitHub main through the existing Coolify workflow. No WordPress plugin update, environment variable, migration or new dependency is needed. In the account, verify **Objednávky → Objednať znova → Vložiť do košíka**, a current-price preview, missing-item warnings and ordinary checkout navigation. Rollback is the previous Astro commit.
