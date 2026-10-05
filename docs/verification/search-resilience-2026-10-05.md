# Našeptávač: pomalé odpovede a studený index — 5. 10. 2026

## Potvrdená chyba a oprava

Klient rušil každú požiadavku po 4 sekundách. Abort sa neopakoval a po zobrazení
„Pokračujte Enterom“ už neskorší výsledok nemohol prísť. Na mobile chýbal priamy odkaz.

Teraz po 4 sekundách zobrazí odkaz na plné výsledky, pričom odpoveď môže stále doplniť
návrhy. Absolútny limit zostáva konečný: 30 sekúnd. Nový dotaz, Escape, odchod kliknutím
mimo a odoslanie formulára rušia starú požiadavku okamžite. Zastaralé odpovede nesmú
prepísať novšie. Rýchla odpoveď ruší oba časovače. Existujúci jednorazový retry pri
sieťovej chybe ostáva zachovaný. Nepribudol serverový cache ani interval.

Toto opravuje stratu návrhov pri pomalšej odpovedi, neznižuje samo osebe latenciu siete
ani negarantuje dostupnosť služby. Serverový ranking, index a nákupný tok sa nemenia.

## Overenie

- Nasadený predchádzajúci commit b91b620: produkčné CF53 má 14 produktov; prvé dve
  návrhy sú sady HP 205A. Potvrdené API aj interakciou na homepage v prehliadači.
- Produkčné TN2421: 3 návrhy; M1132: 5 návrhov; HTTP 200.
- Homepage, košík, pokladňa, health a storefront-check: HTTP 200, kontrolné API ok:true.
  Išlo o GET kontroly, nie kompletný nákup či uskutočnenú platbu. Browser ukázal
  prihlásený účet, preto sa v ňom nemenil košík; HTTP kontroly boli bez cookies.
- Stav procesu pri meraní: uptime 8230 s, RSS 248 MB, heap 124 MB, cgroup 225 MB,
  7925 katalógových položiek. Produkčný proces už bol zahriaty, nie studený.
- Externá HTTP testovacia trasa mala 13–20 s aj na health/homepage. Z tohto merania
  nemožno prisúdiť latenciu vyhľadávaciemu indexu ani určiť zákaznícke LCP.
- Tri nové lokálne Node procesy, reálny snapshot 3886 tonerov z 05:07:45 UTC:
  tri súbežné studené dotazy CF53/TN2421/M1132 dokončené za 792, 1650 a 956 ms
  (maximum dotazov v jednotlivých behoch); opakovania 1, 6 a 1 ms. Všetky úspešné,
  rovnaké ID a poradie za studena aj po zahriatí; jeden index sa opätovne používal.
  RSS po testoch 250–252 MB. Je to benchmark indexu v RAM, nie kompletný studený
  štart produkčného kontajnera, disku, proxy ani celého 7925-položkového katalógu.
- 88 regresných testov úspešných vrátane siedmich nových klientskych scenárov,
  OEM/prefixov/sád, presných SKU, GoPay recovery, pokladne, memory-v1 a AI cien.
- Nový test pomalej odpovede reprodukuje pôvodnú chybu na nezmenenom klientovi.
- Produkčný Astro build úspešný.
- Predchádzajúca matica 300 označení / 1111 kontrol je v search-fix-2026-10-05.md.
  V tomto balíku sa celá matica znovu nespúšťala: vyhľadávacie pravidlá sa nemenia.

## Opakovateľné príkazy

```
node --test scripts/search-client-resilience.test.mjs
TM_SEARCH_CATALOG=/path/catalog.json node --experimental-strip-types scripts/verify-search-cold.ts
npm run test:search
npm run build
```

Po deployi overiť prvú interakciu s prázdnou browser cache na mobile aj PC.
Skutočný studený VPS štart je potrebné odmerať pri plánovanom deployi spolu s logmi
Coolify/proxy; tento audit produkčný proces nereštartoval. Dlhodobý memory leak
ani príčinu celého sieťového oneskorenia nemožno z uvedených krátkych behov uzavrieť.
