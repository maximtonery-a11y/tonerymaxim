# AI Tomáš v2 – izolovaný vývoj

Ostrá vetva `main` zostáva bez zmeny. Všetky úpravy sa pripravujú na `ai-tomas-v2-isolated`.

## Identifikované chyby v skutočnom rozhovore (22. 10. 2026)
- Po výpočte 2 ks tonerov následná otázka „A keď kúpim 4 kusy?“ musí zachovať vybraný produkt aj kuriéra/dobierku.
- „Vieš mi odporučiť tlačiareň kde je najlacnejšia cena za vytlačenú stranu?“ nesmie spustiť opakované nacenenie tonera z práve otvoreného detailu.
- „Nie, myslím či mi vieš odporučiť tlačiareň, nie toner“ je explicitná oprava úmyslu, nie nejasný návrat k toneru.

## Požiadavky na riešenie
1. Jeden konverzačný orchestrátor; model spracúva úmysel, vzťah ku kontextu a následnú otázku.
2. Katalóg, cena, sklad, kompatibilita, zľava, doprava a nákup sú deterministické nástroje so zdrojmi pravdy z obchodu.
3. Nová téma musí zrušiť naviazanie na otvorený produkt, ale nie nevratne zahodiť históriu; explicitné vrátenie k staršiemu produktu je možné.
4. Pri nedostupnej OpenAI API modelovej odpovedi transparentný fallback, žiadne predstieranie porozumenia a žiadne vymyslené ceny.
5. Oddelené nezapisujúce testy; v žiadnom prípade nezapisovať objednávky, nemeniť košík, ceny ani sklad vo WooCommerce.
6. Testovať skutočný model a skutočné HTTP endpointy osobitne od simulácií. Evidovať modelStatus, engine a chyby.
7. Bez úspešnej regresie, integračného overenia a porovnania s ostrou prevádzkou nenasadzovať do main.

## Stav
Táto vetva je iba vývojová; bez nasadenia a bez produkčných zmien. Dokument definuje kritériá prijatia, nie dôkaz, že oprava je hotová.
