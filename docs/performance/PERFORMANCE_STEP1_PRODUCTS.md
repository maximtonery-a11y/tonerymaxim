# Performance step 1 – zrýchlenie /api/products

Upravený súbor:
- `src/pages/api/products.ts`

Čo sa zmenilo:
1. Pridaná serverová cache výsledkov API pre rovnaké dotazy.
   - Predvolene 60 sekúnd.
   - Max. 250 rôznych dotazov v pamäti.
   - Nastaviteľné cez ENV:
     - `PRODUCTS_API_CACHE_TTL_MS`
     - `PRODUCTS_API_CACHE_MAX_ITEMS`

2. Odstránené opakované triedenie celého zoznamu produktov pri každom requeste.
   - Produktová cache je už zoradená pri synchronizácii.
   - Filtrovanie zachováva poradie.

3. Zmenšená odpoveď API.
   - Výpis produktov už neposiela veľké HTML popisy a interný `search_text`.
   - Ponechané sú polia potrebné pre katalóg, košík, kompatibilné tlačiarne a mini produktové karty.

4. Pridaná hlavička na kontrolu cache:
   - `X-TM-Products-Cache: miss`
   - `X-TM-Products-Cache: hit`

Ako testovať:
1. Spustiť projekt.
2. Otvoriť `/produkty?s=W1350A`.
3. V DevTools → Network skontrolovať volanie `/api/products?...`.
4. Pri druhom rovnakom volaní má byť v response headers `X-TM-Products-Cache: hit`.

Bezpečnostná poznámka:
- Nemení sa checkout.
- Nemenia sa ceny.
- Nemení sa košík.
- Nemení sa dostupnosť produktov.
