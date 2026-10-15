# Stabilita po živom overení – 15. 10. 2026

Základ kódu: `a1fc76bb71797e0512be11a1bc34a8a3379afb49`. Predchádzajúci živý audit je uložený oddelene v [audite 8462ff4](https://github.com/maximtonery-a11y/tonerymaxim/blob/8462ff4e3f34d0f3dd9ab23023bb312ae69330a1/docs/verification/live-release-2026-10-15.md). Tento dokument overuje ďalšie opravy a prevenciu regresií; neoznačuje ich za nasadené.

## Čo sa opravilo

- Index výberu tlačiarne pri zlúčení rodiny Samsung zahadzoval skutočné názvy variantov. ML-2165W preto v tomto výbere zmizol, hoci ostatné vyhľadávanie a stránka tlačiarne fungovali. Index teraz zachová skutočné aliasy z katalógu, nezvyšuje počet produktov duplicitnými variantmi a kanonická URL zostáva spoločná. Klient aj API používajú rovnaké porovnanie. Kliknutie, Enter aj tlačidlo vedú na kanonickú stránku. HP a HP+ zostávajú oddelené; neexistujúce koncovky sa nevymýšľajú.
- Pri šírke 1348 px vytláčal súčet navigácie, vyhľadávania a dlhého prihláseného účtu košík mimo obrazovky. Desktopová hlavička v rozsahu 1101–1600 px používa dva riadky a názov účtu má obmedzenú šírku. Žiadny ovládací prvok sa neodoberá. Zmenu pixelového rozloženia treba vizuálne potvrdiť po redeployi.
- Pridaná ochrana `prebuild`, GitHub CI a hodinový funkčný monitoring. Monitoring je overený aj na práve spustenom procese; statická homepage a health úmyselne nenačítavajú katalóg.
- Príprava verejného snapshotu pre úplné regresie teraz doplní odvodené interné `search_text`, ktoré verejné API vynecháva. Ceny, modely a dodávateľské údaje sa nemenia. Tým sa odstránil nesúlad testovacieho vstupu, nie chyba produkčného vyhľadávania.

## Overenie kandidáta

| Kontrola | Výsledok |
| --- | --- |
| Celé regresie na verejnom snapshote, pred doplnením posledného testu cold start monitoringu | 1126/1126, 0 zlyhaní, 0 vynechaní |
| Finálna kritická ochrana pred buildom vrátane cold start monitoringu | 93/93 |
| OEM vyhľadávanie na rovnakom snapshote | 300/300 prípadov, 1111 kontrol |
| Nákup cez zostavené HTTP handlery s lokálnymi Woo/GoPay transportmi | 27 scenárov, všetky prešli |
| Monitoring proti skutočnému produkčnému SSR buildu na lokálnom HTTP | 12/12 |
| Kanonická stránka ML-2165W z výsledku zostaveného API | HTTP 200, zachovaný W alias |
| Skutočný klientsky JavaScript výberu v DOM/VM teste | W variant, kliknutie a Enter prešli |
| Astro check | 506 súborov, 0 chýb, 0 warnings, 25 existujúcich hints |
| `npm run build` vrátane automatického `prebuild` | úspech |

Nákupné scenáre pokrývajú ceny, aktuálnu Woo cenu, dopravné/poplatky, nesprávne vstupy, zľavy, opakovanie bez duplicitnej objednávky/platby a zrušenú GoPay platbu s prechodom na dobierku. Reálne Woo objednávky, platby a odoslané e-maily: **0**. Žiadne neplánované externé volanie.

Použitý verejný snapshot je z 13. 10. 2026 a má 7734 produktov. V izolovanom teste monitoringu sa čas vygenerovania nastavil na aktuálny čas, aby sa otestoval zdravý čerstvý import. Samostatné testy overujú aj odmietnutie katalógu staršieho ako 30 hodín, chýbajúci variant, viditeľný prázdny formulár a chybný AI výpočet. Externý fetch zostaveného servera bol blokovaný. Testovacie GoPay identifikátory iba sprístupnili validačnú vetvu; brána sa nekontaktovala. Miestny cgroup limit nie je konfigurácia produkčného hostingu.

Tento beh neopakuje extrémny záťažový import z [predošlého reportu](predeploy-release-2026-10-14.md); importný runtime sa týmto vydaním nemení. Funkčné a pamäťové regresie prešli. Nová vizuálna kontrola, produkčný CI beh, skutočný limit RAM a najbližší reálny import sa nesmú zamieňať s lokálnymi testami. Testy neposkytujú záruku 100 % dostupnosti.

## Opakovanie a prevádzka

```sh
npm run test:release
npm run check
npm run build
node scripts/verify-predeploy-regressions.mjs --catalog /tmp/products.json --output /tmp/tm-regressions
TM_SEARCH_CATALOG=/tmp/products.json node --experimental-strip-types scripts/verify-search-300.ts
node scripts/verify-predeploy-purchase.mjs --catalog /tmp/products.json --output /tmp/tm-purchase.json
npm run test:live
```

Príkaz `test:live` používa živý web, ostatné uvedené overenia používajú izolované fixture dáta. Hostingové nastavenia a hranice automatizácie opisuje [návod stabilnej prevádzky](../STABILITA-A-NASADENIE.md). Súhrn strojových výsledkov: [stability-release-2026-10-15.json](stability-release-2026-10-15.json).
