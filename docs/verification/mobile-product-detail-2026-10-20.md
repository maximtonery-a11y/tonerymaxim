# Mobilný detail produktu – 20. 10. 2026

Pri Epson 604XL CMYK sa nezalamovaný údaj o výťažnosti jednotlivých farieb
roztiahol na 596,5 px, hoci pri 393 px displeji mal blok k dispozícii len 365 px.
Implicitný minimálny rozmer vnútorného CSS gridu potom rozšíril aj nadpis,
kompatibilné tlačiarne a informáciu o množstevnej zľave. Globálne orezávanie
stránky presah skrylo, preto samotný `document.scrollWidth` chybu neodhalil.

Oprava v spoločnom `product-detail.css` povoľuje zalamovanie dlhých kapacít,
názvov a kódov a obmedzuje minimálne rozmery vnútorných stĺpcov. Rovnakú
ochranu majú parametre a popis. Text spodného mobilného nákupného tlačidla
sa pri nedostatku miesta môže zalomiť do dvoch riadkov.

## Overenie

- Vstup: 7 898 unikátnych verejných produktov z generácie katalógu
  `2026-10-20T05:07:05.833Z`, vrátane vyhľadaných špeciálnych čipových variantov.
- Skutočný produktový renderer a CSS, prehliadač Chromium 153, mobilná emulácia.
  Hromadný test používa polia verejného katalógového API; detail Epsonu a
  funkčné scenáre sa overili aj cez zostavenú aplikáciu.
- Pred opravou: 487 detailov s presahom pri 360 px, 462 pri 393 px.
- Po oprave: všetkých 7 898 vstupov bez zisteného presahu pri 360 aj 393 px.
- Ďalších 38 náročných a reprezentatívnych produktov bez presahu pri
  320, 375, 430, 768, 820, 880, 900, 1024, 1280, 1440 a 1920 px.
- Zostavená aplikácia: 16 detailov na 5 šírkach (80 načítaní), bez presahu
  v kontrolovaných blokoch a bez klientskych JavaScript chýb.
- Funkcie: zoznam 10 kompatibilných tlačiarní Epsonu, otvorenie a zatvorenie
  popisu a priblíženia, zvýšenie množstva, vloženie 2 kusov správneho SKU
  za aktuálnu cenu do košíka a odkaz na mobilné vyhľadávanie.
- `npm run check`: 0 chýb, 0 warnings, 25 existujúcich hints.
- `npm run build`: úspešné vrátane 140 povinných release testov.
- `scripts/storefront-production-smoke.mjs`: domov, košík, pokladňa a health
  na oboch variantoch domény odpovedali HTTP 200.

Zoznam 487 dotknutých produktov a súhrn meraní je v súbore
`mobile-product-detail-2026-10-20.json`. Testy neodosielajú objednávky.
Overenie prebehlo lokálne; produkcia potrebuje redeploy aplikácie `tonerymaxim`.

## Opakovanie hromadného testu

Vyžaduje Playwright a Chromium, prípadne ich existujúce cesty v premenných
`TM_PLAYWRIGHT_MODULE` a `TM_CHROMIUM_PATH`. Použite verejný katalógový snapshot:

```sh
node scripts/verify-product-detail-responsive.mjs --catalog /path/products.json --output /path/report.json
```

Voliteľné prepínače: `--css` pre reprodukciu so starým CSS, `--widths` pre
čiarkami oddelené šírky a `--limit` pre menšiu vzorku.
