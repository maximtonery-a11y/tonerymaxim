# TM Update 021 – Account Performance v1

Obsahuje iba súbory na výmenu.

## Čo sa zmenilo
- Pridaná krátka serverová cache pre zákazníka z WooCommerce.
- Pridaná krátka serverová cache pre objednávky zákazníka z WooCommerce.
- Cache sa automaticky vymaže pri úprave profilu/adresy/uložených produktov/tlačiarní cez `updateWooCustomer`.
- Menu v účte prednačítava najbližšie podstránky počas nečinnosti a pri prejdení myšou/dotyku.

## Očakávaný efekt
- Prvý vstup do účtu môže stále čakať na Woo.
- Ďalšie kliky v menu účtu by mali byť výrazne rýchlejšie.

## Zmenené súbory
- `src/lib/woo-client.ts`
- `src/components/AccountShell.astro`

## Kontrola
- `npm run build` prešiel úspešne.
