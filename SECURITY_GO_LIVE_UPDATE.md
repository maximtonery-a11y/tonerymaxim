# Bezpečnostná oprava pred presunom na tonerymaxim.sk

## Čo bolo zapojené

- centrálne bezpečnostné hlavičky pre všetky odpovede,
- blokovanie produkčných testovacích API endpointov,
- rate limiting pre prihlásenie, registráciu, reset hesla, checkout, GoPay, kontakt a vyhľadávanie,
- kontrola pôvodu zapisujúcich API požiadaviek,
- limit veľkosti API požiadavky 1 MB,
- X-Request-Id pre jednoduchšie dohľadanie chýb,
- produkčné odmietnutie slabého alebo chýbajúceho AUTH_SECRET,
- odstránenie fallbacku na WooCommerce secret pre podpis zákazníckych relácií a resetu hesla.

## Povinné pred ostrým spustením

1. V Coolify nastavte `AUTH_SECRET` na náhodný reťazec s minimálne 32 znakmi.
2. Nastavte aj `ADMIN_API_SECRET`, `SYNC_SECRET` a `TM_PERSISTENCE_SECRET`.
3. `TM_ALLOW_TEST_ENDPOINTS` ponechajte na `0` alebo ho vôbec nenastavujte.
4. Použite persistentný volume a nastavte `TM_PERSISTENT_DATA_DIR`, napríklad `/app/data`.
5. Po nasadení otvorte `/admin/security` a skontrolujte, že všetky produkčné kontroly sú zelené.
6. Vykonajte test registrácie, prihlásenia, resetu hesla, objednávky a GoPay platby.

Ukážka premenných je v `.env.production.example`. Skutočné tajomstvá nikdy neukladajte do Git repozitára.
