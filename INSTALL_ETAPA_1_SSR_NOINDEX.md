# ToneryMaxim – Etapa 1

Nahraďte súbory v projekte pri zachovaní priečinkov:

- `src/middleware.ts`
- `src/pages/produkty.astro`
- `src/scripts/catalog.js`
- `src/components/CatalogInitialRows.astro` (nový súbor)

Potom urobte nový deployment.

## Čo sa zmenilo

- `tonerymaxim.info` naďalej vracia `noindex` v HTML aj HTTP hlavičke.
- `robots.txt` už neblokuje crawlerom prístup k celému webu, takže Google môže načítať `noindex` a odstrániť URL z indexu.
- Prvých 12 produktov sa vykreslí priamo na serveri z existujúcej lokálnej cache.
- Počiatočné otvorenie výpisu už nerobí duplicitné API načítanie.
- Filtre, vyhľadávanie, stránkovanie, košík, desktop aj mobil používajú pôvodný JavaScript a zostávajú funkčné.
- Pri zlyhaní serverovej cache zostáva pôvodný API fallback.

## Overenie

Build bol úspešný cez `npm run build`.
Lokálny test potvrdil:

- 12 produktov priamo v HTML,
- `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`,
- správny `robots.txt`,
- opakovaný lokálny TTFB približne 16–17 ms.
