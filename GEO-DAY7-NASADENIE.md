# GEO meranie – Day 7

Day 7 sa počíta od reálneho nasadenia tejto opravy na `tonerymaxim.sk`, nie od vytvorenia ZIPu.

1. Nemeňte `data/geo-ai-benchmark.json`; musí zostať rovnakých 50 otázok.
2. Zopakujte otázky v rovnakom AI vyhľadávaní a rovnakou metodikou ako Day 0.
3. Výsledky zapíšte do novej kópie, napríklad `data/geo-ai-results-day7.csv`.
4. Vyhodnoťte ich: `npm run geo:score -- data/geo-ai-results-day7.csv`.
5. Porovnajte celkové skóre, zmienky, citácie, správnosť a skupiny `P`, `O`, `B` s Day 0.

Meranie musí zachytiť skutočné odpovede AI po siedmich dňoch od nasadenia; nesmie sa simulovať iba z obsahu webu.
