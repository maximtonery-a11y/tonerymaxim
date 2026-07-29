# ToneryMAXIM – Security patch 54

ZIP obsahuje iba zmenené a nové súbory.

## Opravy
- všetky admin stránky sa mimo localhostu zamknú aj pri chýbajúcom admin kľúči,
- porovnanie admin kľúčov je časovo konštantné,
- produkcia odmietne štart pri chýbajúcom/slabom AUTH_SECRET,
- podpisovanie persistentných dát odmietne slabý alebo chýbajúci secret,
- doplnené rate limity pre zmenu hesla, logout, GoPay retry a synchronizáciu,
- `/api/sync-products` je mimo localhostu vždy uzamknuté a vyžaduje SYNC_SECRET s minimálne 24 znakmi.

## Pred nasadením v Coolify
Nastav minimálne:

```env
AUTH_SECRET=<nahodny-retazec-min-32-znakov>
TM_PERSISTENCE_SECRET=<iny-nahodny-retazec-min-32-znakov>
ADMIN_API_SECRET=<nahodny-retazec-min-24-znakov>
SYNC_SECRET=<nahodny-retazec-min-24-znakov>
TM_ALLOW_TEST_ENDPOINTS=0
```

## Dáta v Gite
Príkazy, ktoré si už spustil, sú správne:

```bash
git rm -r --cached .tm-data
git rm -r --cached .tm-cache
```

Potom skontroluj `git status`, commitni odstránenie sledovaných dát a pushni zmenu.
