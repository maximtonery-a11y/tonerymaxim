# Stabilná navigácia účtu — 24. 11. 2026

## Zaznamenaný stav pred úpravou

- Hlavná vetva: `b5e9fcd9b42cdae434c12d654cfbefdf9cc7bb62` (vrátane nového hľadania fotoaparátom a pravidiel v `AGENTS.md`). GitHub kontrola tejto verzie `45427261532` je úspešná.
- Nadväzuje na otvorené PR #38, commit `e0e1e2bf6f06f520858e94424c5155c8e8808755`. Jeho testy rýchlosti a zostavenie prešli, ale celý job `44501989375` bol ukončený po 15 minútach. Nešlo o dokončenú zelenú kontrolu. Preto sa stará vetva priamo nenasadzuje.
- Dotknuté časti: `/ucet`, `/ucet/objednavky`, `/ucet/tlaciarne`, mobilné menu a súkromné čítanie údajov WooCommerce. Reprodukcia: prihlásený zákazník otvorí prehľad, potom objednávky a tlačiarne; počas čakania opakuje kliknutie. Pôvodný prehľad načítava celý finančný súhrn a ďalšie stránky opakujú čítanie objednávok.
- Lokálny Node `24.22.3`, čistá inštalácia podľa existujúceho lockfile. Kontrola Astro: 613 súborov, 0 chýb, 0 varovaní a 22 existujúcich hintov. Produkčný build: 416 testov, 407 úspešných, 9 preskočených, 0 chýb. Render účtu aj skúška zachovania nastavení tlačiarní/strážcu prešli.
- Pokus o kompletné `npm test` sa už na pôvodnej verzii zastaví v reklamných testoch: 83/85 prešlo; dva testy vyžadujú miestnu kópiu celého skutočného katalógu `.tm-cache/products.json`, ktorá v čerstvom klone nie je. Nespúšťa sa produkčný Woo import a výsledok sa nenahrádza umelým katalógom.
- Audit existujúcich produkčných závislostí: 10 nálezov (7 high, 3 moderate, 0 critical). Sú prítomné pred touto úpravou. Zmena účtu nemení závislosti; tento záznam neoznačuje celý stack za bezchybný ani bezpečnostný audit za čistý.

## Výsledná úprava

Z pôvodného PR #38 sa preniesla oprava na dnešnú hlavnú vetvu; všetky novšie úpravy fotoaparátu, katalógu a košíka zostali zachované. Konflikt reklamného testu sa vyriešil ponechaním už opravenej verzie z hlavnej vetvy.

- Prehľad, objednávky a tlačiarne zdieľajú prvú stránku histórie počas 15 sekúnd. Súbežné požiadavky toho istého zákazníka používajú jedno čítanie; rôzni zákazníci majú samostatné kľúče. Úspešné zápisy objednávok a zákazníka dáta zneplatnia. Staršie rozbehnuté čítanie nesmie prepísať uložený profil.
- Zákazník a história sa načítajú súbežne. Pri viac než 20 objednávkach je kompletný finančný súhrn dostupný cez „Zobraziť“ (`/ucet?summary=1`); počet a posledná objednávka zostávajú priamo v prehľade. Pri kratšej histórii sa zobrazí úplná suma hneď. Čiastočná suma sa nevydáva za celoživotný súčet.
- Dotyk hneď označí jediný cieľ; ďalší klik na tú istú čakajúcu adresu nereštartuje načítanie. Pri návrate z histórie, Escape alebo po ochrannom limite sa stav uvoľní. Rovnako sú ošetrené odkazy v oboch vysúvacích menu.
- Súkromná cache je iba v procese servera, obmedzená na 100 položiek / 8 MiB; hodnoty nad 256 KiB sa neuchovávajú. HTTP odpovede účtu naďalej používajú `no-store`. Externá administratívna zmena objednávky sa môže prejaviť po krátkej TTL; vlastné úspešné zápisy invalidujú okamžite v danom procese.
- Do GitHub kontroly pribudli limity počtu Woo požiadaviek, testy rýchleho opakovaného otvorenia a kontrola menu v skutočne zostavenom webe. Celkový limit dlhého jobu sa zmenil z 15 na 25 minút; časové limity jednotlivých scenárov sa neodstránili.

## Porovnanie pred a po

Rovnaký porovnávací skript, zostavený Node/Astro server, fiktívny zákazník a 400 ms oneskorenie každého Woo GET. Tri striedané kolá každej verzie pre každú veľkosť účtu; tabuľka uvádza mediány HTTP odozvy. Nejde o meranie fyzického telefónu ani produkčnej siete. Úplné pozorovania sú v `account-navigation-comparison-2026-11-24.json` v tomto adresári.

