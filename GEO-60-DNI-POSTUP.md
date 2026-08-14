# ToneryMaxim.sk – GEO nasadenie a 60-dňový postup

## Meranie doplnené v projekte

- `data/geo-ai-benchmark.json` obsahuje pevných 50 otázok; počas 60 dní ich nemeníme.
- Výsledky zapisujte do `data/geo-ai-results.csv`. `rank` je poradie ToneryMaxim v odpovedi, hodnoty `mentioned`, `cited` a `correct` sú `1` alebo `0`.
- Súhrn vypočíta príkaz `npm run geo:score`.
- Návštevy z ChatGPT, Perplexity, Copilot, Gemini, Claude, You.com, Phind, Mistral a Grok sa označia vo vlastnej analytike a odošlú do GA4 ako udalosť `ai_referral_visit` s parametrom `ai_source`.
- Prioritných 20 stránok tlačiarní a 20 OEM rodín má serverovo vložený faktografický blok bez ďalšieho sieťového volania a bez klientského JavaScriptu.

Meranie AI odpovedí je zámerne poloautomatické. AI služby nemajú jednotné bezplatné rozhranie a odpovede sa líšia podľa účtu, lokality a času. Raz týždenne preto otestujte rovnaké otázky v rovnakých službách a doplňte iba CSV.

## Súbory na výmenu

Nahraďte alebo pridajte súbory z balíka pri zachovaní adresárovej štruktúry a nasaďte nový build:

- `src/lib/geo/llms.ts`
- `src/pages/llms.txt.ts`
- `src/components/SeoHead.astro`
- `public/llms.txt`
- `scripts/seo-foundation.test.ts`

Po nasadení musí adresa `https://www.tonerymaxim.sk/llms.txt` vrátiť stav 200, typ `text/plain` a začínať textom `# ToneryMaxim.sk`.

## Čo technická úprava zabezpečuje

- samostatný serverový endpoint `/llms.txt` aj statickú zálohu,
- jasné pravidlá pre AI, aby nezamieňala podobné modely a OEM kódy,
- odkazy na tlačiarne, produkty, poradňu, FAQ a samostatné sitemap indexy,
- jednotnú entitu `OnlineStore` s názvom, prevádzkovateľom, IČO, adresou a kontaktmi,
- odkaz na `llms.txt` v hlavičke každej indexovateľnej stránky,
- žiadny nový klientsky JavaScript ani databázové volanie, preto úprava nespomaľuje vyhľadávanie ani stránky.

## 60-dňový postup

### Deň 0–7: indexácia a meranie

1. Nasadiť balík a overiť `/llms.txt`, `robots.txt` a všetky sitemap URL.
2. V Google Search Console a Bing Webmaster Tools znovu odoslať sitemap index.
3. Urobiť v anonymnom okne základný test 30 otázok v Google AI, ChatGPT, Claude a Perplexity. Zapísať, či je ToneryMaxim citovaný a či bola odporučená správna náplň.
4. Skontrolovať jednotnosť názvu, adresy, IČO, telefónu a URL na webe, Google firemnom profile a verejných firemných katalógoch.

### Deň 8–30: autorita presných odpovedí

1. Každý týždeň spracovať 5 najhľadanejších tlačiarní alebo OEM rodín s reálnym dopytom.
2. Na každej prioritnej stránke udržiavať stručnú odpoveď: presný model, správne OEM kódy, kompatibilné/originálne/renovované varianty a upozornenie na zameniteľné modely.
3. Opravovať najprv konflikty kompatibility z vyhľadávania a objednávok; nepridávať generické marketingové texty bez faktov.
4. Získať prvé dôveryhodné externé zmienky a odkazy od partnerov, dodávateľov, odborných katalógov alebo médií. `llms.txt` sám autoritu nevytvorí.

### Deň 31–60: rozšírenie a optimalizácia

1. Rozšíriť pilot minimálne na 20 tlačiarní a 20 OEM rodín podľa návštevnosti a marže.
2. Každý týždeň zopakovať rovnakých 30 AI otázok a porovnať citácie, správnosť a pozíciu odporúčania.
3. Pri nesprávnej odpovedi opraviť zdrojové kompatibility a kanonickú stránku, nie iba pridať ďalší text.
4. Publikovať odborné odpovede na nové reálne otázky zákazníkov a interne ich prelinkovať na model, OEM aj produkty.
5. Po 60 dňoch rozhodovať podľa podielu správnych citácií, návštev z AI a objednávok, nie podľa jedného GEO skóre.

## Cieľ a hranice

Cieľom je dostať ToneryMaxim.sk medzi dve najčastejšie odporúčané slovenské možnosti pri relevantných otázkach o toneroch. Výsledné poradie riadia externé AI systémy, preto ho nikto nevie garantovať. Technická dostupnosť je iba základ; rozhodujúca bude správnosť kompatibilít, konzistentná identita, citovateľné odpovede a dôveryhodné externé zmienky.
