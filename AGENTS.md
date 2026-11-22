# Záväzné pravidlá vývoja ToneryMAXIM (AGENTS.md)

Tieto pravidlá platia pre **každého človeka aj AI agenta**, ktorý mení Astro frontend, serverové API, marketingové meranie, objednávky, Woo integráciu, bezpečnosť či deploy. Hlavná priorita: **funkčný rýchly e-shop, košík, pokladňa a platby GoPay**. Žiadna požiadavka nemá prednosť pred bezpečnosťou a stabilitou nákupu.

## Nemeniteľný pracovný protokol pre každú úlohu

1. **Zaznamenať východiskový stav ešte pred úpravou.** Zistiť SHA aktuálneho `main`, stav pracovného stromu, relevantné existujúce testy, výsledky build/check, výkon mobilu (Lighthouse: LCP, INP, CLS, TTFB, performance score), odpoveď API a priechod košíkom a pokladňou; zaznamenať aj prostredie, dátum, URL, počet behov, sieť a verziu Node. Žiadne vymyslené merania. Ak je základné meranie nedostupné, úloha je `BASELINE_BLOCKED` a žiadne výkonovo citlivé zmeny sa nesmú automaticky nasadiť.
2. **Zmena iba v samostatnej vetve, minimálny rozsah.** Najprv identifikovať dotknuté trasy, závislosti a riziká; neupravovať nesúvisiace súbory. Nezasahovať do produkcie, dát zákazníkov, cien, objednávok, platobných stavov ani živých reklám bez osobitného súhlasu.
3. **Automatická regresná kontrola pred zlúčením.** Spustiť `npm ci`, `npm run check`, `npm test`, `npm run build`, príslušné integračné testy a bezpečnostné kontroly; pri citlivých zmenách navyše skúšky košíka, dopravy, výdajných miest DPD, zliav, kupónov, mobilnej sticky lišty, opakovaného nákupu, GoPay úspech/zlyhanie/zmena platby, idempotencie objednávok a vlastníctva údajov. Externé testy platobnej brány vykonávať iba v testovacom prostredí so syntetickými objednávkami. Žiadne skutočné zákaznícke transakcie.
4. **Porovnať s baseline na porovnateľnom prostredí.** V rovnakom profile a pri aspoň troch mobilných behoch porovnať LCP/INP/CLS/TTFB aj stabilitu HTTP/API a dobu reakcie košíka a pokladne. Ak je ktorákoľvek kritická cesta horšia nad prirodzenú variabilitu merania, chybná alebo nestabilná, označiť `REGRESSION_BLOCKED`. Zvýšenie veľkosti JS alebo nová synchrónna práca na hlavnom vlákne vyžaduje osobitný výkonový audit.
5. **Stop pri chybe.** Ak zlyhá akýkoľvek povinný test, build, bezpečnostný audit, GoPay/checkout alebo porovnanie výkonu, zmenu **nezlučovať, nenasadzovať ani neoznačovať za hotovú**. Opraviť v tej istej vetve a opakovať všetky dotknuté testy, až potom pokračovať. Príčinu a fix zdokumentovať.
6. **Trvalá evidencia.** Každá úloha musí mať vlastný záznam v `docs/change-journal/` s ID, dátumom, base SHA, vetvou, dotknutými súbormi, dôvodom, výsledkami pred/po, testami, rizikami, URL PR, commitom, stavom nasadenia a návratom späť. Nová úloha začína kontrolou posledných záznamov, nie od nuly. V PR priložiť odkaz na záznam.
7. **Nasadenie len po kontrole.** Vyžadovať zelené kontroly PR, úspešné meranie porovnateľného stagingu, manuálne schválenie rizikových úprav a po nasadení krátky read-only smoke check. Ak zlyhá produkčný smoke check, spustiť pripravený rollback; nerobiť ad hoc zásahy do objednávok.

## Kritické časti, ktoré nesmú regresovať

- Vytvorenie objednávky presne raz; TM/Woo identifikácia objednávok, opakovaný pokus a výmena platby.
- GoPay redirect, webhook, návrat po platbe, predchádzanie dvojitému vytvoreniu objednávky a storno/nezaplatené stavy.
- Košík: pridanie produktu z výpisu bez presmerovania, množstvá, výpočet 2–3 ks −10 % a 4+ ks −25 % pre kompatibilné, vernostné pravidlá, doprava zdarma od 29 €, kupóny bez blokovania nákupu.
- DPD Pickup/Box mapy, výber dopravy, fakturačné údaje, bezpečnosť prihlásených/hosťovských nákupov.
- Mobilná sticky lišta, okamžitá odozva bez skákania, načítanie účtu a panel cien.
- SEO: canonical, redirecty, indexácia, sitemap, Merchant feed; žiadne spomalenie LCP kvôli analytike alebo novému JS.
- Bezpečnosť: CSP, autentifikácia, CSRF, hlavičky, ochrana tajomstiev a údajov zákazníkov.

## Praktické spúšťanie a obmedzenia

- Existujúce skripty v `package.json`: `npm run check`, `npm test`, `npm run build`, `npm run test:security`, `npm run test:performance`, `npm run test:production`, `npm run test:dpd`, `npm run test:storefront`, `npm run test:storefront:load`, `npm run release:verify:info`.
- GitHub CI dokáže automaticky preveriť testy a build; **samotné zelené unit testy nie sú dôkazom nezhoršeného reálneho mobilného výkonu**. Výkon vyžaduje baseline + rovnaké Lighthouse prostredie/staging. Ak také prostredie ešte nie je nastavené, výsledok musí byť výslovne `PERFORMANCE_NOT_VERIFIED` a PR nesmie byť považovaný za pripravený na produkčné nasadenie.
- GitHub vetva/PR/CI samy o sebe nezaručujú blokovanie priameho pushu do `main`. Zapnúť branch protection/ruleset: required status checks a PR review, zákaz obchádzania pre správcu a povinný review pre produkciu.
- Žiadne tajné API kľúče, tokeny, kompletné objednávky ani osobné údaje v záznamoch/PR.
- **Platí aj pre zdanlivo malé zmeny textov, SEO a Google tagov**. Ak sa niečo netestovalo, musí byť napísané `NEOVERENÉ`, nie `OK`.

## Šablóna denníka

Vytvoriť `docs/change-journal/YYYY-MM-DD-kratky-nazov.md`:
```
# Úloha:
Stav: BASELINE_BLOCKED | IN_PROGRESS | REGRESSION_BLOCKED | READY_FOR_REVIEW | DEPLOYED
Baseline: main SHA, URL, mobilná metodika, dostupnosť meraní
Rozsah:
Dotknuté súbory:
Testy pred zmenou:
Testy po zmene:
Výkon pred / po / rozdiel:
Bezpečnosť a nákupný flow:
Známe riziká / blokátory:
PR / commit / nasadenie:
Rollback:
```
