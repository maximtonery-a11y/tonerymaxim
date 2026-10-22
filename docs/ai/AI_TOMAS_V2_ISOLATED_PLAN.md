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

## Regresný audit 22. 10. 2026 – prekážky ostrého nasadenia

- Nové konverzačné testy 3/3 a cielené nákupné testy 85/85 prešli.
- Produkčná sada 220/239 (19 zlyhaní) a AI sada 416/563 (147 zlyhaní).
- V logoch časti zlyhaní je explicitné `Chýba WOO_URL, WOO_CONSUMER_KEY alebo WOO_CONSUMER_SECRET v .env`; príklady: ai-search-parity a ai-tomas-v14-deep-integration. Tieto testy sa nesmú označiť za úspešné ani automaticky za chybu obchodnej logiky.
- Rozšírené suite vyžadujú deterministický katalóg alebo bezpečný read-only testovací zdroj a porovnanie oproti vetve main.
- Testy cielených košíkových ciest nepoužívajú reálny nákup a neoverujú skutočné Woo objednávky.
- CI release check je znova fail-closed: ak produkčné alebo AI regresné testy zlyhajú, kontrola vydania musí byť červená, hoci Astro build môže byť úspešný.
- Na ostré nasadenie je ďalej potrebný end-to-end test cez izolovaný server, funkčná modelová odpoveď s `modelStatus:ok`, porovnanie Woo čítaní a overenie plnej nákupnej cesty vrátane rýchleho nákupu, sád a košíka.

Táto vetva zostáva draft PR, nedotýka sa produkčného main.

## Priame porovnanie s main – 22. 10. 2026

Zdroj: GitHub Actions run 39760825859; identický testovací príkaz, checkout oddelene main a ai-tomas-v2-isolated, bez Woo poverení.

| Sada | main | isolated |
| --- | --- | --- |
| production | 219/239 pass, 20 fail | 220/239 pass, 19 fail |
| AI regression | 416/563 pass, 147 fail | 416/563 pass, 147 fail |

Pozor: počet prechodov sám nedokazuje, že ide o presne tie isté zlyhania. Ďalším kritériom je porovnať konkrétne zlyhané scenáre a zaviesť fixtures pre všetky obchodné toky. Zlyhávajúce široké suite nemožno vypustiť z release gate.
