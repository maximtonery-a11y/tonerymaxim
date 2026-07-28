# ToneryMaxim – Etapa 1

Nahraďte súbory v projekte pri zachovaní priečinkov:

- `src/middleware.ts`
- `src/pages/produkty.astro`
- `src/scripts/catalog.js`
- `src/components/CatalogInitialRows.astro` (nový súbor)

Potom urobte nový deployment.

## Čo sa zmenilo

- `tonerymaxim.info` naďalej vracia `noindex, follow` v HTML aj HTTP hlavičke.
- `robots.txt` neblokuje crawlerom prístup k verejnému webu, takže vyhľadávače môžu načítať `noindex` a sociálne siete Open Graph náhľad.
- Open Graph používa aktuálnu zdieľanú URL, hoci SEO canonical zostáva na produkčnej doméne `tonerymaxim.sk`.
- Predvolený sociálny náhľad je JPEG s rozmermi 1200 × 627 px.
- Prvých 12 produktov sa vykreslí priamo na serveri z existujúcej lokálnej cache.
- Počiatočné otvorenie výpisu už nerobí duplicitné API načítanie.
- Filtre, vyhľadávanie, stránkovanie, košík, desktop aj mobil používajú pôvodný JavaScript a zostávajú funkčné.
- Pri zlyhaní serverovej cache zostáva pôvodný API fallback.

## Overenie

Build bol úspešný cez `npm run build`.
Lokálny test potvrdil:

- 12 produktov priamo v HTML,
- `X-Robots-Tag: noindex, follow`,
- správny `robots.txt`,
- správne `og:url`, `og:image` a rozmery sociálneho náhľadu,
- opakovaný lokálny TTFB približne 16–17 ms.
