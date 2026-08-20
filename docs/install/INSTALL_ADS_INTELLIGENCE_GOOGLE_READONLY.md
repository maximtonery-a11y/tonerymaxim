# ToneryMAXIM Ads Intelligence – Google Ads read-only

## Inštalácia

1. Nahraďte súbory z balíka pri zachovaní adresárovej štruktúry.
2. Doplňte produkčné premenné podľa `.env.production.example`:
   `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`,
   `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN` a
   `GOOGLE_ADS_CUSTOMER_ID`. Pri prístupe cez MCC doplňte aj
   `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
3. OAuth účet musí mať prístup ku Google Ads účtu a scope
   `https://www.googleapis.com/auth/adwords`.
4. Nasaďte aplikáciu a otvorte `/admin/ads-intelligence?key=ADMIN_KLUC`.
5. V Nastaveniach najprv aktualizujte ceny Abix a potom kliknite
   „Synchronizovať Google Ads“.

Konektor používa výhradne reportovací endpoint `googleAds:search`. Neobsahuje
žiadne volanie na vytváranie, úpravu alebo zastavenie kampaní. Import posledných
30 dní je idempotentný: opakovaná synchronizácia nevytvorí duplicitné udalosti.

Google konverzie sa zobrazujú v stave synchronizácie, ale objednávky a hrubý zisk
pre rozhodovací engine sa naďalej preberajú z e-shopu. Tým sa zabráni dvojitému
započítaniu objednávok a rozhodovaniu bez reálnej produktovej marže.
