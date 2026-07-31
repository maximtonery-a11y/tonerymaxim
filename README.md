# ToneryMAXIM

Serverová Astro aplikácia pre e-shop ToneryMAXIM.

## Lokálne spustenie

Vyžaduje Node.js 22.12 alebo novší.

```sh
npm ci
npm run dev
```

Ak je port 4321 obsadený:

```sh
npm run dev -- --port 4323
```

## Kontrola projektu

```sh
npm ci
npm run release:check
```

## Produkčné spustenie

```sh
npm ci
npm run build
npm start
```

Skopírujte hodnoty z `.env.production.example` do bezpečných premenných
produkčného prostredia. Súbor `.env` ani reálne API kľúče nepatria do GitHubu.

## Vyhľadávanie a AI Tomáš

Vyhľadávanie rozlišuje označenie náplne od podobného čísla modelu tlačiarne.
Katalóg, výsledková stránka aj Tomáš používajú rovnakú presnú identifikáciu
produktov.

Tomáš odpovedá v tomto poradí:

1. overené dáta katalógu,
2. lokálna schválená znalostná databáza,
3. voliteľná OpenAI odpoveď obmedzená iba na schválené informácie,
4. otázka na upresnenie alebo kontakt na podporu.

Produkčné nastavenie a testovacie scenáre sú v
`docs/updates/TM_SEARCH_TOMAS_V1_README.md`.

## SEO, GEO a produktové exporty

- Produkčná doména a canonical: `https://www.tonerymaxim.sk`
- Testovacia doména `.info`: `noindex, follow`
- Sitemap index: `/sitemap.xml`
- Merchant Center XML feed: `/merchant-feed.xml`
- OpenAI Search crawler: povolený cez `/robots.txt`
- Verejný prehľad obsahu: `/llms.txt`

Sitemapy a Merchant feed sa vytvárajú z rovnakej serverovej produktovej cache
ako katalóg. Do Merchant feedu vstupujú iba skladové kompatibilné produkty s
platnou cenou, popisom a verejným obrázkom.

Merchant feed navyše:

- používa iba finálne produktové URL na doméne `.sk`,
- posiela cenu s DPH, sklad, dopravu a kategóriu Google `356`,
- validuje GTIN kontrolným súčtom a posiela MPN iba z produktových dát,
- nikdy nezamení značku tlačiarne za značku kompatibilného produktu,
- pri neočakávane malom výsledku vráti `503` a neodošle poškodený feed.

Po nasadení a nastavení WooCommerce premenných obnovte produktovú cache cez
chránený endpoint `/api/sync-products?force=1` a následne skontrolujte
`/merchant-feed.xml`. Minimálny počet položiek a doprava sa nastavujú pomocou
premenných `MERCHANT_*` uvedených v `.env.production.example`.

## TM SEO Dominator

Chránený dashboard `/admin/seo-dominator?key=TM_ANALYTICS_ADMIN_KEY` vytvára z
aktuálneho katalógu prioritný zoznam 20 až 100 SEO/GEO príležitostí. Hodnotí
kategórie, značky, modely tlačiarní, OEM kódy a produkty. Pri každej stránke
ukáže dátové SEO skóre, interný potenciál, odporúčaný title, meta description,
priamu odpoveď vhodnú pre AI vyhľadávanie a konkrétne chýbajúce údaje.

CSV export je dostupný cez
`/api/seo-opportunities.csv?key=TM_ANALYTICS_ADMIN_KEY`. Pre dashboard používajte
samostatný `TM_ANALYTICS_ADMIN_KEY`, nie hlavný kľúč ostatných administrátorských
API.
Nástroj je iba na čítanie a nič automaticky nepublikuje ani nemení vo
WooCommerce. Počet denných priorít nastavuje `SEO_DOMINATOR_LIMIT`.

## Ostré nasadenie

Kompletný postup pre GitHub, Coolify, testovaciu `.info`, zmenu DNS, plný test
18 941 starých URL, Search Console, Merchant Center a Google Ads je v
`docs/GO_LIVE_DNS.md`.

Rýchle kontroly pre Windows:

- `KONTROLA_PRED_GITHUBOM.bat`
- `OVERIT_LOKALNY_KATALOG.bat`
- `OVERIT_NASADENIE_INFO.bat`
- `OVERIT_PO_PREPNUTI_DNS_SK.bat`
- `UPRATAT_PRED_GITHUBOM.bat` (až po úspešných lokálnych kontrolách)
