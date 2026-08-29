TONERYMAXIM.SK – KALENDÁRE 2027 – OPRAVENÉ NASADENIE
=====================================================

+STABILNÁ VERZIA V4 – 29. 8. 2026
--------------------------------

- Pole source=kalendare-2027 zostáva zachované v košíku, pokladni aj serverovej objednávke.
- Kalendár sa nikdy nehľadá v katalógu tonerov ani nepreberie sklad cudzieho produktu.
- Toner bez kalendára nevolá kalendárovú službu a jeho pôvodný proces zostáva nezmenený.
- Pri súbehu objednávok sa externý katalóg načíta iba jednou spoločnou požiadavkou.
- Záložný katalóg obsahuje čerstvo overený stav všetkých 62 produktov.
- Neúplná, príliš veľká alebo neoverená odpoveď kalendárovej služby sa odmietne a použije
  sa posledná bezpečná kópia.
- V4 navyše odstráni z už skôr uloženej položky kalendára cudzie tonerové atribúty
  (farbu, kapacitu a cudzí počet skladu) v košíku aj pokladni.

FINÁLNA OCHRANA DOSTUPNOSTI
---------------------------

- Hlavná pokladňa už neakceptuje kalendár iba podľa údajov z prehliadača.
- Okrem SKU, názvu a ceny server kontroluje aktuálnu hodnotu availability.inStock.
- Vypredaný alebo ešte neoverený kalendár pokladňa odmietne; tonerov sa táto kontrola netýka.
- Hlavný sitemap index obsahuje /kalendare/sitemap.xml.
- Samostatný Merchant feed kalendárov je na /kalendare/google.xml a nemení tonerový feed.

Balíky:
1. KALENDARE-2027-STABILNE-V4.zip
2. TONERYMAXIM-KALENDARE-BEZPECNY-PATCH-V4-OPRAVENY.zip

DÔLEŽITÉ PORADIE NASADENIA
--------------------------

1. Najskôr nasaďte samostatný projekt kalendárov.
2. V Coolify/Traefik nastavte cestu /kalendare/ na aplikáciu kalendárov.
3. Overte https://www.tonerymaxim.sk/kalendare/api/health a /kalendare/api/products.
4. Až potom nahraďte súbory hlavného projektu integračným balíkom a nasaďte ToneryMAXIM.

SAMOSTATNÁ APLIKÁCIA KALENDÁROV
-------------------------------

- Build Pack: Dockerfile
- Port: 3000
- Healthcheck: /kalendare/api/health
- Environment:
  PUBLIC_URL=https://www.tonerymaxim.sk/kalendare
- Netreba samostatný DNS záznam. Potrebné je smerovanie cesty /kalendare/.
- Aplikácia kalendárov nevytvára objednávky, neobsluhuje GoPay a neukladá zákaznícke údaje.
- Objednávku, dopravu, platbu, e-mail a WooCommerce obsluhuje iba hlavná pokladňa ToneryMAXIM.

HLAVNÝ PROJEKT TONERYMAXIM
--------------------------

1. Pred výmenou si odložte aktuálnu funkčnú verziu.
2. Obsah integračného ZIP-u skopírujte do koreňa aktuálneho projektu ToneryMAXIM.
3. Povoľte zlúčenie priečinkov a nahradenie rovnomenných súborov.
4. Do Environment Variables hlavnej aplikácie pridajte:
   TM_CALENDAR_CATALOG_URL=https://www.tonerymaxim.sk/kalendare/api/products
5. Redeploy hlavnej aplikácie.

BEZPEČNOSTNÉ A FUNKČNÉ POISTKY
------------------------------

- Cena a názov kalendára z prehliadača sa nepovažujú za dôveryhodné.
- Server overí SKU, názov a cenu v kalendárovom katalógu.
- Pri dočasnom výpadku kalendárovej aplikácie je v hlavnom projekte pribalená posledná overená kópia katalógu.
- Tonerová objednávka kalendárovú službu vôbec nevolá.
- Kalendár sa uloží vo WooCommerce ako samostatný manuálny riadok so SKU a zdrojom kalendare-2027.
- Zľavy kalendára: 1–2 ks 0 %, 3–20 ks 5 %, 21+ ks 15 %.
- Tonerové zľavy 2–3 ks 10 % a 4+ ks 25 % zostávajú nezmenené.
- Používa sa iba jeden košík tm_cart_v1. Odstránený kalendár sa po návrate na stránku neobnoví.
- Samostatné objednávkové, GoPay a admin API pôvodného kalendárového balíka boli odstránené.
- Opravené bolo vloženie textu z URL fragmentu a doplnené bezpečnostné HTTP hlavičky.

KONTROLA PO NASADENÍ
--------------------

1. Otvorte /kalendare/ na PC aj mobile.
2. Pridajte 1 kalendár a skontrolujte spoločný /kosik.
3. Kalendár odstráňte, vráťte sa na /kalendare/ a overte, že sa neobnovil.
4. Vložte toner + kalendár a overte, že obe položky zostali v košíku.
5. Overte 3 ks (5 %) a 21 ks (15 %).
6. Skontrolujte bankový prevod, dobierku a GoPay v hlavnej pokladni.
7. Skontrolujte WooCommerce riadky, DPH 23 %, e-mail zákazníkovi a dopravu zdarma od 29 €.
8. Po nasadení spustite npm run check, npm run test:production a npm run build.

OVERENIA PRED ODOVZDANÍM
------------------------

- ZIP integrita: OK
- Katalóg: 62 produktov, bez duplicitných SKU a slugov
- JavaScript syntax: OK
- Astro typecheck: 0 chýb
- Produkčný Astro build po zlúčení s aktuálnym GitHub projektom: OK
- Produkčné a kalendárové regresné testy: 25/25 PASS
- Ďalšie testy vyhľadávania, Woo, SEO, migrácie a bezpečnosti: 60/60 PASS
- Hlavné stránky (košík, pokladňa, prihlásenie, registrácia, obnova hesla): HTTP 200
- Záťaž hlavnej aplikácie: 525 požiadaviek, 15 súbežne, 525× HTTP 200,
  bez HTTP 500/502
- Záťaž kalendárovej aplikácie: 450 požiadaviek, 15 súbežne, 450× HTTP 200,
  bez HTTP 500/502
- Reálna synchronizácia PRESS GROUP: 62/62 SKU
- npm audit produkčných závislostí: 0 zraniteľností

POZNÁMKA K REÁLNYM TESTOVACÍM OBJEDNÁVKAM
-----------------------------------------

Nevznikol žiadny nový účet ani nová testovacia objednávka. Reálnu skúšku objednávky s kalendárom
treba vykonať po nasadení integračného balíka V4. Živý web bol počas kontroly ešte na staršej
integrácii, ktorá mohla pri kalendári zobraziť tonerové atribúty; V4 tento stav čistí.
