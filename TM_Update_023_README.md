# TM_Update_023_checkout_gopay_email_speed_hotfix

Opravy:

1. Dobierka / prevod
- Async Woo worker sa spúšťa s krátkym oneskorením, aby sa odpoveď zákazníkovi odoslala okamžite a Woo nevzal čas prvému presmerovaniu.
- Predvolená hodnota je 2500 ms.
- Dá sa zmeniť cez env: TM_ASYNC_WOO_INITIAL_DELAY_MS.

2. Woo e-maily / billing email
- E-mail zákazníka sa posiela už priamo v prvom Woo POST /orders.
- Odstránené bolo zbytočné druhé Woo PUT volanie len kvôli billing emailu.
- Woo aj vlastný ToneryMaxim e-mail majú k dispozícii e-mail pri vytvorení objednávky.

3. GoPay
- Súbor /api/gopay-create.ts je priložený na výmenu, aby bola na serveri určite verzia s definovanou funkciou toCents().
- Tým sa odstraňuje chyba „toCents is not defined“ pri GoPay.

Build:
- npm run build prešiel úspešne.

Inštalácia:
- Nahrať tieto súbory do projektu podľa adresárovej štruktúry.
- Commit/push na GitHub.
- Redeploy v Coolify.
- Otestovať: 1× dobierka, 1× GoPay, 1× email potvrdenia.
