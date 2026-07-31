# V68 – Migration Gate

Tento update pridáva automatickú kontrolu všetkých 18 941 historických URL pred prechodom zo Shopionu na nový Astro e-shop.

## Spustenie na Windows

1. Rozbaľte ZIP do koreňa projektu a povoľte nahradenie `package.json`.
2. Projekt musí mať nainštalované balíky (`node_modules`).
3. Spustite `SPUSTIT_MIGRATION_GATE.bat`.
4. Výsledok sa otvorí v `migration/reports/latest.html`.

Skript najprv spustí produkčný build a lokálny produkčný Node server. Počas testu
vypne e-mailové a objednávkové background workery, pripraví produktovú cache iba
jedným synchronizačným procesom a až potom prejde celé URL mapovanie.

Lokálny runner si vytvorí dočasný `AUTH_SECRET` iba pre svoj testovací proces.
Nemení `.env` a dočasnú hodnotu neposielajte do produkcie.

Ak príprava cache zlyhá na `429`, `502` alebo `503`, test sa bezpečne zastaví ešte
pred kontrolou 18 941 URL. Počkajte, kým sa WooCommerce API uvoľní, a spustite
`SPUSTIT_MIGRATION_GATE.bat` znova.

## Pravidlá migrácie

- `301` sa používa iba pri jednoznačnom trvalom ekvivalente.
- Presne rozpoznaný starý model tlačiarne smeruje jedným `301` na kanonickú
  adresu `/tlaciarne/{znacka}/{model}`.
- Stará všeobecná kategória značky smeruje jedným `301` na stránku značky.
- Nejednoznačný toner alebo model môže použiť dočasný `302` na relevantné
  vyhľadávanie. Takýto fallback sa nesmie tváriť ako trvalá obsahová zhoda.
- Odstránený sortiment bez náhrady vracia skutočný `410 Gone`, nie `200`
  s textom chyby a nie presmerovanie na domovskú stránku.
- Indexovateľná odpoveď `200` musí mať H1, obsah a správny canonical.

## Výsledky

- `PASS` – technicky správne správanie.
- `FALLBACK OK` – bezpečný dočasný `302` na relevantné vyhľadávanie.
- `410 OK` – odstránená URL bez relevantnej náhrady správne vracia `410`.
- `NEOVERENÉ HTTP` – bol spustený iba dry-run; DNS zatiaľ nemožno meniť.
- `NEVYRIEŠENÉ MAPOVANIE` – URL ešte nemá bezpečné rozhodnutie.
- `MANUÁLNE OVERIŤ` – technický cieľ môže byť správny, ale treba potvrdiť obsahovú zhodu.
- `NESPRÁVNY REDIRECT`, `REDIRECT CHAIN`, `404`, `500`, `SOFT 404`, `CHÝBA CANONICAL`, `NOINDEX` – blokujúce chyby.

DNS sa môže meniť až vtedy, keď report ukáže **Pripravené na DNS: ÁNO**.

## Test už nasadeného servera

```bash
npm run migration:gate:remote -- --base-url https://testovacia-domena.sk --allow-noindex
```

Pri testovaní `tonerymaxim.info` sa globálny noindex automaticky považuje za správny. Na produkčnej `.sk` je noindex blokujúca chyba.

## Kontrola mapovania bez servera

```bash
npm run migration:gate:dry-run
```

Dry-run iba overí, že CSV sa dá načítať, nemá duplicitné staré URL a každému
riadku vie priradiť kontrolný režim. Zámerne vždy ukáže
**Pripravené na DNS: NIE**, pretože neposiela žiadne HTTP požiadavky.

Rovnako ani test s `--types` alebo `--limit` nikdy neschváli zmenu DNS, hoci
všetky vybrané URL prejdú. Stav **ÁNO** môže vydať iba úplný HTTP test celej mapy.

## Rýchle čiastkové HTTP testy

```bash
npm run migration:gate:remote -- --types static,printer-brand --limit 100
npm run migration:gate:remote -- --types printer-model --concurrency 6
```

## Povinné poradie pred zmenou DNS

1. `npm test`
2. `npm run build`
3. obnoviť lokálnu produktovú cache z rovnakého zdroja ako produkcia
4. `npm run migration:gate`
5. skontrolovať `migration/reports/latest.html`
6. DNS meniť iba pri **Pripravené na DNS: ÁNO**

Reporty v `migration/reports/` sú lokálne výstupy a neposielajú sa do GitHubu.

## Finálne pravidlá V69

Finálny prechod nepoužíva dočasné `302` presmerovania ani všeobecné
presmerovanie na vyhľadávanie:

- rovnaká existujúca stránka zostáva `200`,
- jednoznačne zhodný produkt alebo model tlačiarne dostane jeden priamy `301`,
- zrušený produkt bez bezpečnej náhrady dostane `410`,
- kalendáre, diáre a ďalší neprenesený netonerový sortiment dostanú `410`,
- neplatné systémové URL ako `/UNDEF/` a `/import-eurodata/` dostanú `410`,
- starý článok bez preneseného rovnakého obsahu dostane `410`,
- neznáma URL, ktorá nepatrí do historickej mapy, dostane skutočný `404`.

URL s odpoveďou `410` zostávajú v kontrolnom zozname zámerne. Google ich musí
navštíviť a dostať správny stav; odstránenie URL zo zoznamu by ich nevyriešilo.
