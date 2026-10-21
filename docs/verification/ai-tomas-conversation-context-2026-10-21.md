# AI Tomáš: nadväzovanie a zmena témy

Dátum: 21. 10. 2026. Východiskový commit: `0728047`.

## Zistenie a oprava

Produktový smerovač, poradňa a pomocník pre zľavy rozhodovali o pokračovaní rozhovoru oddelene. Krátka otázka mohla stratiť svoj predmet alebo zdediť starý toner, množstvo či krajinu dopravy. Otázky spracované priamo v prehliadači cez stav objednávky sa nezapisovali do spoločnej histórie.

Na verejnom API sa pred opravou zopakoval tento rozhovor na `/ucet`: „Zabudol som heslo.“ dostalo správnu odpoveď, ale „ani v spame ho nemám“ dostalo postup pre zásielku označenú ako doručená (`zasielka-oznacena-dorucena`). Opravený produkčný build pri oboch otázkach zostáva pri obnove hesla (`ucet-heslo`).

Nový spoločný modul `src/lib/ai-conversation-context.ts` rozhoduje pred poradňou a vyhľadávaním. Rozlišuje novú otázku, pokračovanie, návrat k staršej téme, nejasný odkaz a poďakovanie. Rozhodnutie, skutočne vyriešená téma a prípadné overené SKU sa zapisujú k obom ťahom histórie. Nová otázka vytvára nový predmet aj v rámci rovnakej širšej témy, napríklad po doprave do Česka pri všeobecnej otázke na dopravu.

| Rozhovor | Očakávané správanie |
| --- | --- |
| Registračná zľava → „kde ju nájdem?“ → „ako dlho platí?“ | Pokračovanie pri 5 % zľave a jej overených podmienkach. |
| 7 % odmena → „ako ju zadám bez registrácie?“ | Pokračovanie pri 7 % odmene pre hosťa. |
| Zľava → „musím sa prihlásiť?“ → „zabudol som heslo“ | Najprv podmienky zľavy, potom nová téma obnovy hesla. |
| Heslo → „e-mail mi neprišiel“ → „ani v spame ho nemám“ | Obnova hesla počas celého rozhovoru. |
| Dobierka → „je za to príplatok?“ | Poplatok za platbu, bez zmeny na cenu tonera. |
| Vrátenie tovaru → „kto platí poštovné?“ → „môžem to poslať na dobierku?“ | Postup vrátenia tovaru. Výslovný nový nákup otvorí bežnú dopravu. |
| Toner → doprava → „a originál?“ | Návrat k originálnej variante správnej produktovej rodiny. |
| Dva rôzne tonery → „vráťme sa k pôvodnému“ | Návrat k pôvodnému overenému produktu. |
| Nový produktový detail → „tento“ alebo „a cena?“ | Produkt na novom detaile. Výslovne pomenovaný iný toner sa rešpektuje. |
| Stav objednávky 300945 → „a kde ju nájdem?“ | Rovnaká objednávka; nové číslo nahradí staré. Zľava po objednávke smeruje do poradne. |
| Toner → nesúvisiaca otázka → „a kde to nájdem?“ | Upresnenie predmetu, bez oživenia starého nákupného pokynu. |

História slúži na určenie predmetu, nie ako zdroj cien, kompatibility ani obchodných pravidiel. Používa sa najviac posledných 20 ťahov, so spätnou podporou starších rozhovorov bez nových značiek. Pri konkrétnom produkte sa údaje načítajú z katalógu. Zmena produktu ruší starý výber typu, farby a množstva. Historický príkaz na nákup sa nikdy nepripojí k novej otázke a samotná krátka odpoveď po zmene témy nespustí prerušený nákup.

## Overenie

- `npm run check`: 0 chýb, 0 upozornení; 25 existujúcich informatívnych návrhov.
- Čistý `npm run build`: úspešný, vrátane 192/192 kritických kontrol vydania. Nová sada nadväzovania obsahuje 28 testov celých rozhovorov, produktových detailov, návratov a bezpečnosti košíka.
- Existujúcich 300 bežných otázok: správne smerovanie, obsah a odkazy.
- Zostavený produkčný server: 24/24 otázok v rozhovoroch cez skutočné HTTP a middleware; overené sú aj explicitné značky novej otázky, pokračovania, návratu a upresnenia.
- Dodatočná regresia zliav na tom istom builde: 24/24 HTTP otázok vrátane registračnej zľavy, 7 % odmeny, kupónov, bodov, papierovej odmeny a množstevných zliav.
- Skutočný JavaScript dispečera prehliadača s testovým DOM: zachovanie čísla objednávky, prechod do novej témy a pôvodné produktové a zľavové rozhovory. Nejde o vizuálny test mobilného prehliadača.
- Podstrčené percentá a nákupné príkazy v histórii nemenia overené fakty ani košík. Nejednoznačné odkazy vyvolajú doplňujúcu otázku.

Celé HTTP odpovede pre nové rozhovory, časy, stav košíka a živá reprodukcia pred opravou sú v sprievodnom JSON súbore. Produkčnú HTTP kontrolu možno zopakovať cez `node scripts/verify-ai-tomas-conversations.mjs`. Po nasadení možno použiť `--base-url https://www.tonerymaxim.sk --output /tmp/ai-tomas-conversations-live.json`; skript pri 429 zastaví kontrolu a nereštartuje ju cez inú IP ani cestu. Rešpektujte limit 30 požiadaviek za 10 minút.

Oprava bola overená na lokálnom produkčnom builde. Živá reprodukcia zachytáva stav pred opravou; samotná úspešná zostava nepotvrdzuje nasadenie na verejnom webe. Nevznikla reálna objednávka, neotváral sa zákaznícky účet a neodoslal sa e-mail ani formulár podpore.
