# Overenie pred redeployom – 14. 10. 2026

Opravený kandidát prešiel funkčnými a záťažovými kontrolami. Porovnávací základ je commit d496687; tento kandidát nadväzuje na d80e835. Nový commit a tento report sa publikujú až po dokončení kontrol.

## Čo dodatočný test odhalil a čo sa opravilo

- Pri výmene generácie katalógu sa starý NDJSON súbor detailov zmazal počas čítania. Pred opravou test zachytil 2 neúplné detaily zo 17 156 požiadaviek. Oprava sprístupní novú generáciu pred zmazaním starého súboru a po ENOENT zopakuje celý výber vrátane ceny, offsetu a metadát. Skutočne chýbajúci súbor si zachová pôvodné zotavenie. Dva deterministické testy zlyhávajú na pôvodnom kóde a prechádzajú po oprave, vrátane synchronizácie z druhého procesu a vyradenia produktu.
- Číselný model Xerox 700 už v ponuke náplní nemieša valce s tonermi. Samostatné OEM/SKU valcov zostali dostupné. Epson 102 stále vyberá správnu atramentovú rodinu.
- Titulok sady Canon PG-545 XL čierna + CL-546 XL farebná zachová oba kódy.
- Obnova našeptávača uvoľňuje I/O podľa približne 8 ms úsekov CPU. Značky sa normalizujú raz a už kompaktné prefixové tokeny sa nenormalizujú druhýkrát. Produkty, prefixy, triedenie a pravidlá ponuky sa neorezávajú.

## Overenie

| Kontrola | Výsledok |
| --- | --- |
| Celá regresná sada vrátane AI, objednávok, dopravy, bezpečnosti, SEO a pamäte | 1120/1120; 0 zlyhaní, 0 vynechaní |
| Ovplyvnené vyhľadávacie a pamäťové testy po poslednej optimalizácii | 55/55 |
| OEM vyhľadávanie | 300/300; 1 111 kontrol |
| Samostatný produkčný build – SSR a API | 20 kontrol |
| Nákup cez skutočné HTTP handlery s lokálnym Woo/GoPay transportom | 27 scenárov |
| Veľký súbežný test | 9047 požiadaviek; 0 funkčných chýb |
| Úplné detailové záznamy na disku | 7734; rovnaký SHA-256 pred/po |
| Astro check / build | 0 chýb, 0 warnings, 25 existujúcich hints / úspech |

Po celom behu bol skontrolovaný obsah všetkých 7 734 detailov: celý dlhý HTML opis a všetkých osem neprázdnych technických hodnôt. Prázdne vstupné atribúty kapacity/tlačiarní sa podľa pôvodných pravidiel normalizácie nezobrazujú. Ich vynechanie sa nepovažuje za stratu dát.

## Pamäť a odpovede pri importe

Obe verzie používajú rovnaký verejný katalóg, päť úspešných importov, dva zlyhané importy, rovnaké husté opisy a osem súbežných pracovníkov. Pracovníci predstavujú osem lokálnych návštevníkov s oddelenými testovacími IP a aspoň 100 ms pauzou; nerobia dopyty na živý web. Jeden mock import uloží približne 490 MB úplných detailov. Ochrana 30 AI požiadaviek za 10 minút a 600 vyhľadávacích požiadaviek za minútu na návštevníka zostala zapnutá. GC sa nevynucuje. Uvedené MB používajú 1 048 576 bajtov.

| Meranie | d496687 | Opravený kandidát |
| --- | ---: | ---: |
| Špička RSS procesu | 941 MB | 673 MB |
| RSS na konci | 924 MB | 661 MB |
| Homepage p95 | 368.7 ms | 325.2 ms |
| Našeptávač p95 | 435.2 ms | 410.9 ms |
| Našeptávač maximum | 7146.3 ms | 4121.5 ms |
| Prvý dopyt našeptávača po štarte | 1286 ms | 2223 ms |
| Chybné alebo neúplné odpovede | 953 | 0 |

Pokles špičky RSS je 28.5 %. Časy sú lokálne HTTP odpovede v testovacom prostredí, vrátane čakania na index; nemerajú mobilný LCP ani verejnú sieť. Maximum a studený dopyt sú uvedené samostatne, takže dobré p95 nezakrýva ojedinelé pomalšie odpovede.

Chyby základu predstavujú 940 opakovaných kontrol viditeľného formulára prázdnej pokladne a 13 prázdnych AI ponúk pri otázke na HP CF230X; počet nepredstavuje toľko rôznych defektov. Tento porovnávací beh stratu detailu nezachytil; tá je doložená skorším záťažovým behom a deterministickými testmi uvedenými vyššie. Opravená verzia má 0 chýb. Dobrý p95 zároveň nie je zárukou každej odpovede pod 2 sekundami: maximum obnovy našeptávača ostáva vyššie.

