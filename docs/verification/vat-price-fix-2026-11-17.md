# Oprava cien a DPH – 17. 11. 2026

## Výsledné správanie

Košík, pokladňa, potvrdenie, textový aj HTML e-mail a nová Woo objednávka používajú rovnaké ceny s DPH a rovnaký súčet položkových daní. Cenníkové ceny produktov, import, sadzba dane a ceny dopravy/platby sa nemenia. Existujúce množstevné zľavy 2–3 ks −10 % a 4+ ks −25 % kompatibilného produktu zostávajú vrátane pôvodného poradia zaokrúhľovania. Kalendáre používajú svoj existujúci cenník.

Odstránená je klientská dodatočná zľava 5 % za štyri samostatné CMYK farby, ktorú server neposkytoval. Predpripravené sady a ich cenníkové ceny sa nemenia. Nová Woo objednávka už neobsahuje opravný poplatok „Zaokrúhlenie“: jej skutočné riadky majú presný dohodnutý súčet.

| Reprodukovaný prípad | Pôvodný problém | Opravený výsledok v skutočnom Woo REST |
| --- | --- | --- |
| Produkt 3,08 € + kuriér 3,90 € | Woo 6,97 € namiesto 6,98 € | 6,98 € |
| 30 rôznych riadkov po 1,20 € | Woo 35,93 € po zápornom opravnom poplatku | 36,00 €, DPH 6,60 €, bez opravného poplatku |
| Štyri samostatné CMYK po 10 € | Klient 38 €, server 40 € | Klient aj Woo 40 € |
| 2 × 15,69 €, zľava 10 %, kuriér 3,90 €, dobierka 1,20 € | Staré Woo prepočítalo dobierku na 1,21 € a pridalo −0,01 € | Nová objednávka 33,34 €, základ 27,11 €, DPH 6,23 € |

Historická objednávka 54549 zostáva 33,34 € / základ 27,10 € / DPH 6,24 € a účet číta jej uložené hodnoty. Nie je spätne prepočítaná na výsledok novej objednávky. Rovnako sa zachovávajú všetky sumy šiestich historických objednávok uvedených v pôvodnom audite.

## Ako sa zabraňuje druhému prepočtu

Astro najskôr overí autentifikovaný kontext Woo: ceny zadané s DPH, dane zapnuté, jedna SK 23 % nekompozitná sadzba aj na dopravu, EUR, dve desatinné miesta, zaokrúhľovanie po položkách. Čítanie sa zdieľa a ukladá najviac na 60 sekúnd; neúspech sa neukladá. Chýbajúci alebo nevyhovujúci kontext zastaví nový nákup pred založením objednávky alebo spustením GoPay. Pri každom nakupovanom produkte sa z Woo overí aj aktuálna cena a štandardná zdaniteľná trieda. Nepodporovaná trieda sa neprepočíta odhadom.

Nová autentifikovaná TM REST objednávka výslovne označí `tm_price_contract=gross-v1` a priloží existujúce metadáta dohodnutých hrubých riadkov. Modul `checkout-pricing.php` v plugine Customer Administration 6.4.0 overí celý súčet, pôvod, oprávnenie, menu, krajinu a produktové triedy pred použitím akéhokoľvek plánu. Potom uchová príslušný základ a daň každého riadka cez natívny Woo výpočet. Používa centové celé čísla a jediné konečné zaokrúhlenie. Rovnaký rozpis používa klient aj server; nevzniká ďalšie zaokrúhlenie na štyri desatinné miesta.

Astro navyše porovná skutočné `total` a `total_tax` z uloženej odpovede Woo s očakávaním ešte pred zákazníckymi benefitmi a potvrdením. Opakovanie požiadavky znova overí už existujúcu objednávku a nezaloží druhú.

Neskoršia zmena platby potrebuje opätovný výslovný marker a už označenú uloženú objednávku. Bežné ručné úpravy administrátora, neoznačené objednávky aj historické objednávky si zachovajú pôvodný Woo režim. Otestovaný je aj GoPay → dobierka → oneskorený PAID callback → opakovaný callback, stále nad jedinou objednávkou a so správnym odstránením dobierkového poplatku.

