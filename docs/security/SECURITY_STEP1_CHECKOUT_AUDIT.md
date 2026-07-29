# ToneryMaxim – krok 1: bezpečný checkout bez rozbitia zliav

## Čo bolo skontrolované

Skontrolované súbory:

- `src/scripts/cart.js`
- `src/scripts/checkout.js`
- `src/pages/api/order-create.ts`
- `src/pages/api/gopay-create.ts`
- `src/lib/coupons.ts`
- `src/lib/loyalty.ts`
- `src/lib/gopay-order.ts`
- `src/lib/checkout-order.ts`
- `src/lib/tm-products-cache.ts`

## Dôležité zistenie

Pôvodná chyba bola v tom, že API pri objednávke a GoPay prijímalo produktovú cenu z klienta.
To je riziko, pretože cenu v prehliadači si vie technicky zmeniť každý.

Kupóny, vernostné body, množstevné zľavy, doprava zdarma a platobné poplatky už v projekte existovali.
Preto oprava nesmie tieto mechanizmy odstrániť.

## Čo bolo upravené

Pridaný nový súbor:

- `src/lib/secure-checkout-cart.ts`

Upravené súbory:

- `src/pages/api/order-create.ts`
- `src/pages/api/gopay-create.ts`

## Nové správanie

Klient stále posiela košík ako doteraz, ale server už nepoužíva jeho cenu.
Server podľa `product_id`, `productId`, `id` alebo `sku` vyhľadá produkt v cache z WooCommerce a použije:

- reálny názov produktu,
- reálne SKU,
- reálnu cenu,
- typ produktu,
- skladový stav.

## Čo zostalo zachované

Zachované zostalo:

- množstevná zľava na kompatibilné produkty:
  - 2+ ks = 10 %,
  - 4+ ks = 25 %,
- kupóny z `src/lib/coupons.ts`,
- uvítací kupón,
- ďakovný kupón,
- vernostné body z `src/lib/loyalty.ts`,
- doprava zdarma od 29 € po množstevnej zľave,
- dobierka 1,20 €,
- GoPay suma,
- Woo objednávka,
- e-mailová rekapitulácia.

## Produkty bez skladu / neexistujúce produkty

Frontend ich už nemá púšťať do košíka.
Server teraz robí iba poistku:

- neexistujúci produkt objednávku zastaví,
- produkt bez ceny objednávku zastaví,
- produkt so `stock_status = outofstock` objednávku zastaví.

## Build test

`npm run build` prešiel úspešne.

## Poznámka

Táto oprava nerieši ešte testovacie API endpointy, rate-limit ani production secrets.
To má byť ďalší krok.
