# Audit projektu ToneryMAXIM

## Opravené v tomto balíku

1. **Middleware blokoval streaming HTML.** Každú HTML odpoveď načítal cez `response.text()`, vložil analytický skript a znovu vytvoril odpoveď. To zvyšovalo čas prvej odpovede a pamäťovú záťaž. Analytika je teraz priamo v `Header.astro`.
2. **Diagnostika mala rozdielne overovanie medzi stránkou a API.** Pri produkčnej 401/500 odpovedi UI zobrazilo prázdne hodnoty namiesto chyby. Teraz používa spoločný resolver a chybu zobrazí.
3. **Coolify cache mount sa nepoužíval.** Coolify má `/app/tm-cache`, ale kód zapisoval do `/app/.tm-cache`. Nový resolver automaticky použije `/app/tm-cache` alebo `TM_CACHE_DIR`.
4. **Dve SMTP odoslania prebiehali postupne.** Potvrdenie zákazníkovi a kópia prevádzke teraz bežia paralelne. Funkčnosť a retry fronta zostávajú zachované.
5. **Runtime `.tm-data` nebolo ignorované Gitom.** Stav fronty a číslovania sa už nemá commitovať.

## Overené

- `npm ci`
- `npm run build`
- Astro server build prešiel bez chyby.

## Zistenia, ktoré som zámerne nemenil

### 1. Závislosť `gopay-nodejs`
Balík používa zastaraný `request` a prináša bezpečnostné hlásenia. Je vhodné postupne prejsť na vlastné GoPay REST volania cez natívny `fetch`, ale nie v rýchlom balíku, pretože by to mohlo zasiahnuť platby.

### 2. Veľké obrázky
- `public/images/tlaciaren.png` približne 2,3 MB
- `public/images/logo.png` približne 2,1 MB
- `public/images/tm-ink-placeholder-box.jpg` približne 1,35 MB

Najväčšie zrýchlenie médií prinesie konverzia na WebP/AVIF a správne rozmery. Pred automatickou zmenou treba skontrolovať, kde sa používajú, aby sa nezhoršil vizuál.

### 3. Veľký súbor PSČ
`src/data/psc-sk.json` má približne 2,1 MB. Je iba na serveri, ale načítanie a parsovanie môže pri studenom štarte spomaliť prvé použitie. Neskôr ho možno prerobiť na menší index alebo SQLite.

### 4. Veľké klientské skripty
- checkout.js ~68 KB
- product-detail.js ~66 KB
- cart.js ~41 KB
- catalog.js ~35 KB

Ďalší bezpečný krok je rozdeliť ich podľa funkcií a načítavať mapy GLS/DPD až po kliknutí používateľa.

### 5. Header a Footer API požiadavky
Header kontroluje účet pri každej stránke a Footer načítava Heureka údaje. Je možné pridať krátku session cache, ale treba dôkladne ošetriť prihlásenie/odhlásenie.

## Odporúčané poradie ďalšej optimalizácie

1. Lazy-load GLS/DPD widgetov až pri otvorení mapy.
2. Optimalizácia troch najväčších obrázkov.
3. Migrácia GoPay klienta zo zastaraného balíka na natívny REST klient.
4. Rozdelenie checkout/product-detail skriptov.
5. Serverové meranie TTFB pre `/`, `/produkty`, `/produkt/...`, `/kosik`, `/pokladna`.
