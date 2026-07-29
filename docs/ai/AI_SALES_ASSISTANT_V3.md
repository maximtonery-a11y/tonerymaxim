# AI Sales Assistant V3 – Tomáš z ToneryMaxim

Zmeny:
- nový rozhodovací engine namiesto jednoduchého vyhľadávania podobnosti slov,
- správne rozlíšenie: produkt / diagnostika / kompatibilita / reklamácia / doprava / platba / FAQ,
- otázka „toner nepasuje“ už nejde do odpovede „sype sa toner“,
- produktové otázky ako „CF283A“ vrátia skupiny kompatibilné / originálne / renovované,
- ak asistent nevie bezpečne odpovedať, zobrazí kontaktnú odpoveď,
- neznáme otázky zapisuje do `.tm-cache/ai-unanswered.jsonl`.

Testované:
- `npm run build` prešiel úspešne.
- `CF283A` našlo: 1 kompatibilný, 2 originálne, 2 renovované.
- `toner nepasuje` odpovedá reklamácia/výmena.
- `tlačí pásy` odpovedá diagnostika tlače.
