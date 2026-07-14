# Etapa 2 – TM Catalog Inspector

Kontrolný nástroj kvality katalógu v režime iba na čítanie.

## Inštalácia
Nahraď/pridaj súbory zo ZIP do koreňa projektu a nasaď bežným spôsobom.

## Otvorenie
- `/admin/catalog-quality`
- ak používaš administračný kľúč: `/admin/catalog-quality?key=TVOJ_KLUC`

## Bezpečnosť
Nástroj iba číta existujúcu lokálnu cache produktov cez `getProductsCache()`.
Nič nezapisuje do WooCommerce, produktov, databázy ani cache.

## Funkcie
- kritické, dôležité, obsahové a logické kontroly,
- konkrétny zoznam produktov a problémov,
- filtre podľa závažnosti, pravidla, SKU a názvu,
- CSV export,
- odkazy na detail produktu,
- responzívny admin prehľad.
