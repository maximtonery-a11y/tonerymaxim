# ToneryMaxim.sk – postup ostrého nasadenia

Tento projekt je pripravený ako kompletný zdroj pre GitHub a Coolify. Produkty sa
neukladajú do GitHubu: pri spustení sa bezpečne načítajú z existujúceho
WooCommerce API do persistentnej cache. Nasadenie preto nesmie pokračovať na DNS,
kým vzdialená kontrola nepotvrdí celý očakávaný katalóg, minimálne 99 % počtu
hláseného WooCommerce. Voliteľná hodnota `WOO_SYNC_EXPECTED_MIN_PRODUCTS` je iba
dodatočná poistka; predvolene je `0`, aby nesprávny starý odhad nezablokoval
prvé načítanie produktov.

## 1. Lokálna kontrola pred GitHubom

1. Rozbaľte ZIP do nového prázdneho priečinka.
2. Reálny `.env` zo starej pracovnej kópie nekopírujte do GitHubu.
3. Spustite `KONTROLA_PRED_GITHUBOM.bat`.
4. Spustite `OVERIT_LOKALNY_KATALOG.bat`; táto kontrola musí načítať skutočné
   produkty cez vaše lokálne WooCommerce nastavenie.
5. Pokračujte iba pri oboch hláseniach `HOTOVO`.

Kontrola vykoná čisté `npm ci`, všetky testy, produkčný Astro build a
bezpečnostný audit produkčných závislostí.

Po oboch úspešných kontrolách môžete spustiť `UPRATAT_PRED_GITHUBOM.bat`.
Odstráni staré inštalačné balíky, `node_modules`, build a lokálne cache. Reálny
`.env` ani `.git` neodstráni.

## 2. GitHub

Do repozitára patria zdrojové súbory z tohto ZIP-u. Nepatria tam:

- `.env` a žiadne reálne kľúče,
- `.git`,
- `node_modules`,
- `dist`, `.astro`,
- `.tm-data`, `.tm-cache`,
- `migration/reports`.

Pred pushom skontrolujte:

```bat
git status --short
git check-ignore .env
git diff --cached -- .env
```

Posledný príkaz nesmie vypísať obsah `.env`.

## 3. Coolify – povinné nastavenie

Build command:

```text
npm ci && npm run build
```

Start command:

```text
npm start
```

Node.js musí byť 22.12 alebo novší. V Coolify vytvorte persistentný volume
pripojený na `/app/data`.

Premenné prostredia nastavte podľa `.env.production.example`. Ukážkové hodnoty
`SEM_VLOZTE...` aplikácia zámerne odmietne. Každý tajný kľúč vytvorte samostatne,
napríklad:

```bat
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Najdôležitejšie hodnoty:

- `PUBLIC_SITE_URL=https://www.tonerymaxim.sk`
- `TM_PERSISTENT_DATA_DIR=/app/data`
- `TM_CACHE_DIR=/app/data/product-cache`
- platné `WOO_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`
- `WOO_SYNC_EXPECTED_MIN_PRODUCTS=0` (odporúčané pri prvom nasadení; úplnosť sa
  automaticky kontroluje voči počtu hlásenému WooCommerce. Pevné minimum nastavte
  až keď poznáte aktuálny počet publikovaných produktov)
- samostatné `AUTH_SECRET`, `TM_PERSISTENCE_SECRET`, `ADMIN_API_SECRET`,
  `SYNC_SECRET`, `TM_ANALYTICS_ADMIN_KEY`
- SMTP údaje
- GoPay údaje a `GOPAY_RETURN_URL=https://www.tonerymaxim.sk/platba-dokoncena`
- voliteľne `OPENAI_API_KEY`; bez neho Tomáš používa katalóg a overenú lokálnu
  databázu a pri neistote žiada upresnenie
- voliteľne `PUBLIC_GTM_ID=GTM-...`; bez platného ID sa Google tag nenačíta
- voliteľne `HEUREKA_SECRET_KEY`; bez overiteľných údajov sa nevykreslia
  vymyslené náhradné hodnotenia

## 4. Nasadenie najprv na `.info`

V Coolify nasaďte rovnaký produkčný build na `https://www.tonerymaxim.info`.
Doména `.info` má automaticky globálny `noindex`, aby nekonkurovala budúcej
produkcii.

Po úspešnom deploy spustite:

```bat
OVERIT_NASADENIE_INFO.bat
```

Skript si vypýta `TM_ANALYTICS_ADMIN_KEY` z Coolify. Kľúč sa používa iba na
hlbokú kontrolu a neukladá sa do projektu. Kontrola následne overí:

- liveness a readiness,
- úplnosť a aktuálnosť produktovej cache,
- serverovú ochranu pokladne,
- WooCommerce, SMTP, GoPay a persistentné úložisko,
- robots/noindex pravidlá,
- sitemap systém,
- Merchant feed iba s platnými kompatibilnými produktmi,
- DSA feed pre Google Ads,
- HTTP výsledok všetkých 18 941 starých URL.

Po úspešnej automatickej kontrole vytvorte na `.info` jednu reálnu skúšobnú
objednávku s lacným skladovým produktom a následne jednu GoPay testovaciu alebo
malú reálnu platbu. Overte:

- objednávku vo WooCommerce so správnou sumou, dopravou, platbou a adresou,
- prijatie zákazníckeho aj administrátorského e-mailu,
- správne zníženie skladu,
- návrat z GoPay a stav platby,
- registráciu, prihlásenie a obnovu hesla.

Skúšobné objednávky potom vo WooCommerce stornujte a prípadnú reálnu platbu
vráťte. DNS nemeňte, kým automatická kontrola neprejde a tieto skúšky nie sú
potvrdené.

## 5. Prepnutie DNS na `.sk`

1. V Coolify pridajte `tonerymaxim.sk` aj `www.tonerymaxim.sk` a overte SSL.
2. Znížte DNS TTL ešte pred prepnutím, ak to pôvodný poskytovateľ umožňuje.
3. Nastavte DNS záznamy podľa cieľa, ktorý uvádza Coolify.
4. Aplikácia presmeruje HTTP a apex doménu trvalým `308` na
   `https://www.tonerymaxim.sk` so zachovaním cesty a parametrov.
5. Pôvodný hosting nevypínajte, kým sa DNS a SSL neustália.

Po prepnutí spustite:

```bat
OVERIT_PO_PREPNUTI_DNS_SK.bat
```

Pri chybe DNS vráťte záznamy na pôvodný cieľ. Pri chybe aplikácie použite v
Coolify rollback na posledný funkčný deployment.

## 6. Google po úspešnom prepnutí

Ide o výmenu platformy na rovnakej doméne, nie o zmenu domény. V Google Search
Console preto nepoužívajte nástroj Zmena adresy.

1. Odošlite `https://www.tonerymaxim.sk/sitemap.xml`.
2. Skontrolujte indexáciu titulnej stránky, kategórií a vzorky produktov.
3. V Merchant Center nastavte zdroj
   `https://www.tonerymaxim.sk/merchant-feed.xml`.
4. Pre DSA kampane použite
   `https://www.tonerymaxim.sk/api/dsa-page-feed.csv`.
5. Sledujte 404, presmerovania, Core Web Vitals, Merchant diagnostiku a stav
   nákupného procesu.

Technická kontrola znižuje riziko migrácie, ale pozíciu číslo 1 nemožno
garantovať. Organické výsledky závisia aj od konkurencie, histórie domény,
odkazov, kvality produktových dát a priebežnej práce s obsahom.
