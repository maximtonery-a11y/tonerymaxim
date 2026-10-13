# Výkon vyhľadávania a pamäť importu — 13. 10. 2026

Východiskový commit: `3955f64a48ccd0c9e3f07c2cefeefb65be1d2793`.

## Zmena

- Konštantné pravidlá značiek sa kompilujú raz. Značka a spotrebná rodina
  konkrétneho modelu tlačiarne sa memoizujú v ohraničenej mape (8 192 položiek,
  maximálne 512 znakov na uložený vstup). Väčšie hodnoty sa normálne porovnajú,
  iba sa neukladajú. OEM, prefixové zhody, farby, HP+ a ranking sa nemenia.
- Printer API neukladá neznáme značky, ktoré už predtým vracali prázdny výsledok.
  Uchováva najviac 15 podporovaných značiek a globálny index. Nová generácia
  katalógu zahodí staré indexy. Diagnostika uvádza ich aktuálny počet.
- Woo stránky sa ďalej mapujú všetky. Veľké HTML popisy a úplné atribúty sa
  priebežne zapisujú do neverejného NDJSON súboru. V RAM sa ponechajú polia
  potrebné na obohatenie medzi produktmi, ceny, sklad a kompatibilitu.
- Runtime JSON sa zapisuje po blokoch namiesto jedného veľkého stringify.
  Nová generácia sa zverejní atómovým premenovaním až po overení úplnosti,
  zápise a fsync oboch súborov. Neúspešný/neúplný import zachová pôvodný
  katalóg a odstráni rozpracované súbory. Detailné atribúty a popisy ostávajú
  dostupné cez existujúce načítanie detailu podľa bajtového offsetu.
- Hlavička `Server-Timing: app;dur=...` meria spracovanie v aplikácii.
  Nezahŕňa DNS, TLS ani čakanie v proxy pred príchodom do aplikácie.

## Overenie

- 300 pôvodných označení tonerov / 1 111 kontrol: všetky úspešné. Lokálne API
  handlery použili export AI feedu z 13. 10. 2026 05:07:09.499 UTC (7 734
  publikovateľných produktov). Export neobsahuje všetkých 7 932 runtime položiek
  ani úplné detailné Woo atribúty; všetkých 300 očakávaných produktových ID však
  obsahoval. Kontroly zahŕňajú kódy so značkou, malé písmená bez značky,
  prefixy a paritu návrhov s výsledkami.
- 180 relevantných regresných testov: 107 vyhľadávanie, produktové API,
  Woo, SEO indexy, košík, ceny a DPD; 12 pamäť/import/cache; 44 pokladňa,
  GoPay recovery a AI V10–V12; 17 production-readiness. Všetky úspešné.
- Nové testy pokrývajú 2 000 rôznych neznámych značiek, obnovu generácie,
  celý viacstranový import, posledný duplicitný záznam, obohatenie z inej
  stránky, veľké slovenské/Unicode popisy, správne bajtové offsety,
  neúplný import, HTTP chybu a zlyhanie finálneho zápisu.
- Produkčný build a `astro check`: úspešné, 0 errors / 0 warnings.
- Smoke hotového SSR buildu: úvodná stránka, košík, pokladňa a health na oboch
  hostoch HTTP 200. Overená aj hlavička časovania. Nešlo o uskutočnenú platbu.

## Pamäť importu

Offline benchmark dvakrát importoval rovnakých 2 500 syntetických produktov
s veľkými HTML popismi a úplnými atribútmi. V oboch procesoch zostal rovnaký
hash všetkých runtime produktov a piatich kompletných načítaných detailov:
`ff05fc73183e25ac11cf587db8b5645821f5e73ce3a05b2b2f2c20616713e688`.

| Meranie | Pôvodný kód | Opravený kód |
|---|---:|---:|
| Maximálne RSS procesu | 1 399 MB | 506 MB |
| Heap po importe a lokálnom GC | 299 MB | 31 MB |

Ide o porovnanie na identickej záťažovej vzorke, nie predpoveď presného RSS
produkcie. GC bolo použité iba v offline benchmarku, do aplikácie sa nepridáva.
Import nezahadzuje detaily ani produkty a nevyžaduje nové runtime nastavenia.

## Opakovanie

```sh
npm run test:performance
npm run test:search
npm run check
npm run build
npm run test:storefront
node --expose-gc --experimental-strip-types scripts/verify-import-memory.ts
TM_SEARCH_CATALOG=/path/catalog.json node --experimental-strip-types scripts/verify-search-300.ts
```

Po redeployi overiť prvý dotaz aj nové/negatívne OEM, sady, model tlačiarne,
produktový detail, košík a pokladňu. RSS/heap treba zmerať aj pred a po ďalšej
dennej synchronizácii bez reštartu procesu. Dlhodobý únik ani úplná latencia
VPS/proxy nie sú týmito lokálnymi testami uzavreté. Objednávkový, platobný,
dopravný a importný mapovací obchodný kód sa nemení.
