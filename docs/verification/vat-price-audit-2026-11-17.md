# Cenový a DPH audit – 17. 11. 2026

**Historický výsledok pred opravou (`729325b2`): kontrola odhalila štyri chyby.** Nižšie sú pôvodné dôkazy a výsledky auditu k verzii `f9c9fd45`. Oprava a aktuálne overenie sú v [nadväzujúcom protokole](vat-price-fix-2026-11-17.md); počty testov a otvorené chyby v tomto historickom zázname neopisujú opravenú verziu.

## Rozsah a ochrana produkcie

- Overený `main`: `f9c9fd45eadc2ff91b77cb0d6f899f127ad6cd42` (účet a opakovanie objednávok, PR #15).
- Porovnanie s `5deb845bfdaf59974f8cc9379aacb75d48921dce` potvrdilo nulový rozdiel v cenovom importe, košíku, pokladni, GoPay, vytváraní objednávok a WordPress pluginoch.
- Woo bolo kontrolované iba čítaním. Neboli vytvorené skúšobné objednávky, odoslané e-maily, spustené platby ani upravené produkty alebo daňové nastavenia.
- Nové testy používajú neplatnú testovaciu doménu, zachytené požiadavky GET a samostatné dočasné súbory. Časť s PHP nie je živý WordPress/Woo checkout.

## Živé nastavenia

WooCommerce 11.2.1 má zapnuté dane, ceny zadané s DPH a zobrazenie v obchode aj košíku s DPH. Štandardná sadzba je SK 23 %, jednoduchá, priorita 1, platná aj na dopravu. Dane sa zaokrúhľujú po položkách; základom je dodacia adresa. TM pri novom nákupe používa pevných 23 %, nejde o automatickú synchronizáciu sadzieb z Woo. Účet číta skutočný `total_tax` z historickej objednávky.

Tri porovnané produkty sú zdaniteľné v štandardnej triede; cena Woo sa rovná cene v TM:

| SKU | S DPH | Bez DPH pri 23 % |
| --- | ---: | ---: |
| 13001 | 9,66 € | 7,85 € |
| 15048 | 13,05 € | 10,61 € |
| 039860 | 104,66 € | 85,09 € |

Základná sadzba 23 % je potvrdená [Finančnou správou](https://www.financnasprava.sk/sk/podnikatelia/dane/dan-z-pridanej-hodnoty/sadzby-dane). Nejde o účtovné ani právne potvrdenie každej produktovej kategórie alebo každej faktúry.

Pokus o čítací export daňových tried celého katalógu sa nedokončil (rozhranie zostalo na 94 %). Z tohto auditu preto nevyplýva potvrdenie daňovej triedy každého produktu; živé porovnanie vyššie je vzorka troch SKU. Produkty sa neupravovali.

## Objednávky overené vo Woo

| Woo ID | Bez DPH vrátane poplatkov a zaokrúhlenia | DPH | Celkom |
| --- | ---: | ---: | ---: |
| 54550 | 11,51 € | 2,66 € | 14,17 € |
| 54549 | 27,10 € | 6,24 € | 33,34 € |
| 54548 | 5,44 € | 1,26 € | 6,70 € |
| 54546 | 20,41 € | 4,69 € | 25,10 € |
| 54545 | 27,00 € | 6,22 € | 33,22 € |
| 54542 | 201,99 € | 46,46 € | 248,45 € |

Nový `accountOrderTotals` a `orderLineGrossTotal` tieto sumy zachovávajú. Historické objednávky sa neprepočítavajú novou 23 % sadzbou.

## Reprodukované chyby

1. **Rozpis DPH v pokladni sa môže líšiť od Woo.** Render skutočnej funkcie `renderCheckoutSummary` pre 2 × 15,69 € kompatibilný valec, zľavu 10 %, kuriéra 3,90 € a dobierku 1,20 € ukazuje celkom 33,34 €, ale DPH 6,23 € a základ 27,11 €. Woo objednávka 54549 má 6,24 € a 27,10 €. Košík a potvrdenie tiež používajú prepočet z celku; ich dotknuté funkcie sú uvedené nižšie.
2. **Dodatočných 5 % za štyri samostatné CMYK farby existuje len v klientovi.** Štyri položky W2030A/W2031A/W2032A/W2033A po 10 € a po 1 kuse: `cartPricing` ukáže 38 €, `secure-checkout-cart` a tvorba Woo objednávky 40 €. Reprodukované v košíku aj pokladni. Toto nie je množstevná zľava za 2–3 alebo 4+ kusy jednej položky.
3. **Rozdiel v zaokrúhľovaní pri presnej polovici centa.** Payload skutočného `lineItems` a `roundingAdjustment` pre produkt 3,08 € má základ 2,50 €. Pôvodný výpočet TM predpovedá 0,58 € DPH; izolované daňové metódy Woo pri predvolenom režime pre ceny s DPH zaokrúhlia 0,575 € na 0,57 €. Test zahŕňa kuriéra 3,90 €: celkový výsledok je 6,97 € namiesto 6,98 €. Nebol vykonaný zápis do živého Woo; prípad treba pokryť pri oprave a overiť prípadné živé filtre alebo zmenu režimu.
4. **Záporný zaokrúhľovací poplatok môže Woo znovu zdaniť.** Pri 30 rôznych položkách po 1,20 € pôvodný payload pridá `Zaokrúhlenie -0,30 €` so stavom `none`. Pôvodná PHP metóda Woo pre záporné poplatky rozdeľuje daň podľa objednávky aj v tomto prípade. Izolovaný výsledok je 35,93 € namiesto 36,00 €. Rovnaký záver o obmedzení referenčného testu platí ako pri bode 3.

Dotknuté miesta: `src/scripts/cart.js` (`cartPricing`, `netFromGross`), `src/scripts/checkout.js` (`cartPricing`, `renderCheckoutSummary`), `src/pages/platba-dokoncena.astro` (`calc`), `src/lib/checkout-order.ts` (`predictedWooGross`, `roundingAdjustment`). Všetky boli prítomné už pred PR #15.

## Tvrdé testy

`scripts/vat-price-integrity.test.ts` obsahuje 8 testov. Pri plnom referenčnom behu: **4 prešli, 4 zlyhali na vyššie opísaných chybách**, bez preskočených testov. Úspešné prípady zahŕňajú 180 000 kombinácií cien 0,01–100 €, množstiev 1/2/3/4/21/99 a troch typov produktov; testujú paritu položkovej ceny a množstevnej zľavy medzi klientom a serverom, nie všetky kombinácie celých objednávok. Samostatne je otestované opakovanie so zastaranou cenou v košíku a nové overenie ceny z Woo.

PHP referencia používa originálne metódy `WC_Tax::calc_tax`, `wc_get_tax_rounding_mode`, `wc_round_tax_total`, `WC_Order_Item_Fee::get_tax_class_costs` a `calculate_taxes` z verzie 11.2.1. SHA-256 zdrojov sa kontroluje. Výber sadzby, WordPress filtre a úložisko sú izolované; konfigurácia je jedna SK 23 % sadzba, ceny s DPH, zaokrúhľovanie po položkách a predvolený režim `auto`. Referencia najprv úspešne reprodukuje skutočnú objednávku 54549. PHP beh auditu: 8.4.24; živý Woo má PHP 8.5.12.

Bežná existujúca kontrola `npm run test:release`: **300/300 úspešných**. To neprekrýva 4 zlyhania novej cielenej sady. Samostatne prešli aj PHP kontroly faktúr (56), štatistík (1 338), reklamácií (52) a e-mailových stavov (6); prvý lokálny beh faktúr vyžadoval doplniť chýbajúce PHP rozšírenia testovacieho prostredia, potom prešiel. Produkčný plugin sa nemenil.

Bez PHP referencie sa 3 integračné testy preskočia a ostatných 5 stále reprodukuje prvé dve chyby:

```sh
node --experimental-strip-types --test scripts/vat-price-integrity.test.ts
```

Plný beh vyžaduje PHP a súbory `wc-core-functions.php`, `wc-formatting-functions.php`, `class-wc-tax.php`, `class-wc-order-item-fee.php` z [oficiálneho tagu WooCommerce 11.2.1](https://github.com/woocommerce/woocommerce/tree/11.2.1/plugins/woocommerce/includes):

```sh
TM_WOO_REFERENCE_DIR=/path/to/reference TM_PHP_BIN=php \
node --experimental-strip-types --test scripts/vat-price-integrity.test.ts
```

## Podmienky ďalšieho vydania

Oprava musí zjednotiť zobrazenie so skutočným výsledkom Woo, odstrániť zľavu, ktorú server neposkytuje, a zachovať dohodnutú sumu s DPH aj pri polovici centa a väčšom počte riadkov. Potom musia prejsť tieto reprodukčné testy, bežné regresie a kontrola na izolovanom WordPress/Woo prostredí s rovnakou konfiguráciou. Cenníkové ceny a sadzby DPH sa nesmú hromadne prepisovať. Pôvodná auditná revízia sa nemala zlúčiť samostatne ako oprava. Nadväzujúca implementácia už obsahuje opravu a rozšírené testy; tento dokument zostáva záznamom pôvodného stavu.
