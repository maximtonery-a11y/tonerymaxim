# UPDATE_006 – presné produktové SEO mapovanie

Aktualizácia obsahuje:

- **1484 deterministických 301 presmerovaní** starých produktových URL,
- presmerovanie len pri overenej zhode kódu, značky, typu produktu, farby, druhu materiálu a balenia,
- odstránenie automatických fuzzy presmerovaní, aby sa stará URL nikdy neposlala na nesprávny toner,
- doplnenie značiek Philips, IBM, Sharp a Pantum,
- verejnú indexovateľnú stránku `/vernostny-program`,
- správne mapovanie `/gdpr`,
- stabilnejší Migration Gate: nižšia súbežnosť, dlhší timeout, jedno opakovanie a korektná kontrola XML.

## Inštalácia

Rozbaľte ZIP priamo do koreňa projektu a povoľte prepísanie súborov. Potom spustite:

`SPUSTIT_MIGRATION_GATE.bat`

Výsledné `migration/reports/latest.csv` a `latest.html` odošlite na ďalšiu kontrolu.
