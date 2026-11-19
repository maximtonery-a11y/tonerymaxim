# Mobilné menu účtu a strážca náplní — 19. 11. 2026

Kontrolovaný pôvodný stav: commit `96fc65651348444f6e53944bd504153326d45707`.

## Zistenia pôvodného stavu

- Strážca bol pripomienkou podľa zadaného dátumu vloženia a odhadovanej výdrže, nie snímaním skutočného množstva tonera.
- Denný Node worker posielal jedno upozornenie zákazníkovi a jedno administrátorovi približne 21 dní pred termínom. Povoľoval odoslanie aj sedem dní po termíne. Ďalšie týždenné upozornenia neboli implementované.
- Automatické ukončenie plánu a história predchádzajúcich cyklov chýbali.
- Vypnutie bolo možné až v rozbalenom nastavení prepínačom a uložením formulára. Priama akcia na karte chýbala.
- Dynamicky pridaná karta nemala rovnakú triedu ako karta po obnovení stránky, takže mohla zobrazovať odlišné zvýraznenie aktívneho strážcu.
- Účet mal 11 rovnocenných položiek. Mobilné menu bolo skryté a nákupné funkcie aj nastavenia boli zmiešané.

## Výsledné správanie strážcu

Prvé upozornenie sa plánuje jeden kalendárny mesiac pred termínom; ďalšie každých sedem dní do termínu vrátane. Konce mesiacov sa prispôsobujú poslednému platnému dňu. Pri termíne 20. 12. 2026 sú plánované dni 20. 11., 27. 11., 4. 12., 11. 12. a 18. 12.

Kontrola na pozadí zostáva denná. Pri neskorom zapnutí alebo výpadku sa odošle jedna aktuálna pripomienka; zmeškané sa neposielajú naraz. Medzi úspešnými odoslaniami jednému príjemcovi zostáva aspoň sedem kalendárnych dní. Úspech zákazníckeho a administrátorského odoslania sa eviduje samostatne.

Po skončení termínu v časovom pásme Europe/Bratislava sa plán prestane považovať za aktívny a ďalšie upozornenia sa neposielajú. Stránka aj čítacie API zobrazia ukončený plán okamžite; denný worker uloží ukončenie do Woo. Tlačiareň aj história zostávajú uložené. Ručné vypnutie je samostatná akcia. Zmena cyklu uchová predchádzajúci plán v histórii.

Existujúce plány si zachovajú uložený termín. Staré značky úspešného odoslania sa zohľadnia, aby migrácia hneď nezopakovala rovnakú pripomienku. Nové záznamy uchovávajú jednotlivé odoslania.

Návod, FAQ, popisy formulárov aj e-maily používajú rovnaké pravidlá. Administrátorská správa neoznačuje nepotvrdené odoslanie zákazníkovi za úspešné doručenie.

## Menu a zachovanie údajov

| Mobilná položka | Dostupné pôvodné časti |
| --- | --- |
| Prehľad | `/ucet` |
| Objednávky | `/ucet/objednavky` |
| Tlačiarne | `/ucet/tlaciarne` |
| Výhody | `/ucet/vernost`, `/ucet/odmeny` |
| Viac | Faktúry, Moje produkty, Reklamácie, Adresy, Newsletter, Profil, odhlásenie |

Všetkých 11 existujúcich adries stránok zostáva zachovaných. Menu nepoužíva zápisy do Woo ani do úložiska zákazníka. Body, odmeny a ostatné záznamy sa nemigrujú ani nezlučujú. Zoskupuje sa iba navigácia. Na počítači zostáva bočné menu.

Mobilná lišta má päť tlačidiel a spodné odsadenie pre systémovú bezpečnú oblasť. Rozbaľovacie menu používa natívny dialog s riadením fokusu, zatvorením klávesom Escape, tlačidlom aj kliknutím mimo obsahu. Po zatvorení sa obnoví pôvodné posúvanie stránky. AI tlačidlo sa posunulo nad navigáciu. Newsletter v päte je v účte na mobile skrytý, nastavenie odberu zostáva dostupné cez Viac.

Uložené tlačiarne sú na mobile pred predošlými nákupmi. Odstránenie tlačiarne je v samostatných možnostiach s potvrdením; vypnutie strážcu tlačiareň nemaže. Normalizácia uložených tlačiarní zachováva aj dodatočné polia z existujúcich záznamov.

## Podklady pre rozloženie

Porovnanie vychádza z verejnej oficiálnej dokumentácie, nie zo súkromných účtov týchto obchodov. Navrhnuté rozloženie pre ToneryMaxim je vlastný návrh podľa jeho úloh.

