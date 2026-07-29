# Checkout Profiler v1

Tento ZIP pridáva meranie rýchlosti odoslania objednávky bez zmeny logiky objednávky.

## Kde pozerať výsledky
Po odoslaní objednávky pozri logy v Coolify.
Hľadaj text:

[TM checkout profiler]

## Čo sa meria
- request.json
- normalize-cart
- coupon-validate
- loyalty-load
- woo-line-items-resolve
- woo-post-order
- woo-update-billing-email
- coupon-mark-used
- coupon-grant-thank-you
- loyalty-reserve
- woo-update-loyalty-meta
- gopay-oauth-token
- gopay-payment-create
- save-pending-gopay-order

## Vypnutie
Ak by bolo potrebné profiler vypnúť, nastav v Coolify env:

CHECKOUT_PROFILER=0
