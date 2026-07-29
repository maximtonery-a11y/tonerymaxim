# UPDATE_005 – bezpečné SEO opravy migrácie

Obsahuje iba zmenené súbory.

- dopĺňa canonical na 8 existujúcich statických stránok,
- pridáva presné 301 presmerovania pre `/gdpr`, `/vernostny-program` a `/mapa-stranek`,
- rozširuje staré URL modelov tlačiarní o bezpečné aliasy variantov a stránok `Series`,
- alias sa použije len vtedy, keď po odstránení variantu existuje presný model v produktovej cache,
- nezasahuje do checkoutu, produktov, cien ani objednávok.

Po rozbalení spustite znova `SPUSTIT_MIGRATION_GATE.bat` a pošlite nové `latest.html` a `latest.csv`.
