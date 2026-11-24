# Zmeny v ToneryMaxim

1. Pred zmenou zaznamenaj commit, dotknuté stránky alebo API, spôsob reprodukcie a výsledky pôvodnej verzie. Pri zmene pre zákazníka zmeraj aj čas do použiteľného výsledku.
2. Uprav dotknutú časť webu. Pri súbežnej práci zohľadni aktuálny stav hlavnej vetvy.
3. Spusti automatické kontroly funkčnosti, výkonu a bezpečnosti. Projekt má `npm run check`, `npm test` a `npm run build` s kontrolami pred zostavením. Podľa rozsahu použi aj príslušné nákupné scenáre v GitHub Actions.
4. Porovnaj pôvodnú a upravenú verziu s rovnakými vstupmi a za rovnakých podmienok. Rozlíš čas spracovania, čas čakania zákazníka a prípadné limity merania.
5. Pri regresii ponechaj zmenu vo vývojovej vetve, priprav opravu a zopakuj príslušné testy. Do produkcie patrí overená verzia.
6. V pull requeste alebo v príslušnom zázname v `docs/` uveď commit, rozsah úprav, výsledky pred a po zmene, zostávajúce obmedzenia a stav nasadenia. Ďalšiu úlohu začni týmto záznamom. Osobné údaje zákazníkov, fotografie štítkov a prístupové údaje uchovaj mimo repozitára.
