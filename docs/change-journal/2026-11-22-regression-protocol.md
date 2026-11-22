# Úloha: Zavedenie povinného vývojového protokolu a regresnej kontroly

Stav: READY_FOR_REVIEW (NEOVERENÉ: staging/Lighthouse a beh CI)
Dátum: 2026-11-22

Baseline: main pred vytvorením vetvy; východiskový commit vetvy bol aktuálny main. Konkrétne mobilné Lighthouse a staging testy pred zmenou neboli z tohto prostredia dostupné, stav PERFORMANCE_NOT_VERIFIED.

Rozsah: Záväzný vývojový protokol pre všetky budúce úpravy; PR CI kontrola typu, testov, buildu, auditu závislostí a denníka.

Dotknuté súbory:
- AGENTS.md (nový)
- .github/workflows/safety-regression-guard.yml (nový)
- docs/change-journal/2026-11-22-regression-protocol.md (tento súbor)

Testy pred zmenou: Overená existencia príkazov v package.json. Reálny npm test/build ani browser e2e nebol spustený; nástroj GitHub konektora poskytuje čítanie/zápis súborov, nie spustenie CI.
Testy po zmene: Čakajú na GitHub Actions PR. Pred zlúčením skontrolovať všetky povinné joby a relevantné testovacie prostredie.
Výkon pred / po / rozdiel: PERFORMANCE_NOT_VERIFIED. Žiadny runtime Astro/JS súbor sa nemení; nevytvára sa priamy dôvod na zmenu LCP, ale skutočný výkon musí byť preukázaný oddeleným testom.
Bezpečnosť a nákupný flow: Žiadne zásahy do obchodu, košíka, platby GoPay, WordPress, databázy a konfigurácie produkcie. Nová CI kontrola sa spúšťa iba na PR/workflow_dispatch.
Známe riziká / blokátory: Pravidlo v AGENTS.md platí len ak ho budúci editor/agent dodrží. CI joby treba úspešne spustiť; branch protection/ruleset a povinné approval + staging/Lighthouse gate ešte nie sú nakonfigurované. CI sama o sebe neporovná reálnu mobilnú rýchlosť. Potenciálny build/test môže v GitHub Actions vyžadovať prostredie alebo ďalšie úpravy; bez zelených kontrol nezlučovať.
PR / commit / nasadenie: Zmeny iba v bezpečnostnej vetve; PR vytvorený samostatne, bez merge a bez produkčného deploy.
Rollback: Zrušiť PR alebo revertovať tri nové dokumentačné/CI súbory; žiadny runtime rollback sa nevyžaduje.
