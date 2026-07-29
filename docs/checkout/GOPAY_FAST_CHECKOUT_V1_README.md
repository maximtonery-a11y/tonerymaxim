# TM Update 020 – GoPay Fast Checkout v1

Obsah ZIPu:

- `src/lib/gopay-client.ts`
- `src/lib/checkout-order.ts`
- `src/pages/api/gopay-create.ts`
- `src/pages/api/gopay-notify.ts`
- `src/pages/api/gopay-status.ts`

Úpravy:

1. GoPay OAuth token sa cacheuje v pamäti servera do expirácie.
2. Súčasné požiadavky na rovnaký GoPay token sa zlúčia do jednej požiadavky.
3. `gopay-create` už nepýta token z GoPay pri každej platbe, ak je platný cache token.
4. `gopay-notify` a `gopay-status` používajú rovnaký cacheovaný GoPay klient.
5. `gopay-status` už po návrate zákazníka z GoPay nečaká na pomalé vytvorenie Woo objednávky. Woo objednávka sa spustí na pozadí.
6. Pridaný lock proti duplicitnému vytvoreniu Woo objednávky pri súbehu GoPay notify + status.
7. Doplnená bezpečná funkcia `toCents()` a `VAT_RATE_PERCENT` do `gopay-create`, aby GoPay endpoint nespadol pri reálnom použití.

Očakávaný efekt:

- prvá GoPay platba po reštarte servera ešte musí získať token,
- ďalšie GoPay platby už token použijú z cache,
- návratová stránka po zaplatení nebude čakať na Woo create order.

Po nasadení:

1. Reštartuj deploy.
2. Sprav test GoPay platby.
3. Pozri `/admin/performance` a porovnaj kroky:
   - `gopay-oauth-token`
   - `gopay-payment-create`
   - `save-pending-gopay-order`

Poznámka:

Táto úprava nemení ceny, kupóny, vernostné body ani výpočet dopravy.
