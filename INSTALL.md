# ToneryMaxim AI Sales Assistant v1 – opravený balík

Tento balík je upravený pre aktuálny projekt `tonerymaxim(17).zip`.

## Čo je opravené

- používa reálny produktový cache súbor `.tm-cache/products.json`,
- používa existujúci košík `window.ToneryMaximCart.addToCart`,
- používa správny kľúč košíka `tm_cart_v1`,
- skript sa importuje cez Astro bundler, nie cez nefunkčné `/src/...`,
- inštalátor vkladá asistenta do `src/components/Header.astro`, nie do nepoužívaného `Layout.astro`.

## Inštalácia

1. Rozbaľte ZIP do koreňa projektu.
2. Spustite:

```bash
node install-ai-sales-assistant-v1.mjs
npm run build
```

3. Otestujte otázky:

- `HP 135A`
- `Brother TN-2421`
- `Canon MF655Cdw`
- `Tlačí mi pásy`

## Poznámka

Toto je bezpečná v1. Nezasahuje do pokladne, GoPay ani odosielania objednávky.
