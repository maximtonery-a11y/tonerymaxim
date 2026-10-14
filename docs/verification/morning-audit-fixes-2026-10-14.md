# Opravy po rannom audite — 14. 10. 2026

Oprava nadväzuje na produkčný commit `d4966875b1c8d46bb239eaa0144f3901ef2cb16c`. Zmeny sú pripravené na redeploy; výsledky nižšie rozlišujú meranie nasadenej verzie a test opraveného kódu. Neuskutočnila sa reálna objednávka ani platba.

## Pamäť: potvrdené údaje a príčina

Živý `/api/storefront-check` potvrdil import od 05:00:08 do 05:07:19 UTC (430,522 s): RSS 348 → 441 MB, heap 173 → 272 MB. Následne sa heap výrazne uvoľnil. Pri ďalších meraniach rovnakého procesu:

| Čas UTC | RSS | Heap | Cgroup | Uptime | API cache |
|---|---:|---:|---:|---:|---:|
| 06:22:35 | 388 MB | 163 MB | 392 MB | 46 552 s | 46 |
| 11:45:23 | 390 MB | 170 MB | 395 MB | 65 920 s | 75 |

Za 5 h 22 min 48 s teda RSS stúplo iba o 2 MB, pri rovnakom PID 20 a zodpovedajúcom raste uptime. To podporuje ustálenie po importe, nie tvrdenie o nepretržitom úniku. Nie je to dôkaz, že dlhodobý leak neexistuje. Pred ranným importom už bola pamäť vyššia než pri nočnom audite; celý historický rozdiel 124 MB nemožno z týchto bodov presne priradiť konkrétnym objektom.

V importe sa však preukázali odstrániteľné alokácie:

- `mapProduct` vyrábal rozsiahly normalizovaný text z HTML a atribútov; import ho okamžite zahadzoval a neskôr vytváral nový text.
- obohatenie vyrábalo ďalší vyhľadávací text pred konečnou kompakciou;
- publikovanie vytváralo druhé objekty pre celý nový katalóg, hoci importované objekty boli súkromné a plné detaily už boli na disku.

Oprava vyhľadávací text vytvára až z konečných polí a pri publikovaní znovu použije súkromné importované objekty. Kompletné HTML/atribúty, ceny, sklad, obohatenie, deduplikácia, história cien/slugov, poradie a atomické publikovanie ostávajú zachované. Zlyhaný či neúplný import stále ponechá posledný úplný katalóg.