| Počet objednávok | Otvorenie | Pred | Po |
| --- | --- | ---: | ---: |
| 61 | Prehľad | 1 067 ms | 453 ms |
| 61 | Objednávky po prehľade | 509 ms | 27 ms |
| 61 | Tlačiarne po objednávkach | 436 ms | 13 ms |
| 3 | Prehľad | 881 ms | 461 ms |
| 3 | Objednávky po prehľade | 425 ms | 20 ms |
| 3 | Tlačiarne po objednávkach | 417 ms | 10 ms |

Počty Woo čítaní pri tejto postupnosti: `3 / 1 / 1` → `2 / 0 / 0`. Osem súbežných otvorení druhej strany: `8` → `1` čítanie. Opakované otvorenia po úprave v troch porovnávacích kolách trvali 4–44 ms bez Woo požiadaviek.

Časy na tomto hoste kolísali: jedno pôvodné otvorenie trvalo 4 682 ms a v skoršom upravenom behu sa objavili teplé odozvy 365 a 308 ms. Tieto behy sa nezamlčujú. Preto sa uvádzajú opakované merania aj ich jednotlivé pozorovania; nie prísľub, že každý reálny klik má rovnakú latenciu. Test súbežnosti sa spresnil na čas začatia samotných Woo požiadaviek, aby sa štart serverového modulu nevydával za sériové čítanie. Limit teplých odoziev 250 ms zostal zachovaný a záverečný lokálny beh ho splnil pre oba účty; začiatky oboch studených čítaní sa líšili o 1 ms.

Porovnanie klientskych súborov: 60 pred aj po, 59 identických podľa SHA-256; iba štýl účtu má navyše 532 bajtov pred kompresiou. Nepribudol externý JavaScriptový balík.

## Overenie a pokračovanie

| Kontrola | Pred | Po |
| --- | --- | --- |
| Astro check | 0 chýb / 0 varovaní / 22 hintov | 0 chýb / 0 varovaní / 22 hintov |
| Produkčný release guard | 407 úspešných / 9 preskočených | 427 úspešných / 9 preskočených |
| Bezpečnostné regresné testy | 14/14 | 14/14 |
| DPD integrácia a metadáta výdajného miesta | 36/36 | 36/36 |
| Celé `npm test` v čerstvom klone | 83/85 v prvej sade; chýba katalóg | rovnaké dva testy, rovnaká príčina |
| Audit produkčných závislostí | 7 high / 3 moderate | rovnaké nálezy, bez novej závislosti |

Ďalej prešlo 20 testov rýchlosti účtu, 23 testov strážcu/menu, render histórie so 61 objednávkami a štyrmi stranami, faktúry, opakovaný nákup, odmietnutie hosťa/cudzieho zákazníka a explicitné zobrazenie úplného súhrnu. Render strážcu potvrdil zachovanie nesúvisiacich nastavení, druhej tlačiarne, vypnutia po obnovení stránky aj histórie.

Ručné overenie zostaveného náhľadu v cloudovom prehliadači: obe menu pri 320 px, pevných 74 px lišty a 58 px dotykových plôch pri výške 640 px; pri šírke 1280 px je lišta skrytá. Pri dvoch rýchlych kliknutiach a testovom 5-sekundovom zdržaní HTML bolo zvýraznené iba „Tlačiarne“, lišta mala naďalej 74 px a po dokončení sa čakajúci stav zrušil. Po otvorení prehľadu bol dostupný presný počet aj odkaz na celý finančný súhrn.

Prvý nový GitHub beh `45453288341` zachytil prekážku v pridanom browser scenári: čerstvý kontext mal nad menu otvorenú cookie lištu. V scenári sa doplnilo jej bežné odmietnutie pred interakciou s účtom; kontrola klikateľnosti sa neobchádza vynúteným kliknutím a produkčný kód sa tým nemení. Neúspešný beh sa nezlúčil.

Záverečný GitHub stav, presný commit a zlúčenie sa evidujú v [PR #38](https://github.com/maximtonery-a11y/tonerymaxim/pull/38). Pred zlúčením musia prejsť všetky povinné joby vrátane nákupných scenárov a GoPay. Táto lokálna skúška neposiela produkčné e-maily, nemení účty zákazníkov a nestrháva platby. Redeploy v Coolify a odozva fyzického Android telefónu sú samostatné následné overenie.

Pri ďalšej úlohe začni aktuálnym stavom PR #38, týmto záznamom a aktuálnou hlavnou vetvou. Starú vetvu z 19. novembra nekopíruj cez novší web. Existujúce nálezy závislostí a testy vyžadujúce reálny lokálny katalóg ostávajú výslovne evidované; celá aplikácia sa neoznačuje za bezchybnú na základe testov tejto úpravy.
