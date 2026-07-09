# TM Update 022 – Search Performance v1

Upravené sú iba súbory potrebné pre zrýchlenie našeptávača a produktového vyhľadávania.

## Čo sa zmenilo

- `/api/smart-search` má nový RAM prefix index nad produktovou cache.
- Výsledky rovnakých dotazov sa cacheujú na serveri.
- Pri zmene produktovej cache sa index automaticky pregeneruje.
- Našeptávač má rýchlejší debounce, deduplikáciu rozpracovaných requestov a ochranu proti starým odpovediam.
- Checkout, GoPay, účet ani košík sa nemenili.

## Súbory na výmenu

- `src/pages/api/smart-search.ts`
- `src/scripts/smart-search.js`

## Kontrola

Build prešiel úspešne cez `npm run build`.
