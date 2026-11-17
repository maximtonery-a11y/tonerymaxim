# TM štatistiky, registrácia a faktúry – 6.3.0

## Pracovný postup

- **TM zákazníci → TM objednávky**: pri mene je zelené označenie registrovaného zákazníka s ID účtu alebo sivé označenie neregistrovaného hosťa. Filter registrácie sa kombinuje s vyhľadávaním a stavom objednávky. Tlačidlo Faktúry je iba pri objednávke s existujúcim účtom.
- **TM zákazníci → Faktúry**: predvolený výber obsahuje iba objednávky s účtom. Vyhľadaný hosť má zreteľné upozornenie, priamy odkaz nezobrazí upload a server odmietne aj ručne zostavený POST. Neexistujúci/deaktivovaný priradený účet nezíska prístup iba podľa zhodného e-mailu. Existujúce šifrované archívne súbory sa nemažú.
- **TM zákazníci → Štatistiky a grafy**: deň, mesiac alebo rok a dátum v danom období; karty ukazovateľov, porovnanie, prepínateľný graf obratu/objednávok, rozdelenie účtov a hostí, noví/opakovaní nakupujúci, čakajúce/stornované/vrátené objednávky, platobné metódy, SKU a export súhrnu CSV.

## Výskum a definície

Podklad: [WooCommerce Analytics](https://woocommerce.com/document/woocommerce-analytics/), [Shopify Analytics dashboard](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard/using-the-overview-dashboard), [Woo order queries](https://developer.woocommerce.com/docs/features/orders/wc-get-orders/).

Z oboch administrácií preberáme karty s porovnaním, výber obdobia, časový graf, segmenty zákazníkov a konkrétne upozornenia. Hlavný obrat je **suma objednávok s DPH a dopravou po finančných vratkách**, nie čistý predaj tovaru bez DPH ani stav bankového účtu. Priemerná objednávka používa sumu započítaných objednávok pred vratkami. Woo čistý predaj a Shopify môžu mať inú definíciu AOV; zvolené pomenovanie je preto uvedené priamo na karte.

Vratky majú vlastný dátum finančnej refundácie. Pri plne refundovaných objednávkach zostáva pôvodný predaj aj záporná vratka. Samotný stav vrátená nevytvorí fiktívnu finančnú refundáciu. Predvolene sa do obratu započítajú processing, completed, tm-paid, tm-processing a tm-shipped; refunded/tm-returned s reálnymi refundáciami zachovávajú predaj a vratku. Ostatné stavy sú v počtoch, ale mimo obratu, kým ich správca vedome nezaradí v nastaveniach. Nové vlastné e-mailové stavy vyvolajú upozornenie, keď nie sú zaradené.

Pri historickom nesúlade TM snapshotu a Woo sumy má prioritu uložená TM suma rovnako ako v existujúcom TM prehľade. DPH sa v takom prípade neodhaduje a celková DPH/obrat bez DPH majú označenie nedostupnosti. EUR sa nesčítavajú s inými menami.

Nový nakupujúci je človek s prvým započítaným nákupom v dostupnej histórii TM; nová registrácia je vznik TM účtu vrátane účtov bez nákupu. Normalizovaný fakturačný e-mail je v indexe iba HMAC kľúč pre štatistické spájanie nákupov hostí a účtov. Nikdy nemení priradenie objednávky ani oprávnenie k faktúre. Počet registrovaných/hosťovských objednávok zostáva založený na existujúcom priradenom Woo účte.

Čas je Europe/Bratislava vrátane letného času. Aktuálne obdobie sa porovná s rovnakou uplynutou časťou predchádzajúceho obdobia, najviac po jeho koniec. Graf nekreslí budúce dni ako nulový predaj. Historické údaje, ktoré neboli prenesené do Woo, nie sú súčasťou prehľadu.

Návštevnosť, konverzia, opustené košíky, CAC/ROAS a marža vyžadujú osobitné vstupy (meranie návštevnosti, reklamné náklady, nákupné ceny a reálne náklady dopravy/poplatkov). Bez nich sa tieto hodnoty nevymýšľajú. Panel vysvetľuje, ktoré údaje treba neskôr pripojiť.

## Prevádzka a bezpečnosť

Zdrojové objednávky sú iba čítané cez Woo CRUD. Nový index `tm_business_facts_v1`, jeho nastavenia a stav výpočtu sú oddelené od objednávok, platieb, dopravy, používateľov a faktúr. Nepoužívajú sa order-save alebo mail hooky. Obnova načítava 75 objednávok na požiadavku a pokračuje cez chránené AJAX volania alebo WP cron, ak sa stránka zavrie. Report číta index v dávkach 500 riadkov. Nie je obmedzený existujúcim výberom posledných 500 objednávok v pôvodnej administrácii.

Nová generácia sa publikuje až po dokončení histórie objednávok aj TM registrácií. Chyba ponechá predchádzajúci dokončený report. Súčinnosť AJAX/cron chráni databázový zámok a identifikátor známej generácie. Po úspechu sa čistia iba staré generácie odvodeného indexu. Obnova na otvorenom prehľade sa spustí pri údajoch starších než 15 minút; čas aktualizácie je viditeľný a tlačidlo umožňuje ručnú obnovu. Žiadne zákaznícke e-maily sa neodosielajú.

Predvolene je vylúčený existujúci testovací účet `info@automatizaciafirmy.sk` a objednávky označené `tm_test_order=1/yes/true`. Zoznam sa dá meniť v nastaveniach prehľadu. Všetky stránky/exporty/výpočty vyžadujú `manage_woocommerce`, zápisy a CSV aj nonce. Grafy nemajú cudzie CDN ani sledovanie návštevníkov.

Aktualizuje sa iba existujúci Woo plugin na 6.3.0 (štyri PHP súbory). Astro, GoPay, doprava, checkout a zákaznícke e-mailové šablóny sa nemenia. Návrat na 6.2.0 nevymaže faktúry ani zdrojové údaje; odvodený index možno neskôr znova zostaviť.

Produkčný priečinok po nasadení je `wp-content/plugins/tonerymaxim-customer-administration-v2/`. Bežný WordPress upgrade pôvodného priečinka zlyhal pri odstraňovaní; WordPress pôvodný vstup deaktivoval ako neexistujúci súbor. Pred aktiváciou novej verzie bol tento stav overený v zozname pluginov, aby nemohli súbežne bežať dve kópie tried. Nový ZIP obsahuje tie isté štyri overené zdrojové súbory, iba v novom priečinku. Pri ďalšom upgrade zachovať tento produkčný názov priečinka. Šifrovaný archív v uploads a databázový kľúč zostali zachované; existujúci testovací PDF bol po migrácii stiahnutý a jeho SHA-256 sa zhoduje s originálom.