Vyššie RSS pri nižšom heape je tiež zlučiteľné s rezervovanými stránkami/fragmentáciou alokátora. Toto je vysvetlenie konzistentné s dátami, nie zmeraný rozpis natívnej pamäte konkrétneho procesu. [Dokumentácia Node.js](https://nodejs.org/download/release/v24.20.0/docs/api/process.html#processmemoryusage) vysvetľuje rozdiel metrík a možné správanie `glibc malloc`.

## Pamäť: porovnanie rovnakého importu

Offline fixture: 2 500 produktov, veľké Unicode HTML, 20 modelov a 10 atribútov na produkt. Rovnaký Node a hardvér, tri importy, prirodzené GC. Overené boli všetky úplné detaily, nie iba vzorka.

| Verzia | Maximum RSS počas importov | RSS na konci | Heap na konci |
|---|---:|---:|---:|
| Nasadený kód `d496687` | 534 MB | 489 MB | 127 MB |
| Oprava — prvý beh | 370 MB | 328 MB | 87 MB |
| Oprava — záverečný beh | 395 MB | 356 MB | 90 MB |

Pri záverečnom behu je pokles maxima 26 % a koncovej RSS 27 %. Variabilita medzi behmi je uvedená zámerne. Kontrolný súčet runtime katalógu a všetkých 2 500 úplných detailov je vo všetkých troch porovnaniach rovnaký:

`47262a3f00d5acf49d9f9c0be5ae45c973125aefe2e6cc36e629a0a5b8a18b43`

Pri desiatich importoch bez núteného GC bolo maximum 386 MB, koncové RSS 349 MB a heap 90 MB. RSS po jednotlivých behoch: 266, 315, 301, 353, 367, 361, 329, 372, 347, 349 MB. Pamäť medzi behmi klesala; krátky test negarantuje neobmedzenú dobu prevádzky ani konkrétny produkčný strop.

Reprodukcia: `node --experimental-strip-types scripts/verify-import-memory.ts <repo-root> 3` alebo posledný argument `10`. Skript blokuje reálne importy použitím lokálneho mocku a nikdy nevolá nútené GC.

## Výsledkové cache a diagnostika

API aj AI výsledková cache majú okrem limitu počtu aj rozpočet 8 MiB na uložené telo/serializovanú podobu. Nadmerná odpoveď sa normálne vráti zákazníkovi, iba sa neuloží. Pri ďalšom dopyte sa odstránia aj expirované jednorazové otázky. Katalóg ani výsledky sa touto úpravou neskracujú.

Diagnostika dopĺňa `productApiCacheBytes`, `aiCommerceCacheEntries`, `aiCommerceCacheJsonBytes`, oba rozpočty a posledné importné `observedPeak`, `peakStage`, `samples`. Veľkosť JSON cache nie je presné meranie fyzického heapu. Telemetria drží iba číselné vzorky posledného importu, žiadne produkty ani novú periodickú úlohu. Kľúče pôvodného health kontraktu zostali zachované.

`memoryLimitConfigured: false` ostáva nedostatkom konfigurácie kontajnera. GitHub kód Docker limit nenastaví. Hodnota `TM_PROCESS_MEMORY_LIMIT_MB` je iba diagnostický rozpočet a nesmie sa zamieňať so skutočným limitom kontajnera. Tento commit nemení Coolify ani nenastavuje svojvoľný strop heapu.

## AI: rýchlosť a presnosť

Osem reprodukovaných otázok na `www.tonerymaxim.sk` cez jedno opakovane používané spojenie malo sieťový medián 405 ms (243–987 ms). Serverové `app` spracovanie malo medián 171,7 ms (9,1–755 ms). Prvé spojenie na jednoduchý health endpoint trvalo 6,26 s, pričom aplikácia pracovala 0,2 ms.

Kontrolný produktový POST cez `https://tonerymaxim.sk` prešiel na `www`: celkom 11 972 ms, serverové spracovanie 379,3 ms. Následné priame POST na `www` trvali 236 ms. Preto samotných 11 s nie je dôkaz pomalého AI enginu. Keďže nemáme pôvodné HTTP časovania auditu, netvrdíme, že všetkých deväť jeho pomalých odpovedí vzniklo týmto presmerovaním. Merania auditu majú rozlišovať celé spojenie, presmerovanie a `Server-Timing` aplikácie. Canonical presmerovanie webu sa nezmenilo.

Opravené konkrétne chyby:

- sada Canon CRG-045 CMYK používa pri ponuke, cene, opakovaní, nadväzujúcej otázke a explicitnom vložení rovnaké reálne ID sady. Pri katalógovej cene 75,20 € sú 3 sady 203,04 € a 4 sady 225,60 €; nepočíta sa cena azúrového tonera;
- Epson 102 je uprednostnená skutočná rodina náplní pred skráteným modelom XP-102; explicitný XP-102 zostáva vyhľadávaním tlačiarne;
- „30X do HP, neviem model“ si vyžiada štítok/model alebo celý OEM. Úplný CF230X sa stále normálne ponúkne;
- vysvetlenie toner/valec/odpadová nádoba pokryje všetky tri diely bez modelového API volania;
- neoverené kompatibility sa v odpovedi jasne označia;
- „Máte HP CF230X?“ sa už nespojí do falošného kódu `matehpcf230x`; objednávané množstvá nevytvárajú falošné OEM pri nadväzujúcej otázke;
- staršia chyba poradcu Canon PFI-120 už neprimiešava nesúvisiace päťfarebné atramentové sady.

Obchodné pravidlá 2–3 ks −10 % / 4+ ks −25 %, výber typu/farby, skutočné katalógové sady, zákaz mutácie košíka a vylúčenie no-chip/OEM-chip/Hatona sú pokryté regresiami.

## Lexmark a obrázky

SKU 16043 / Woo ID 53282 má názov deklarujúci 20 000 strán, ale dodanú kapacitu a modely prázdne. Jasne označená výťažnosť sa doplní z názvu aj pri čítaní už existujúcej cache, takže netreba čakať na ďalší import. Objem, hmotnosť, interval a neoznačené číslo sa nepovažujú za stránky. Štruktúrovaný dodávateľský údaj má prednosť.

Zoznam 11 modelov bol overený v [Lexmark dokumentácii presného OEM 56F2X0E](https://www.lexmark.com/sk_sk/printers/supply/11899/Lexmark-56F2X0E-Black-Extra-High-Yield-Corporate-Toner-Cartr). Použitie pre kompatibilnú položku je odvodené od dodávateľského názvu „náhrada pre 56F2X0E“; nejde o nezávislý test čipu alebo firmvéru. Fallback je obmedzený súčasne ID, SKU, značkou a presným kódom, použije sa iba pri chýbajúcom zozname a uchová zdroj. Dodávateľom uvedené modely neprepisuje. Funguje po redeployi aj po ďalších denných importoch.

Lexmark 56F2X0E, Canon CRG-045BK kompatibilný a Kyocera TK-3160 kompatibilný naďalej používajú náhradný obrázok. Mechanizmus náhrady je aktívny pri prázdnom alebo rozpoznanom generickom obrázku; samotné HTTP 200 nepotvrdzuje vlastnú produktovú fotografiu. Neoverená fotografia originálneho produktu sa nepresúva na kompatibilnú položku. Pri kontrolnom čítaní dodávateľského verejného Store API nastal timeout, preto netvrdíme, že sme overili jeho aktuálne surové obrazové pole.

## Prázdna pokladňa

Živý prehliadač potvrdil naraz viditeľný prázdny stav a formulár, hoci formulár mal `hidden`. Príčinou je vlastné CSS `display: grid`, ktoré prepísalo skrytie. Oprava pridáva pravidlá rešpektujúce `hidden`, skryje formulár a mobilný sprievodca už v SSR a pri prázdnom košíku aj mobilné objednávacie tlačidlo. Naplnený košík formulár normálne otvorí.

Skutočný `renderCheckoutSummary` a jeho cenové funkcie boli spustené na DOM mocku cez prázdny → 3 sady → prázdny košík. Cena 203,04 €, položka, formulár a mobilné ovládanie sú správne. Overené sú pravidlá CSS aj aktuálny produkčný SSR build. Toto nenahrádza vizuálne overenie po redeployi: prehliadač z bezpečnostných dôvodov odmietol lokálny náhľad cez `file:`; iná cesta na obídenie sa nepoužila.

## Záverečné kontroly

- 682 AI, katalógových, vyhľadávacích, importných, pamäťových, checkout a readiness testov: všetky prešli.
- 54 ďalších DPD, GoPay recovery a histórie cien: všetky prešli. Spolu 736 testov.
- 300 OEM dopytov / 1 111 kontrol: všetky prešli na verejnom lokálnom snapshote 7 734 produktov. Nie je to nový test už nasadenej opravy.
- 20 kontrol zostavenej SSR aplikácie: stránky, prázdna pokladňa, opravené API scenáre, Lexmark detail/API/modelová stránka, správna 404. Bez reálneho Woo/AI externého volania.
- Astro check: 0 chýb, 0 varovaní, 25 existujúcich hints; produkčný build prešiel.
- Opakované importy zachovali rovnaký katalóg a úplné detaily.

Nový Lighthouse ani finálne produkčné obrazovky tejto opravy sa neuvádzajú ako overené. Po redeployi treba potvrdiť nové diagnostické polia, zobrazenie prázdnej/naplnenej pokladne, uvedené AI scenáre a najbližší skutočný import. Skutočný pamäťový limit kontajnera a vlastné fotografie zostávajú samostatné otvorené body.

Strojové výsledky: [morning-audit-fixes-2026-10-14.json](morning-audit-fixes-2026-10-14.json).
