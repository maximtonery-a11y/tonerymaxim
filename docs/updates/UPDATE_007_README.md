# UPDATE 007 – kompletné legacy presmerovania a recovery

Rozbaľte celý obsah ZIP-u priamo do koreňa projektu `C:\Users\roman\tonerymaxim` a potvrďte prepísanie súborov.

Potom spustite:

`SPUSTIT_MIGRATION_GATE.bat`

Riešenie používa toto poradie:

1. presná zhoda starého produktu -> 301 na konkrétny nový produkt,
2. bezpečne rozpoznaná tlačiareň -> pôvodná URL zostane ako plnohodnotná stránka 200,
3. nejednoznačný toner alebo model -> 302 na relevantné vyhľadávanie,
4. staré výrobné a tlačiarenské kategórie -> užitočná landing stránka 200,
5. zrušený netonerový sortiment -> správny stav 410 s odkazmi na nový e-shop,
6. nepoužíva sa hromadné presmerovanie na úvodnú stránku, ktoré by vytváralo soft 404.

`SPUSTIT_MIGRATION_GATE.bat` už nevyžaduje npm script `migration:gate`; spúšťa kontrolný runner priamo cez Node.js.
