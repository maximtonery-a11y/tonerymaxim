# UPDATE_008 – posledných 17 blokujúcich URL

Balík opravuje presne 17 položiek z reportu `latest(2)`:

- 12 starých koreňových stránok výrobcov presmeruje 301 na príslušnú stránku výberu tlačiarne.
- Dopĺňa 4 presné produktové mapovania.
- Jednu historickú chybnú URL `/vyrobci//` prestane Migration Gate blokovať, ak sa bezpečne dostane cez normalizáciu na `/produkty`.

## Inštalácia

Rozbaľte obsah ZIP priamo do koreňa projektu:

`C:\Users\roman\tonerymaxim`

Potvrďte nahradenie existujúcich súborov a znova spustite:

`SPUSTIT_MIGRATION_GATE.bat`

Po teste skontrolujte `migration\reports\latest.html`.
