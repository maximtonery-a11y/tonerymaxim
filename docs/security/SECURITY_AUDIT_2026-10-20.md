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

## Produkčné závislosti

Audit pôvodného lockfile našiel 6 zraniteľných balíkov (5 high, 1 moderate).
Závislosti sú uzamknuté na opravené verzie z npm registry, bez zmeny verzie
Astro a Node adaptéra:

| Balík | Predtým | Opravená verzia |
| --- | --- | --- |
| devalue | 5.8.2 | 5.9.4 |
| http-cache-semantics | 4.2.0 | 4.3.0 |
| nodemailer | 10.0.2 | 10.1.7 |
| sharp | 0.35.4 | 0.35.5 |
| smol-toml | 1.7.1 | 1.9.1 |
| source-map-js | 1.2.1 | 1.2.2 |

Aktualizované sú aj platformové balíky sharp/libvips. Po vyriešení závislostí
prešiel build, regresie, 10 kôl HTTP skúšok a npm audit --omit=dev hlásil
0 zraniteľností. Finálna kontrola používa čisté npm ci z commitnutého lockfile;
CI pri bežnom builde závislosti automaticky neaktualizuje.
Test mail-security overuje 10 kôl vytvorenia slovenského textového/HTML e-mailu
v pamäti bez SMTP spojenia. Skutočné doručenie e-mailu tým nie je potvrdené.

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
V predchádzajúcom nastavení bola úloha Coolify „Task Woo Sync“ s curl volaním
localhostu bez tokenu. Aktuálny príkaz a ďalšie plánovače nie sú dostupné na
priamu kontrolu. Pred redeployom treba túto úlohu overiť a zmeniť na hlavičku;
rovnako všetky prípadné volania s ?token=. Používaný token sa nemení týmto commitom.

Príklad príkazu so SYNC_SECRET nastaveným bezpečne v prostredí:

curl --fail --silent --show-error --request POST \
  --header "x-sync-token: $SYNC_SECRET" \
  --header "Content-Type: application/json" --data "{}" \
  "https://www.tonerymaxim.sk/api/sync-products?force=1"

POST bez prehliadačového Origin používa Content-Type: application/json;
štandardná ochrana Astro checkOrigin ostáva zapnutá.
Pri migrácii existujúcej úlohy možno použiť GET s rovnakou hlavičkou, ktorý
funguje pred aj po oprave:

curl -fsS --max-time 600 --header "x-sync-token: $SYNC_SECRET" \
  "http://127.0.0.1:3000/api/sync-products?force=1"

Pred spustením overiť, že úloha číta nakonfigurovaný SYNC_SECRET aplikácie.
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
- GitHub Release checks vykoná Astro check, bezpečnostné testy, DPD, históriu
  cien, migrácie, produkčné a výkonnostné regresie, produkčný build s kritickými
  regresnými testami, HTTP smoke a npm audit --omit=dev.
- Výsledok CI treba kontrolovať na presnom commite. Tento dokument neoznačuje
  neuskutočnené testy alebo produkčné nasadenie za úspešné.

Plný npm test bol v prvom CI behu spustený. V časti Ads prešlo 83/85 testov;
2 testy vyžadovali lokálny produkčný katalóg .tm-cache/products.json a skončili
na chýbajúcich dátach/Woo credentials. Ďalšie časti tohto príkazu sa nespustili.
Nejde o úspešný beh celej sady. Tieto dátové testy sa týmto patchom nemenia.

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