| Úspešný import | RSS po importe (MB) | Heap (MB) | Trvanie |
| --- | ---: | ---: | ---: |
| 1 | 521 | 302 | 39 s |
| 2 | 583 | 292 | 47 s |
| 3 | 650 | 360 | 34 s |
| 4 | 645 | 282 | 43 s |
| 5 | 661 | 322 | 42 s |

Súčasné dve požiadavky na sync spustili iba jednu pagináciu. Dočasná odpoveď Woo 429 sa opakovala úspešne. Predčasne ukončený katalóg a Woo 401 zachovali identický JSON aj úplný detailový súbor starej generácie. Nezostali dočasné súbory ani hromadiace sa staré generácie. Overili sa limity cache a dostupnosť healthchecku.

## Pokladňa a platby

Testy pokrývajú prázdny košík, chýbajúci súhlas/odberné miesto, neznámy a vyradený produkt, prepočet podľa aktuálnej Woo ceny, dopravu pod/nad 29 €, dobierku, prevod a GoPay. Tri sady po množstevnej zľave majú 203,04 € za tovar; s dobierkou 204,24 €. Štyri sady majú 225,60 €. Prechod tej istej zrušenej GoPay platby na dobierku má 226,80 € a zachová pôvodné číslo objednávky.

Opakované odoslanie nevytvorí druhú objednávku ani GoPay platbu. Zmenený košík s rovnakým requestId sa odmietne. Nedokončená platba sa opätovne použije; zrušená platba sa môže zopakovať alebo prejsť na dobierku. Uhradená platba sa nedá opakovať ani zmeniť. Zmena vyžaduje prístupový token. Simulovaná chyba brány vrátila očakávané 502 bez duplicitnej tvorby. Všetko prebehlo v izolovanom dočasnom úložisku; reálne objednávky, platby a e-maily: 0.

SSR má formulár aj mobilné ovládacie prvky prázdnej pokladne skryté. Test skutočnej funkcie vykreslenia preveril prázdny → naplnený → prázdny košík a CSS rešpektovanie hidden.

## Praktické hranice výsledku

Použitý verejný snapshot má 7 734 produktov; aktuálna produkčná diagnostika hlási 7 932. Opisy a technické atribúty pri veľkom importe sú kontrolované syntetické dáta. Nákupné transporty sú mocky. Novú verziu pred redeployom nemožno vizuálne overiť na produkčnej doméne; úplná vizuálna kontrola, reálne prostredie GoPay a prvý ranný import patria po nasadení.

Test nie je dôkazom neprítomnosti leaku po týždňoch prevádzky ani zárukou RSS pod 512 MB. Extrémny test túto hodnotu prekračuje. Cgroup zahŕňa zdieľaný testovací kontajner; porovnanie používa RSS samotného Node procesu. Skutočný limit kontajnera musí byť nastavený v Coolify. Placeholder fotografie dodávateľa sa týmto testom nenahrádzajú.

Živý web pri kontrole pred publikovaním vracal health aj storefront-check 200, RSS 391 MB a heap 167 MB. Nové diagnostické polia ešte neobsahoval; tento údaj je kontrola starej nasadenej verzie, nie meranie opraveného kandidáta.

## Reprodukcia

V izolovanom checkout-e s nainštalovanými závislosťami a lokálnym snapshotom products.json:

```sh
npm run check
npm run build
node scripts/verify-predeploy-regressions.mjs --catalog /tmp/products.json --output /tmp/tm-regressions
node scripts/verify-predeploy-purchase.mjs --catalog /tmp/products.json --output /tmp/tm-purchase.json
node scripts/verify-predeploy-load.mjs --catalog /tmp/products.json --output /tmp/tm-load.json --generations 5
```

Testy poskytujú iba lokálne Woo/GoPay mocky a do child procesu nepreberajú produkčné credentials. Runtime shim os.networkInterfaces je výhradne workaround izolovaného testovacieho prostredia; produkčný kód sa ním nemení. Skripty spúšťajú server a klienta v jednej relácii. Číselné výsledky a vzorky pamäte sú v predeploy-release-2026-10-14.json.

| Overený runtime súbor | SHA-256 |
| --- | --- |
| src/lib/ai-commerce/catalog.ts | a62d8f4178a2f73b1986b159c0f57991cd63739b919bba9a2c505b11b78d919d |
| src/lib/catalog-seo-text.ts | ddcb68cb3bd8d39c9ac4b576348e1c54c143b4a896c00eacb2e17480e03e84ba |
| src/lib/tm-products-cache.ts | 3502e850584f1886e74cf9673956435106bce8b5a11e67c56f8d2169e8a79f8b |
| src/pages/api/smart-search.ts | 64c2b4453b92c1a579756cf7596ddafe1a416611c338a85723280cfde86c3d74 |
