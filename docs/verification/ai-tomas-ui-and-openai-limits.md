# AI Tomáš: chyby proxy, jedna odpoveď a limity OpenAI

## Potvrdené na nasadení eda915d

Na detaile HP CF259X už živá otázka `ake su moznosti zliav pri tomto tonery?` zachovala SKU 13264 a správne uviedla 60,70 € za 2 ks a 101,16 € za 4 ks. Volanie OpenAI vrátilo HTTP 429; vtedajšia diagnostika ho označila `rate_limited`. Táto staršia klasifikácia nerozlišovala všetky aktuálne kódy kreditu a finančných limitov, preto samotný štítok nedokazuje konkrétnu príčinu. Dve reálne odpovede sú v `ai-tomas-deployed-discounts-and-429.json`.

Snímky zákazníka zároveň odhalili zobrazenie textovej odpovede proxy `Bad Gateway` ako chyby JSON, tri bloky jednej ponuky, interné SKU v nadpise a zámenu sťažnosti „čo to píšeš?“ za nový produktový dopyt.

## Oprava spracovania a prezentácie

- Všetky JSON odpovede v klientovi Tomáša sa čítajú spoločnou funkciou. Text/HTML od proxy, neplatný JSON a odpovede 5xx sa preložia na zrozumiteľnú správu. Dispatcher nepreberá text neočakávanej výnimky do zákazníckej odpovede.
- Výpadok nevytvára automatický nový pokus a nemení uložený produkt ani košík. Uvoľní príznak prebiehajúcej požiadavky, aby zákazník mohol pokračovať.
- Text odpovede a produktové karty sa vykreslia v jednom bloku. Hodnotenie sa pripojí raz, až za obsah. Odstránený je sumár „Naša ponuka pre …“ aj ďalší všeobecný úvod pred kartami.
- Pri návrate cez interné SKU vie zákaznícke označenie použiť názov vyriešeného produktu. Výslovne zadané SKU zostáva platným vstupom pre vyhľadávanie.
- „Čo to píšeš?“, „Tomu nerozumiem“ a podobné samostatné reakcie sa spracujú ako žiadosť o vysvetlenie. Nevyhľadajú toner z predchádzajúceho SKU a nemenia košík.

## OpenAI

Spoločný klient pre porozumenie rozhovoru aj generovanie odpovede rozlišuje `credit_balance_exhausted`, `organization_usage_limit_exceeded`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, staršiu kvótu aj rýchlostný limit. Neznámy dôvod 429 označí všeobecne `provider_limited`.

Obe vetvy zdieľajú čakaciu lehotu po 429. Rešpektuje `Retry-After` v sekundách aj vo formáte HTTP dátumu; pri chýbajúcej hlavičke sa oneskorenie postupne predlžuje s malým náhodným rozptylom. Nevykonáva automatické opakovanie v rámci otázky. Počas čakania zostáva dostupná lokálna vetva a diagnostika poskytne kategóriu s počtom sekúnd. Neuchováva spoločné zákaznícke otázky ani odpovede modelu.

Zdroje: oficiálna dokumentácia OpenAI [Error codes](https://developers.openai.com/api/docs/guides/error-codes) a [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits). Nejde o potvrdenie stavu fakturácie konkrétneho účtu.

## Overenie

- `npm run build`: úspešný build a 229/229 kritických kontrol, vrátane klienta a skutočných renderovacích funkcií s riadenými hranicami DOM/siete.
- `npm run check`: 530 súborov, 0 chýb, 0 upozornení, 25 existujúcich hintov.
- 16/16 požiadaviek cez zostavené lokálne API s izolovaným katalógom; pri tejto kontrole je model vypnutý.
- 7/7 doplnkových kontrol pôvodných šablón a formátovania. Staršie integračné prípady v súboroch R3/V8 závislé od kompletného Woo katalógu nemožno v tomto prostredí vyhodnotiť: chýba lokálny katalóg a prístupové údaje Woo. Nevykazujú sa ako úspešné.
- Modelové testy používajú odpovede API vytvorené v teste; overujú aj čakanie medzi oboma vetvami, bezpečnú odpoveď počas čakania a obnovenie po termíne. Nedokazujú dostupný kredit ani kvalitu živého modelu.
- Verejný detail produktu bol otvorený skutočným prehliadačom. Prehliadač sa k izolovanému lokálnemu serveru nepripojil (`ERR_CONNECTION_REFUSED`), preto vizuálne overenie opravenej verzie zostáva na test po redeployi. Simulácia siete/DOM sa neoznačuje za vizuálny test živého nasadenia.
