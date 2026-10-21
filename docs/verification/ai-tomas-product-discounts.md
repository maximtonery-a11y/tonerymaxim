# AI Tomáš: zľavy ku konkrétnemu produktu a diagnostika OpenAI

## Potvrdený problém

Živý rozhovor na detaile `/produkt/hp-cf259x-59x-kompatibilny-toner` reprodukoval snímku zákazníka. Tomáš správne uviedol HP CF259X, SKU 13264, cenu 33,72 €, no na otázku `ake su moznosti zliav pri tomto tonery?` si znova pýtal model tlačiarne alebo označenie tonera. Všetky tri odpovede mali `engine: rules` a `aiEnabled: true`. Výsledok je v `ai-tomas-cf259-discounts-before-fix.json`.

Rozpoznávanie zliav pracovalo s koreňom „zľav“, ale vynechávalo genitív „zliav“. Navyše všeobecná odpoveď na zľavy neviazala pravidlá na typ a cenu práve riešeného produktu.

## Oprava

- Rozpoznáva aj „zliav“ a odkazy „pri tomto“, „tohto“, „tejto“, „týchto“. Otázka na možnosti zliav k produktu zostáva naviazaná na jeho SKU aj po odbočke k doprave.
- Odpoveď používa čerstvé údaje rovnakého katalógu ako detail produktu. Množstevné sumy vypočíta funkcia `priceForQuantity`, ktorá zodpovedá zaokrúhľovaniu košíka. Pri testovacej cene 33,72 € stoja 2 kompatibilné kusy 60,70 € a 4 kusy 101,16 € s DPH, pred kupónom a bodmi.
- Zohľadňuje typ produktu. Originálnemu ani renovovanému toneru nesľúbi množstevnú zľavu 10/25 % alebo 7 % odmenu na kompatibilné tonery. Platný 5 % uvítací kupón a existujúce body opisuje podmienene, bez tvrdenia, že ich zákazník má.
- Vysvetľuje automatické množstevné zľavy, Moje odmeny, výber jedného kupónu, použitie bodov a konkrétne riadky odpočtov v košíku/pokladni, vrátane mobilu. Nevypisuje nesúvisiace zľavy na kalendáre pri otázke na toner.
- Nový otvorený detail a výslovné označenie iného produktu majú prednosť pred starým výberom. Nejednoznačný či neznámy toner vyžiada spresnenie. Odbočka k zľavám zachová aj skôr dohodnutý počet kusov.
- Poradenská odpoveď nemení košík a nepredstavuje súhlas s nákupom.

## Overenie pred nasadením

- `npm run check`: 527 súborov, 0 chýb, 0 upozornení, 25 existujúcich hintov.
- `npm run build`: úspešný produkčný build a 222/222 kritických kontrol.
- Samostatná kontrola 300/300 bežných otázok.
- Zostavené API: 16/16 HTTP požiadaviek s izolovaným katalógom, vrátane doslovného prípadu zo snímky, zmeny produktov, množstva, zľavy, dopravy a dobierky. Model je pri tomto lokálnom overení vypnutý.
- Modelová integrácia používa testové odpovede API. Pokrýva úspech, prihlásenie, oprávnenie, chýbajúci model, kvótu, rýchlostný limit, chybnú požiadavku, výpadok, timeout a neplatný odkaz. Chyba poskytovateľa, kľúč ani obsah rozhovoru sa nepridávajú do diagnostiky.

## Rozlíšenie skutočného modelu od náhradnej vetvy

`conversation.aiEnabled` potvrdzuje iba konfiguráciu. `conversation.engine: model` potvrdzuje použitie validovaného modelového plánu. Nové `conversation.modelStatus` rozlišuje napríklad `ok`, `authentication_failed`, `permission_denied`, `model_unavailable`, `quota_exceeded`, `rate_limited`, `timeout`, `incomplete_response`, `invalid_response` a `invalid_reference`. Prvá správa bez histórie má očakávane `no_history`; nákupné alebo citlivé správy sa môžu preskočiť.

Verejná diagnostika obsahuje iba pevne určenú kategóriu, žiadny text chyby poskytovateľa, API kľúč alebo hlavičky. Nie je súčasťou zákazníckej odpovede v chate.

Po redeployi možno overiť aj skutočné zapojenie modelu:

```sh
node scripts/verify-ai-tomas-delivery.mjs --base-url https://www.tonerymaxim.sk --require-model --output /tmp/ai-tomas-live.json
```

Skript sa pri neúspechu zastaví. Má 16 požiadaviek a rešpektuje existujúci limit 30 požiadaviek za 10 minút. Nezakladá objednávky ani neodosiela podporu. Funkčnosť skutočného kľúča a modelu po tejto úprave musí potvrdiť až test nasadenej verzie; lokálne odpovede API ju nedokazujú.
