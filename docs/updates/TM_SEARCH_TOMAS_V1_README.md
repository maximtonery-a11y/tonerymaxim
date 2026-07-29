# ToneryMAXIM – presné vyhľadávanie a AI Tomáš

## Čo sa zmenilo

- Dotazy na náplne ako `HP 650`, `HP 652`, `HP652`, `HP 652XL` a `HP 655`
  sa najskôr porovnajú s názvom produktu, SKU a URL produktu.
- Číslo náplne `652` sa už nepovažuje za zhodu s tlačiarňami `6520` alebo
  `M652`.
- Rovnaké pravidlá používa našeptávač, výsledková stránka aj AI Tomáš.
- Ak katalóg nájde presné označenie produktu, návrhy podobne očíslovaných
  tlačiarní sa nezobrazia nad produktmi.
- Tomáš najskôr používa overené údaje z katalógu a lokálnej znalostnej databázy.
- OpenAI sa použije len pri otázke, ktorú lokálne pravidlá nevedia spoľahlivo
  pochopiť. Model dostane iba schválené informácie a nesmie si domýšľať ceny,
  sklad, kompatibilitu ani stav objednávky.
- Pri nízkej istote Tomáš požiada zákazníka o presný model alebo celé označenie
  náplne.
- AI endpoint má samostatný limit požiadaviek, časový limit a bezpečný lokálny
  fallback.

## Produkčné premenné

Do serverového prostredia Coolify/Netlify pridajte:

```env
OPENAI_ASSISTANT_ENABLED=1
OPENAI_API_KEY=SEM_VLOZTE_VLASTNY_OPENAI_KLUC
OPENAI_MODEL=gpt-5.6
OPENAI_REASONING_EFFORT=low
OPENAI_TIMEOUT_MS=12000
OPENAI_MAX_OUTPUT_TOKENS=450
```

`OPENAI_API_KEY` nesmie mať prefix `PUBLIC_`, nesmie byť uložený v GitHube a
nesmie sa používať priamo v klientskom JavaScripte. Projekt ho číta iba na
serveri.

Ak kľúč nie je nastavený alebo OpenAI dočasne neodpovie, Tomáš ďalej funguje
cez katalóg a lokálnu databázu. Pri neistej otázke radšej požiada o upresnenie.

## Kontrola pred nasadením

```sh
npm install
npm test
npm run build
```

Po nasadení skontrolujte aspoň tieto dotazy:

- `HP 650`
- `HP 652`
- `HP652`
- `HP 652XL`
- `HP 655`
- `HP M652`
- `CF283A`
- `CRG-054`

Pri `HP 652` sa majú zobraziť len produkty rodiny 652/652XL. Epson T11C,
HP CF320A, HP DeskJet 6520 ani HP LaserJet M652 nesmú byť odporúčané ako
náhrada za náplň HP 652.
