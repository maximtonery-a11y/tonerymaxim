# Inštalácia opravného GEO balíka

Balík rozbaľte do koreňového priečinka projektu a potvrďte nahradenie existujúcich súborov. Štruktúru priečinkov zachovajte.

## Čo balík mení

- prioritné stránky tlačiarní a OEM používajú presné otázky zo stabilného 50-otázkového benchmarku,
- odpovede sú krátke, faktografické a výslovne založené na aktuálnom katalógu,
- stránky serverovo prepájajú produkty, OEM rodiny, kompatibilné tlačiarne a návody,
- odstránené sú formulácie „overená kompatibilita“ a „overené údaje“ na týchto stránkach,
- pribudla verejná stránka `/autor/roman-babcan` a jednotná `Person`/`ProfilePage` schema,
- profil autora je prepojený s odbornými článkami, OEM a tlačiarenskými stránkami,
- profil je doplnený do sitemap a `llms.txt`.

## Výkon

Úpravy sú vykresľované na serveri z údajov, ktoré stránky už načítavali. Balík nepridáva klientsku hydratáciu, nový JavaScript, externú knižnicu ani sieťové volanie.

## Kontrola po nasadení

1. Spustite `npm ci` a `npm run release:check`.
2. Overte `/autor/roman-babcan`, jednu prioritnú `/oem/*` a jednu prioritnú `/tlaciarne/*` stránku.
3. Skontrolujte, že `/sitemap-pages.xml` obsahuje `/autor/roman-babcan`.
4. Day 7 vykonajte podľa `GEO-DAY7-NASADENIE.md` presne sedem dní po produkčnom nasadení.
