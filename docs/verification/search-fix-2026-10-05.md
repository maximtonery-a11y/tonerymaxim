# Search repair — 2026-10-05

Production reproduction: CF53 returned 0 products from /api/products while autocomplete returned 12. The main search incorrectly treated a truncated alphanumeric OEM as an unknown complete OEM. A second failure, TN-B023, came from missing compound-code tokenization.

Changes:
- Allow a name/SKU prefix fallback only without exact product or printer matches; keep strict identity matching separate.
- Recognize compound TN-B023 codes.
- Rank matching packs first in both search surfaces. Preserve specific OEM and colour intent.
- Associate CF53 with the 205A packs only through the family code printed in the matching cartridge name, same brand and a shared compatible printer.
- Preserve filters, prohibited variant exclusions and bounded caches.

Validation before publication:
- 300 distinct toner designations across 10 brands, 1,111 assertions: all passed against both real API handlers and a production snapshot of 3,886 toner products generated 2026-10-05T05:07:45.029Z.
- Selection prioritises stock within each brand; this is not a verified sales ranking. The complete fixed case list is scripts/search-300-cases.json; per-query results are search-300-2026-10-05.csv.
- Exact search, unbranded lowercase, autocomplete parity and eligible numeric-ended prefixes are covered.
- 81 focused regression tests passed (search, exact SKU, cart/checkout, GoPay recovery, memory diagnostics, AI price questions).
- Astro production build passed.
- Snapshot integration: CF53 returns 14 results with the compatible and renovated 205A packs first. Autocomplete displays its usual maximum of 12 results, also with both packs first. CF530A remains the three single black cartridges.
- Canon CRG-069H and Brother TN-248XL show their packs first. TN-B023 finds both variants.

Commands:
```
npm run test:search
TM_SEARCH_CATALOG=/path/to/catalog.json node --experimental-strip-types scripts/verify-search-300.ts
TM_SEARCH_CATALOG=/path/to/catalog.json node --experimental-strip-types scripts/verify-search-focus.ts
```
The optional TM_SEARCH_SHARD=0/4 through 3/4 splits the same 300 cases. TM_SEARCH_REPORT controls the JSON report destination.

The live GET-only 300-case probe was interrupted after some requests received an Apache 301 redirect to http://www.tonerymaxim.info and a subsequent 404. A direct request reproduced the 301; later health and CF53 requests returned the expected JSON on .sk. That run is NOT counted as 300 successful live tests. The reproducible 300-case result above is a local integration test of production data. No payment or order was submitted.
