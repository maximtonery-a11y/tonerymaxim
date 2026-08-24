# Oprava 502 a oddelenie reklamného systému

Tento balík obsahuje súbory na výmenu v existujúcom projekte ToneryMAXIM.

## Nasadenie e-shopu

1. Nahraďte súbory pri zachovaní priečinkov.
2. V Coolify vykonajte `Redeploy`.
3. Healthcheck ponechajte: `GET`, port aplikácie, cesta `/api/health`, návratový kód `200`.
4. Overte postupne `/api/health`, `/kosik`, `/pokladna` a produktovú stránku.

E-shop už automaticky nespúšťa e-mailový ani objednávkový background worker. Webové
trasy už nespúšťajú živý prepočet Ads Intelligence. Admin číta iba vopred vytvorený
snapshot.

## Samostatný Ads worker

Príkaz `npm run worker:ads:refresh` je určený iba pre samostatný Coolify worker
resource s vlastným pamäťovým limitom. Nespúšťajte ho ako startup command e-shopu.
Worker musí mať rovnaké potrebné premenné a zdieľaný persistentný adresár
`TM_PERSISTENT_DATA_DIR`; snapshot zapisuje do `ads-intelligence/snapshot.json`.

Kým samostatný worker nevytvoríte, administrácia bezpečne používa zabudovaný posledný
snapshot. Funkčnosť košíka ani pokladne od workeru nezávisí.
