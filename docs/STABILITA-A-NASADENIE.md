# Stabilná prevádzka ToneryMaxim

Stabilita potrebuje ochranu pri zmene kódu, priebežné funkčné kontroly a správne nastavený hosting. Úspešný krátky audit nie je záruka nepretržitej prevádzky ani dôkaz neprítomnosti dlhodobého úniku pamäte.

## Ochrana pri každom nasadení

Používať `npm ci` a **`npm run build`**. Tento príkaz najprv automaticky spustí izolovaný `prebuild` s 93 kritickými testami. Pri zlyhaní sa Astro build nespustí. Pri inštalácii pre build musia byť dostupné aj vývojové závislosti používané testami. Priame `npx astro build` alebo vypnuté npm lifecycle skripty túto ochranu obchádzajú.

Testy nepreberajú produkčné credentials, blokujú externý fetch a používajú dočasnú cache. Pokrývajú hranice cache, výmenu generácie katalógu, neúspešné importy, OEM/prefixy, našeptávač, varianty tlačiarní, prázdnu pokladňu, ceny, množstevné zľavy, idempotenciu objednávok a obnovu GoPay. Existujúci plný regresný beh zostáva dostupný samostatne.

Workflow `.github/workflows/release-check.yml` pridáva na GitHub kontrolu pri push do `main` a `fix/**` a pri pull requeste: čistá inštalácia, Astro check a build s touto ochranou. Nenastavuje GitHub branch protection. Vyžadovanie úspešného CI aj pri merge je samostatné nastavenie repozitára.

## Kontrola živého webu

`npm run test:live` vykoná 12 funkčných kontrol produkcie. Workflow `.github/workflows/live-stability.yml` ich plánuje každú hodinu v 20. minúte UTC a umožňuje aj ručné spustenie. GitHub môže plánovaný beh oneskoriť; nie je to nepretržitý uptime monitoring.

Kontroly overujú health, homepage, skutočné vyhľadávanie, katalóg mladší než 30 hodín, rozpočty API/AI cache, prefixové sady, Samsung ML-2165W, cenu sady Canon, prázdnu pokladňu, odmietnutie prázdneho košíka objednávkovými API, AI výpočet množstevnej zľavy a správnu 404. Diagnostika katalógu sa kontroluje až po jeho načítaní reálnym vyhľadávaním, takže nový proces nespôsobí falošný poplach.

Nevytvára sa objednávka, platba ani e-mail. Objednávkové API dostávajú výhradne prázdny košík bez súhlasu. AI dostane iba otázku na cenu. Report neobsahuje údaje zákazníkov. Zlyhanie funkčnej kontroly ukončí beh s chybou, JSON sa uchová v GitHub artifacts 14 dní. Nenastavený limit pamäte a neúspešný posledný import sa vypíšu aj ako samostatné upozornenia. Notifikácie závisia od nastavenia GitHub Actions účtu; osobitný príjemca ani externý notifikačný kanál sa týmto commitom nenastavujú.

## Jednorazovo nastaviť a overiť v Coolify

K hostingu nie je dostupné administračné pripojenie. Nasledujúce nastavenia preto nie sú týmto commitom vykonané ani overené:

1. **Skutočný limit RAM kontajnera.** Overiť celkovú RAM servera a súbežné služby, potom určiť limit s rezervou pre ranný import. Predošlý extrémny lokálny test dosiahol 673 MiB RSS, preto 512 MiB nie je preukázaný bezpečný strop. `TM_PROCESS_MEMORY_LIMIT_MB` je len diagnostický rozpočet, kontajner neobmedzuje. Po nastavení overiť `cgroupLimitMb` a zhodu s reálnym limitom v Coolify.
2. **Obnova služby.** Nastaviť reštart po páde procesu, healthcheck `/api/health` a overiť reakciu hostingu pri neúspešnom healthchecku. Samotný Docker stav `unhealthy` nie je automatický reštart. Nastaviť upozornenie na nedostupnosť a opakované chyby/importy. Overiť návrat na posledné funkčné nasadenie.
3. **Trvalé dáta a záloha s vyskúšanou obnovou.** Overiť existujúci persistentný mount pre `TM_PERSISTENT_DATA_DIR`; jeho podadresár `product-cache` aj objednávková fronta musia prežiť redeploy/reštart. Nemeňte existujúcu cestu alebo persistence secret bez plánovanej migrácie. Overiť zálohu dát aj možnosť ich dešifrovania pri obnove. Reálnu frontu počas kontroly nemažte.
4. **Príkaz buildu a GitHub upozornenia.** Potvrdiť `npm run build`, zapnuté Actions a doručenie upozornenia pri testovacom zlyhaní. Ak má merge s červeným CI byť zakázaný, nastaviť povinný stav `critical-checks-and-build` v pravidlách vetvy.

Po redeployi potvrdiť výsledok živého workflow, vizuálne overiť hlavičku pri 1348 px s dlhým názvom účtu a počkať na prvý skutočný ranný import. Porovnať špičku, uvoľnenie heapu, hranice cache a platnosť cien/detailov. Kontroly ani opravy nevyžadujú obmedzenie katalógu, vyhľadávania alebo objednávania. Reštartovanie podľa samotného rastu RSS či vynucovanie GC nie je náhrada za opravu príčiny.

Náhradné fotografie troch dodávateľských položiek zostávajú dátovou úlohou: Lexmark 56F2X0E, Canon CRG-045BK kompatibilný a Kyocera TK-3160 kompatibilný potrebujú overené fotografie kompatibilného výrobku. Úspešný HTTP status obrázka nepotvrdzuje jeho vecnú správnosť.

Výsledky tohto vydania sú v [overovacom reporte](verification/stability-release-2026-10-15.md).
