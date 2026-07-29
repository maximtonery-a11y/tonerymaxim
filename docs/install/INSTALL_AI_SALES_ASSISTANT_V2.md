# ToneryMaxim AI Sales Assistant v2

Táto verzia opravuje problémy z v1:

- tlačidlá FAQ už nevyťahujú náhodné produkty,
- „Tlačí pásy“ odpovie diagnostikou a nepodhodí Ricoh tonery,
- „Kompatibilný vs originál“ odpovie vysvetlením a nepodhodí fixačnú jednotku,
- vyhľadávanie produktu/modelu používa dáta z `.tm-cache/products.json`,
- výsledky sa skupinujú na kompatibilné / originálne / renovované,
- pri dlhšej ponuke okno neodskočí na koniec.

## Inštalácia

Rozbaľte ZIP do koreňa projektu a spustite:

```bash
node install-ai-sales-assistant-v2.mjs
npm run build
npm run dev
```

## Testy

Skontrolujte:

- `CF283A`
- `Brother DCP-9020CDW`
- `Tlačiareň tlačí pásy`
- `Kompatibilný vs originálny toner`
- `Sype sa toner`

## Poznámka

V2 nezasahuje do GoPay, pokladne ani odosielania objednávky.