| Zdroj | Overený princíp | Uplatnenie |
| --- | --- | --- |
| [Amazon — Support Options and Customer Service](https://digprjsurvey.amazon.com/csad/help/node/GSD587LKW72HKU2V) | Objednávky združujú sledovanie, faktúry a reklamácie; osobné údaje sú samostatne. | Objednávky medzi hlavnými úlohami, menej časté nastavenia vo Viac. |
| [Apple — Viewing & Changing Orders](https://www.apple.com/shop/help/viewing_changing_orders) | Stav, sledovanie a faktúra sú dostupné pri objednávke. | Jedno miesto pre úkony súvisiace s nákupom; pôvodné faktúry zostávajú dostupné. |
| [Walmart — Reorder](https://www.walmart.com/help/article/reorder/8c2a6854a3e9428faa93836347c46dd2) | História aj My Items podporujú rýchly opakovaný nákup. | Tlačiarne a vhodné náplne majú vysokú prioritu; uložené produkty ostávajú zachované. |
| [Baymard — Accounts & Self-Service](https://baymard.com/research/self-service) | Pri účtoch sa skúma prehľadnosť navigácie, hlavné zákaznícke úlohy a obmedzenie reklamy. | Päť stálych položiek, viditeľná aktívna časť a menší reklamný obsah v účte. |

## Overenie

- `npm run test:toner-care`: 18 testov skutočných pravidiel, izolovaného workera/API a menu. Namiesto Woo a SMTP sa používajú náhradné adaptéry.
- 62 regresných testov účtu, faktúr, objednávok, adries a súvisiacich funkcií.
- `npm run check`: bez chýb; existujúce informatívne hinty v ostatnom kóde.
- `npm run build`: prejde aj povinná existujúca sada kontrol pred buildom.
- `node scripts/toner-care-render-smoke.mjs`: skutočne zostavené Astro stránky a API s oddeleným skúšobným zákazníkom. Overí pôvodné odkazy, pretrvanie vypnutia po obnovení, zachovanie histórie, druhej tlačiarne, fakturačných a dodacích údajov, uložených produktov, vernostných údajov a dodatočného poľa tlačiarne.
- Browser kontrola cez skúšobné účty v rámcoch 320 a 375 px: otvorenie a zatvorenie menu, dostupnosť pôvodných odkazov, samostatné vypnutie strážcu, história a neprítomnosť vodorovného posúvania. Nepracuje so zákazníckymi dátami produkcie.

## Produkčné overenie po nasadení

Reálne doručenie e-mailov, nastavenie ADMIN_EMAIL/SMTP a beh produkčného časovača sa pri tejto práci nepotvrdili. Bez údajov o doručení nemožno považovať prijatie správy SMTP serverom za dôkaz doručenia do schránky.

Ochrana pred opakovaným odoslaním používa uložené značky v zákazníckych metaúdajoch a zámok jedného procesu. SMTP odoslanie a uloženie značky vo Woo nie sú jedna atómová operácia: pád alebo nedostupný zápis po prijatí e-mailu môže viesť k opakovaniu. Súbežné odosielanie z viacerých produkčných replík nebolo overené. Zmena nesľubuje záruku presne jedného doručenia pri havárii.

## Rozšírená kontrola pred odoslaním do GitHubu

**Výsledok: bez zistenej novej regresie v automatických testoch.** Používateľ následne potvrdil funkčnú DPD mapu na mobile aj počítači a doložil snímku načítanej mapy. Dňa 19. 11. 2026 výslovne schválil odoslanie týchto úprav do verejného GitHubu. Nižšie zostávajú uvedené výsledky aj hranice jednotlivých skúšok; celá existujúca testovacia sada nie je zelená.

Porovnanie prebehlo s čistým checkoutom pôvodného commitu `96fc65651348444f6e53944bd504153326d45707`, s rovnakými závislosťami a chýbajúcimi produkčnými katalógovými dátami. Produkčné objednávky, platby ani e-maily sa pri skúške nevytvárali.

| Kontrola | Výsledok a hranice overenia |
| --- | --- |
| Astro kontrola a zostavenie | Zostavenie prešlo; kontrola 599 súborov: 0 chýb, 0 varovaní, 22 informatívnych hintov. |
| Strážca a menu | 18/18 testov; dátumy, týždenné odosielanie, oddelení príjemcovia, ukončenie, samostatné vypnutie, zachovanie údajov. |
| Objednávkové e-maily | 13/13 testov bez skutočného SMTP odosielania. |
| Kritický nákup a GoPay | 79/79 testov skutočných modulov s náhradným transportom: prerušené/zrušené platby, ďalší nákup a kupóny, zmena platby pri pôvodnej objednávke, súbežné odoslania a prístup k cudzej platbe. |
| Dopravné údaje DPD | 36/36 testov normalizácie a prenosu údajov do objednávky. |
| Zostavený účet a obchod | Prešli HTTP skúšky histórie 61 objednávok na 4 stranách, faktúr, opakovaného nákupu, neprihláseného a cudzieho zákazníka aj verejných stránok. |
| Zostavený strážca | Prešla samostatná skúška API a stránok s izolovanými zákazníckymi dátami. |
| Živý web | 12/12 dostupných bezpečných integračných kontrol: katalóg, vyhľadávanie, ceny, košík/pokladňa a odmietnutie prázdnej objednávky/platby. |
| Živá DPD mapa | Widget načítal zoznam miest, vyhľadal Banskú Bystricu a preniesol vybrané miesto SK22821 do pokladne. Mapová plocha hlásila „Niečo sa pokazilo“. Pri voľbe DPD Pickup Box sa widget otvoril; samostatný výber konkrétneho boxu sa nepotvrdil. |
| Živá GLS mapa a balíkomat | Zobrazenie mapy, vyhľadanie Banskej Bystrice, detail balíkomatu a potvrdenie výberu ID 34457 prešli; adresa a ID sa preniesli do pokladne. |
| Mobilná pokladňa | V rámci 390 px prešli produkt → košík → tri kroky pokladne → skúšobná brána → návrat PAID so správnym číslom a sumou. Prešli prepočty kuriéra, výdajného miesta a dobierky, zablokovanie pokračovania bez výdajného miesta a odoslania bez povinného potvrdenia. V rámci 320 px prešiel ďalší nákup a povinný výber DPD boxu; následný ručný priechod sa pre nedostupný skúšobný náhľad nedokončil. |
| Skutočné strhnutie cez GoPay | Nevykonalo sa. Prehliadač použil výslovne označenú náhradnú bránu a izolovaný backend; výsledok nepotvrdzuje spojenie s reálnou bránou, bankou ani doručenie e-mailu. |

### Širšia regresná sada

`npm test` sa zastaví na dvoch testoch reklamy, ktoré vyžadujú reálny produktový katalóg. Ostatné skupiny boli spustené samostatne. Vyhľadávanie, výkonové testy, Woo kontrakty, DPD, migrácia, bezpečnosť a cenová história prešli. Reklamné testy majú 2 zlyhania, SEO 3, produkčná sada 18 a AI regresná sada 133.

Všetky štyri zlyhávajúce skupiny boli zopakované aj na pôvodnom kóde. Názvy všetkých zlyhaných testov sa zhodujú; zmena nepridala žiadne nové zlyhanie. Tieto existujúce zlyhania však neboli potlačené ani označené za úspech.

### Rýchlosť

Dva behy zostavenej novej verzie zvládli po 1 000 požiadaviek bez HTTP chyby, p95 32,0 a 40,3 ms, RSS 155,1 a 176,2 MB. Pôvodná verzia v jednom porovnávacom behu dosiahla p95 22,7 ms a RSS 169,8 MB. Ide o lokálnu odozvu servera nad skúšobnými dátami; rozdiely medzi krátkymi behmi nepreukazujú zmenu internetového načítania na mobile. Všetky behy prešli existujúcim limitom p95 2 s a RSS 300 MB.

Z 55 klientskych súborov ostalo 53 obsahovo zhodných. Zmenili sa iba CSS účtu a JavaScript AccountShell; kód košíka, pokladne a platobného návratu zostal zhodný. Nové menu pridáva do skriptu účtu približne 2,4 kB a do CSS účtu 3,8 kB pred kompresiou. Mobilný Lighthouse a Core Web Vitals po produkčnom nasadení neboli merané.

### Hranice overenia a schválenie publikovania

Chyba mapovej plochy DPD sa pozorovala pri otvorení súčasného živého webu v testovacom cloudovom prehliadači ešte bez týchto úprav účtu. Používateľ následne potvrdil načítanie na mobile aj počítači a doložil snímku funkčnej mapy. Výpadok u zákazníkov sa nepreukázal; príčina odlišného správania testovacieho prehliadača sa nepotvrdila. Kód DPD widgetu, košíka, pokladne a platobného návratu sa v tejto zmene neupravuje. Skutočné strhnutie platby cez GoPay nebolo súčasťou skúšky a nie je doložené testovacím transportom.

Pred testom bol živý košík prázdny. Jediná pridaná skúšobná položka bola odstránená a pôvodná voľba DPD Pickup bez zvoleného miesta s platbou GoPay bola obnovená. Fakturačné a kontaktné údaje účtu sa neupravovali. Zákaznícke nastavenia sa skúšali na oddelených dátach.

Používateľ schválil publikovanie do verejného GitHubu. Samotné odoslanie kódu a následné nasadenie na hosting sú samostatné kroky; tento dokument nepotvrdzuje produkčný redeploy ani doručenie upozorňovacích e-mailov.
