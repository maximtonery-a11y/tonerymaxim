# ToneryMAXIM

Serverová Astro aplikácia pre e-shop ToneryMAXIM.

## Lokálne spustenie

Vyžaduje Node.js 22.12 alebo novší.

```sh
npm install
npm run dev
```

Ak je port 4321 obsadený:

```sh
npm run dev -- --port 4323
```

## Kontrola projektu

```sh
npm test
npm run build
```

## Produkčné spustenie

```sh
npm install
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
