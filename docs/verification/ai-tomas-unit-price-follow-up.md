# AI Tomáš: živá kontrola 18cb51c a cena za kus

Kontrola 21. 10. 2026 otvorila živý detail HP CF259X (59X) čierneho kompatibilného tonera. V skutočnom prehliadači prešli otázky na cenu (33,72 €), samostatnú dopravu, následnú celkovú cenu bez zopakovania modelu (33,72 € s dopravou zdarma), konkrétne zľavy, „čo to píšeš?“ a zobrazenie produktovej ponuky. Odpovede mali po jednom hodnotení; ponuka s kartou bola v jednom článku bez nadpisu „Naša ponuka pre 13264“. Siedma otázka reprodukovala novú snímku zákazníka: „takze ked kupim 4 kusy aka cena bude za jeden kus?“ skončila nesprávnou požiadavkou na model tlačiarne. Záznam viditeľného chatu je v `ai-tomas-live-18cb51c-dom.json`.

Dve samostatné anonymné HTTP požiadavky potvrdili zapnutú integráciu a konkrétny stav `credit_balance_exhausted`; odpoveď na servisnú otázku preto poskytla pravidlová vetva. Výsledky sú v `ai-tomas-live-credit-balance.json`. Nebol otvorený fakturačný účet ani získaný API kľúč. Kód zodpovedá vyčerpanému predplatenému API kreditu podľa [oficiálnej dokumentácie OpenAI](https://developers.openai.com/api/docs/guides/error-codes). Opakovanie požiadaviek kredit neobnoví.

## Oprava

- Jedna konkrétna otázka na cenu množstva ide priamo cez resolver produktu a výpočet ceny, namiesto ďalšieho vypisovania ponuky. Viacvariantové porovnanie 2/3/4 ks ostáva podporované pôvodnou vetvou.
- Kontext vie nadviazať aj na poslednú zľavovú odpoveď s presnou identitou produktu. Otvorenie iného detailu alebo výslovne uvedený iný produkt majú prednosť; neznámy produkt si nepožičia cenu starého.
- „Kúpim 4 kusy, cena za 1 kus“ obsahuje nákupné množstvo štyri a základ jednotkovej ceny jeden. Podporované je aj „štyri kusy“ a následné „Aká je cena za kus?“.
- Pre HP CF259X s aktuálnou cenou 33,72 € výpočet dáva 25 % množstevnú zľavu, 25,29 € za kus a 101,16 € za štyri kusy. Kupóny ani body nie sú automaticky domýšľané. Originálny variant nedostane zľavu určenú kompatibilným produktom.
- Počet štyri sa uloží k produktu aj pre následnú cenu s dopravou. Modelový plán nesmie zmeniť „za jeden kus“ na nový nákup jedného kusu. Otázka nemení košík.
- Pri odchýlke zo zaokrúhľovania je jednotková cena označená ako približná; celková suma používa rovnaké pravidlá ako pokladňa.

## Overenie novej verzie pred nasadením

- 235/235 kritických kontrol a produkčný build prešli. Presná snímková regresia následne prešla aj s číselným SKU 13264; ostatné prípady pokrývajú alfanumerické SKU.
- `npm run check`: 530 súborov, 0 chýb, 0 upozornení, 25 existujúcich hintov.
- 19/19 skutočných HTTP požiadaviek na zostavené lokálne API s izolovaným katalógom a vypnutým modelom; výsledky v `ai-tomas-unit-price-http.json`.
- Modelové kontroly používajú simulované odpovede API. Živý model kvôli vyššie uvedenej chybe kreditu nebol potvrdený ako funkčný.
- Živý prehliadač a jeho záznam zachytávajú nasadenie 18cb51c pred touto dodatočnou opravou. Novú odpoveď na otázku zo snímky treba po ďalšom redeployi overiť na produkcii.

Nevykonala sa objednávka, platba, úprava zákazníckeho účtu ani odoslanie na podporu. Kontroly využívali poradenské otázky a zachovali prázdny košík.
