# UPDATE_004 – Migration Gate

Tento update pridáva automatickú kontrolu všetkých 18 941 historických URL pred prechodom zo Shopionu na nový Astro e-shop.

## Spustenie na Windows

1. Rozbaľte ZIP do koreňa projektu a povoľte nahradenie `package.json`.
2. Projekt musí mať nainštalované balíky (`node_modules`).
3. Spustite `SPUSTIT_MIGRATION_GATE.bat`.
4. Výsledok sa otvorí v `migration/reports/latest.html`.

Skript najprv spustí produkčný build, potom produkčný Node server a následne prejde celé URL mapovanie.

## Výsledky

- `PASS` – technicky správne správanie.
- `NEVYRIEŠENÉ MAPOVANIE` – URL ešte nemá bezpečné rozhodnutie.
- `MANUÁLNE OVERIŤ` – technický cieľ môže byť správny, ale treba potvrdiť obsahovú zhodu.
- `NESPRÁVNY REDIRECT`, `REDIRECT CHAIN`, `404`, `500`, `SOFT 404`, `CHÝBA CANONICAL`, `NOINDEX` – blokujúce chyby.

DNS sa môže meniť až vtedy, keď report ukáže **Pripravené na DNS: ÁNO**.

## Test už nasadeného servera

```bash
npm run migration:gate:remote -- --base-url https://testovacia-domena.sk --allow-noindex
```

Pri testovaní `tonerymaxim.info` sa globálny noindex automaticky považuje za správny. Na produkčnej `.sk` je noindex blokujúca chyba.

## Rýchle čiastkové testy

```bash
npm run migration:gate:remote -- --types static,printer-brand --limit 100
npm run migration:gate:remote -- --types printer-model --concurrency 6
npm run migration:gate:remote -- --dry-run
```
