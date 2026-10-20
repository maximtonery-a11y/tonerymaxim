# Bezpečnostné opravy TONERYMAXIM – 20. 10. 2026

## Rozsah

Kontrola aktuálnych zdrojov hlavného repozitára, autentifikácie, IP identít,
ochrany formulárov, synchronizácie katalógu, administrácie a GoPay overovania.
Nejde o potvrdenie, že e-shop nebol napadnutý, ani o úplný penetračný test.

## Opravy

- Middleware a pomocná knižnica používajú jednu politiku limitov a jednu IP funkciu.
  Identita pochádza z adresy spojenia dodanej adaptérom. Pri známej internej proxy sa
  použije posledná IP, ktorú Traefik pripojil do X-Forwarded-For. Ľubovoľné predpony,
  CF-Connecting-IP a X-Real-IP sa na autentifikáciu IP nepoužívajú. IPv6 a mapované
  IPv4 sa normalizujú. Chýbajúca alebo chybná adresa neotvára dôveru v hlavičky.
- Limity pokrývajú aj kontakt, zákaznícku podporu, zmenu hesla, odhlásenie a
  synchronizáciu. Kódované a koncové lomky nemenia identitu obmedzenej API cesty.
- Synchronizácia vyžaduje silný SYNC_SECRET na všetkých hostiteľoch vrátane
  produkčného localhostu. Povoľuje x-sync-token, x-sync-secret alebo Bearer.
  Pri viacerých hlavičkách sa musia všetky zhodovať. Token v URL sa odmieta.
  Zachované je autentifikované GET; pridané je autentifikované POST.
- Produkčný názov localhost už neodomkne administráciu ani testovacie stránky.
- Návratová adresa po prihlásení sa obmedzuje na bezpečnú cestu v e-shope.
- Základné hlavičky sa pridávajú aj k odpovediam 403, 404, 413, 429 a 503.
  CSP obmedzuje base-uri, objekty a vkladanie do rámcov. Nezavádza blokovanie
  používaných skriptov, obrázkov, dopravy ani platobnej brány.
- Adaptér obmedzuje skutočné čítanie tela požiadavky na 1 MB, aj keď chýba
  Content-Length. Pôvodná rýchla kontrola Content-Length zostáva zachovaná.
- Bezpečnostný prehľad už neprezentuje aktívny limit v pamäti middleware ako
  persistentný. Limity platia pre jeden proces a po reštarte sa začínajú odznova.

## Proxy v Coolify

Bez explicitného TM_TRUSTED_PROXY_CIDRS sú akceptované loopback a súkromné
IPv4/IPv6 siete používané kontajnermi. Tento kompatibilný predvolený režim
predpokladá izolovanú sieť Coolify. Zúžte premennú na skutočnú sieť alebo adresu
Traefiku; príklad, nie overená hodnota produkcie:

TM_TRUSTED_PROXY_CIDRS=172.18.0.0/16,127.0.0.0/8,::1/128

Prázdna explicitne nastavená hodnota zakáže dôveru proxy hlavičkám. Chybná
konfigurácia dôveru vypne. Verejní klienti pripojení priamo sa identifikujú
adresou spojenia, nie hlavičkami.

Port aplikácie nesmie byť verejne dostupný mimo proxy. Traefik musí pripájať
skutočnú adresu klienta na koniec X-Forwarded-For. Vstupné hlavičky od internetu
nemajú byť všeobecne dôveryhodné (forwardedHeaders.insecure nemá byť zapnuté).
Ak sa pridá ďalšia proxy, CDN alebo Astro security.allowedDomains, overte
znovu adresu spojenia a celý reťazec. Kód nie je dôkazom správneho firewallu.

## Migrácia synchronizácie pred nasadením

V kontrolovaných zdrojoch nebolo produkčné HTTP volanie s tokenom v URL.
Nočný worker a interné obnovovanie volajú syncProductsCache priamo.
Externý cron, príkazy Coolify a hostingové plánovače nie sú dostupné na kontrolu.
Pred redeployom overte, či niektorý z nich používa ?token=; taký proces treba
najprv zmeniť na hlavičku. Používaný token sa nemení týmto commitom.

Príklad príkazu so SYNC_SECRET nastaveným bezpečne v prostredí:

curl --fail --silent --show-error --request POST \
  --header "x-sync-token: $SYNC_SECRET" \
  "https://www.tonerymaxim.sk/api/sync-products?force=1"

Token nevkladajte do zdrojov, dokumentácie, snímok obrazovky ani výstupov testov.
Ak sa už používal v URL, preveriť záznamy a podľa potreby vymeniť iba SYNC_SECRET.
AUTH_SECRET ani TM_PERSISTENCE_SECRET neotáčať bez plánovanej migrácie.

## Overenie

- scripts/security-hardening.test.ts vykonáva 10 kôl nezávislých bezpečnostných
  a kompatibilitných scenárov s náhodnými testovacími tokenmi.
- scripts/security-http-smoke.mjs po builde spustí skutočný produkčný Node
  server s dočasnými dátami a vlastným loopback Woo fixture serverom.
  Overuje 10 kôl IP podvrhov a prihlasovacích limitov, odmietnutie URL tokenov
  a lokálnych výnimiek, funkčné GET/POST s hlavičkou, súkromie objednávok,
  bezpečné odmietnutie prázdnej pokladne a dostupnosť hlavných stránok.
  HTTP fixture neodosiela skutočné objednávky, platby ani e-maily.
- GitHub Release checks vykoná Astro check, celú testovaciu sadu, produkčný
  build s predbežnými regresnými testami, HTTP smoke a npm audit --omit=dev.
- Výsledok CI treba kontrolovať na presnom commite. Tento dokument neoznačuje
  neuskutočnené testy alebo produkčné nasadenie za úspešné.

## Zostáva mimo dostupného overenia

Reálna konfigurácia a aktualizácie WordPress/WooCommerce, administrátorské účty,
2FA, Coolify, SSH, firewall, dostupnosť portov, zálohy a skúška obnovy.
Kontrola pracovnej verzie nie je sken všetkých tajomstiev v celej histórii Gitu.
Aktuálne produkčné tajomstvá a externé plánované procesy nie sú súčasťou zdrojov.
Reálnu úhradu GoPay, doručenie e-mailu a vizuálne fungovanie DPD/GLS widgetov
nepotvrdzuje HTTP test s prázdnym košíkom.

## Primárne podklady

- https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/
- https://docs.astro.build/en/guides/integrations-guide/node/
- https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
