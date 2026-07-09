# ToneryMaxim AI Sales Assistant v1 – viditeľná oprava

Toto je oprava pre projekt `tonerymaxim(17).zip`.

Dôvod, prečo sa pôvodný AI asistent nezobrazil:

- projekt už používa komponent `FloatingAdvisor.astro`,
- ten sa vykresľuje na stránkach ako modré tlačidlo „Potrebujete poradiť?“,
- nový AI komponent bol vložený mimo reálne používaného poradcu alebo bol prekrytý existujúcim poradcom.

Táto verzia bezpečne nahrádza existujúci `FloatingAdvisor.astro` za AI poradcu. Nemusíte ručne vkladať nič do `Header.astro`.

## Inštalácia

1. Rozbaľte ZIP do koreňa projektu.
2. Spustite:

```bash
node install-ai-sales-assistant-visible-v1.mjs
npm run build
npm run dev
```

3. Na stránke sa vpravo dole zobrazí tlačidlo **AI poradca**.

## Test otázky

- `HP 135A`
- `Brother TN-2421`
- `Canon MF655Cdw`
- `Tlačí mi pásy`

## Bezpečnosť

V1 nezasahuje do GoPay, pokladne ani odosielania objednávky.
