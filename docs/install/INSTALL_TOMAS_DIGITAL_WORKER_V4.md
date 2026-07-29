# Tomáš z ToneryMaxim – digitálny pracovník V4

Rozbaľte ZIP do koreňa projektu a povoľte prepísanie súborov.

Potom spustite:

```bash
npm run build
npm run dev
```

## Čo sa mení

- Tomáš už nerozhoduje iba podľa podobnosti slov.
- Najprv určí zámer otázky: produkt, doprava, platba, reklamácia, objednávka, diagnostika, účet, GDPR/kontakt.
- Vie odpovedať na základné otázky:
  - Kedy mi pošlete objednávku?
  - Koľko stojí doprava?
  - Akú dopravu používate?
  - Ako môžem zaplatiť?
  - Toner nepasuje.
  - Chcem reklamovať toner.
  - Zabudol som heslo.
- Produktové otázky ako CF283A stále zobrazia produkty podľa skupín kompatibilné/originálne/renovované.
- Neznáme otázky sa uložia do `.tm-cache/ai-unanswered.jsonl`.
- Pri neistej odpovedi Tomáš zobrazí kontakt:
  - +421 917 859 206
  - info@tonerymaxim.sk
  - Po–Pi 9:00–15:00

## Zmenené/doplnené súbory

- `src/data/ai-knowledge.ts`
- `src/lib/aiSalesAssistant.ts`
- `src/pages/api/ai-sales-assistant.ts`
- `src/components/FloatingAdvisor.astro`