## Overenie

- `npm run check`: 0 chýb, 0 varovaní, 25 existujúcich upozornení typu hint.
- `npm run build`: úspešný; vstavaný release guard 308 úspešných, 0 zlyhaní a 9 integračných prípadov preskočených bez PHP/Woo fixture. Tie sú zahrnuté v plnom behu nižšie.
- Plná cielená sada: **17/17, 0 preskočených**, lokálne PHP 8.4.24, skutočný WordPress 7.1.4 a WooCommerce 11.2.1 cez REST a databázu SQLite v samostatnom dočasnom prostredí. Nejde iba o napodobeninu daňovej funkcie.
- 180 000 porovnaní pôvodných pravidiel položkových cien a zliav; 100 001 kontrol zachovania centov; PHP a prehliadač sa zhodujú pri 200 001 kladných a záporných centových sumách.
- 53 natívnych košíkov: kompatibilné/originálne/renovované, množstvá 1/2/3/4/21/99, kalendáre, sady, kupón, vernostná zľava, registrovaný/hosť, dobierka, kuriér, výdajné miesto a hranica dopravy zdarma.
- Odmietnutie nesprávneho pôvodu, meny/krajiny, daňových nastavení, celku a produktovej triedy bez vytvorenia objednávky; anonym a zákazník nemajú prístup ku kontextu.
- DPD: **36/36**; objednávkové e-maily: **12/12**; PHP faktúry **56**, štatistiky **1 338**, reklamácie **52**, stavy a e-mailové šablóny **6** – bez zlyhaní.
- CI pridáva samostatný plný natívny test na **PHP 8.5.12**, zhodnom s produkciou. Požadovaná verzia sa overuje priamo v teste; nesprávna verzia test nesplní.

Reprodukcia čistého prostredia: `npm ci && npm run test:vat` (PHP s pdo_sqlite, mbstring, XML/dom; curl a unzip). Skript sťahuje pevné verzie z oficiálnych zdrojov, zapne lokálnu doménu `.invalid`, zablokuje externé HTTP aj všetku poštu a odmietne neoznačený alebo nelokálny WordPress. V živom obchode sa nevytvárajú skúšobné objednávky, platby ani e-maily.

## Nasadenie a návrat

1. Najskôr aktualizovať existujúci aktívny plugin `tonerymaxim-customer-administration-v2` na 6.4.0. ZIP musí mať rovnaký koreňový priečinok, aby išlo o náhradu, nie druhý plugin. Pôvodné štyri živé PHP súbory boli porovnané s `origin/main` a zhodovali sa; návratový ZIP obsahuje presne túto verziu 6.3.0.
2. Po úspešných CI kontrolách zlúčiť zmenu Astro a redeploynúť Coolify. Nový backend je kompatibilný so starým frontendom, lebo staré požiadavky nemajú marker. Nový frontend vyžaduje nový backend a pri jeho nedostupnosti zlyhá bezpečne pred spustením nového nákupu.
3. Pri návrate najskôr vrátiť Astro, potom podľa potreby plugin. Žiadna migrácia databázy ani hromadná zmena produktov, objednávok alebo daňových nastavení nie je súčasťou aktualizácie. Súkromný archív faktúr zostáva mimo priečinka pluginu.

Živé daňové nastavenia a vzorka troch cien boli overené v pôvodnom audite. Celý katalóg nie je právne ani účtovne certifikovaný; neúplný export sa za úplnú kontrolu nevydáva. Nová kontrola daňovej triedy sa uplatní pri každom nákupe. Ručne nahrávané faktúry z Oberonu sa nemenia ani negenerujú nanovo.

Právny podklad pre kontrolu základnej sadzby a konečného centového zaokrúhlenia: [Finančná správa – DPH v roku 2026, § 26 a § 27](https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Zverejnovanie_dok/Sprievodca/Sprievodca_danami/2026/2026.01.13_DPH_2026.pdf). Technický podklad: [WooCommerce – nastavenie daní](https://woocommerce.com/document/setting-up-taxes-in-woocommerce/) a originálne zdroje Woo 11.2.1. Overenie softvéru nenahrádza účtovné posúdenie každej faktúry.
