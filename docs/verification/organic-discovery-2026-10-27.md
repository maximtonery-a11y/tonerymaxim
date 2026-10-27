# Organické vyhľadávanie: dostupnosť vo feede a zmenené adresy

Dátum kontroly: 27. 10. 2026. Východiskový commit: `0c050af66eb4fd4f743b4bf4f13ae5f32a5ac375`.

## Problém a výsledok opravy

WooCommerce môže uviesť `stock_status=instock` bez počtu kusov. Web taký
produkt správne zobrazuje ako skladom. Merchant a Heureka však pri `null` alebo
prázdnom poli vyhodnotili `Number(...)` ako nulu a produkt vylúčili. AI feed ho
označil ako vypredaný a neznámy počet premenil na nulu. Nečíselný počet mal
opačný problém: feed ho vedel vyhodnotiť ako dostupný, hoci web ho za skladový
nepovažoval.

Všetky tri exporty teraz používajú existujúce `isAvailableNow`, teda rovnaké
pravidlá ako web. AI export pri neznámom počte kusov ponechá hodnotu prázdnu.
V dodanom reálnom exporte má tento stav 279 produktov, z toho 277 má platnú
publikovateľnú URL. Lokálny opravený Merchant export zahŕňa 275 z nich;
ďalšie dve sú sady bez čipu a ostávajú vylúčené existujúcim pravidlom.
Heureka správne zahŕňa 277 položiek a AI feed pri 277 uvádza `in_stock`
bez vymyslenej nulovej zásoby. V celom načítanom živom AI feede sa potvrdilo,
že pôvodný kód týchto 277 položiek označuje ako `out_of_stock`.

Pri zmene slugu toho istého produktu IndexNow oznamoval iba novú URL.
Teraz oznámi aj pôvodnú URL, aby ju vyhľadávač mohol znova navštíviť a nájsť
existujúce presmerovanie. Samotné presmerovania sa nemenia. Oznámenie ani
HTTP 200 od IndexNow negarantujú indexáciu.

## Overenie

- 16 nových regresných testov: 6 reprodukovaných zlyhaní pred opravou,
  po oprave 16/16 úspešných.
- Úplné `npm run test:seo` s katalógom z dodaného Woo exportu:
  **87/87 úspešných**, bez preskočených testov či oslabenia tvrdení.
- `npm run check`: 532 súborov, 0 chýb, 0 warnings, 25 existujúcich hints.
- `npm run build`: 242/242 prednasadzovacích testov a úspešný Astro build.
- IndexNow sa v testoch zachytáva lokálnym mockom. Build prebehol s vypnutým
  IndexNow, background workers a živou AI. Testy neodosielali produkčné
  indexačné požiadavky ani objednávky.
- `git diff --check`: bez chýb.

## Podklad a príprava reálneho katalógu

Použitý export `wc-product-export-27-10-2026-1793084437966.csv` má
7 976 jedinečných ID a 131 stĺpcov; obsahuje 7 923 publikovaných produktov
a 53 konceptov. SHA-256 zdroja:
`1e29eeffda9ebd6fe77c13581b3932403e1e4ca442a5860605af9dae5c6207c3`.

CSV neobsahuje slug. Existujúce adresy 7 757 publikovateľných produktov
boli priradené podľa stabilného Woo ID z úplne načítaného živého AI feedu.
Adresy zvyšných nepublikovateľných záznamov sa nevymýšľali. Kontrola potvrdila,
že žiadny publikovateľný produkt s kladnou cenou nezostal bez overenej URL.

CSV stĺpce boli prevedené do tvaru Woo produktov a spracované nezmenenou
produkčnou funkciou `syncProductsCache`, vrátane `mapProduct`, dopĺňania
súvisiacich údajov a rozdelenia popisov do NDJSON. Vstupné Woo stránky
dodával výhradne lokálny mock z CSV: 80 strán, 7 923 produktov.
Živé Woo API ani produkčná synchronizácia sa pri tomto kroku nevolali.
Verejný katalóg následne obsahuje 7 905 položiek po rovnakom vylúčení 18
renovačných služieb ako na webe; 7 757 spĺňa publikačné pravidlá.

Pri príprave sa zachoval rozdiel medzi `null` a nulovou zásobou,
slovenské desatinné čiarky, platnosť akciových cien, vlastnosti a metadáta.
Všetkých desať porovnávaných polí troch vzoriek z lokálneho katalógu sa
zhodovalo so živým `/api/product`: HP W1420XL, Canon PG-545 XL + CL-546 XL
a Brother LC-1240 sada s neznámym počtom kusov.
Export a testovací katalóg nie sú súčasťou commitu.

## Integračná kontrola zostaveného webu

Zostavený Astro server bol spustený s lokálnym katalógom, vypnutými
background workers, IndexNow a živou AI. Všetky odchádzajúce požiadavky
servera boli blokované; testovací HTTP klient a server bežali v tom istom
procese na náhodnom loopback porte. V tomto prostredí bolo vypnuté iba
logovanie adries adaptéra, pretože enumerácia sieťových rozhraní nie je
dostupná. Produkčný kód sa kvôli tomu nemenil.

**17/17 endpointov vrátilo HTTP 200:** 8 HTML stránok, index a päť hlavných
sitemap a tri kompletné produktové feedy. Všetky kontrolované HTML stránky
mali jednu H1, presný produkčný canonical, indexovateľné meta a syntakticky
platné JSON-LD. XML sa kontrolovalo v celom rozsahu, vrátane unikátnosti ID
a URL; nejde iba o začiatok odpovede.

| Lokálny výstup | Počet položiek / URL | Neznámy počet kusov správne spracovaný |
| --- | ---: | ---: |
| Merchant XML | 2 649 | 275 |
| Heureka XML | 2 965 | 277 |
| AI XML | 7 757 | 277 |
| Produktová sitemap | 7 757 | - |
| Sitemap tlačiarní | 7 539 | - |
| Sitemap OEM | 2 480 | - |
| Sitemap značiek | 38 | - |
| Sitemap statických stránok | 61 | - |

Platná syntax nie je zárukou prijatia do vyhľadávača ani potvrdením každej
produktovej informácie vo Woo. Údaje Search Console a účtov Merchant/Bing
neboli súčasťou tejto kontroly.

## Verejná kontrola webu

Všetkých 12 skontrolovaných adries vrátilo HTTP 200:

- `/`, `/robots.txt`, `/sitemap.xml`, `/sitemap-pages.xml`,
- `/firemna-tlac`, `/poradna`,
- `/tlaciarne/brother/brother-dcp-l2532dw`,
- `/produkt/brother-dr-2401-cierny-kompatibilny-opticky-valec`,
- `/merchant-feed.xml`, `/ai-product-feed.xml`, `/heureka.xml`,
- existujúci verejný overovací súbor IndexNow.

Päť skontrolovaných HTML stránok malo jednu H1, produkčný canonical,
indexovateľné robots meta a syntakticky platné JSON-LD. Ide o vzorku,
nie dôkaz správnosti celého katalógu či oprávnenosti rich results.
Pri troch veľkých feedech sa čítalo iba prvých 700 kB; neprebehla úplná
validácia všetkých položiek. `noindex` na XML feede nie je chyba:
feed slúži na spracovanie príslušnou službou, nie ako výsledok webového hľadania.

## Ďalšie priority auditu

1. Overiť stav indexácie a konkrétne vylúčené URL v Search Console a Bing
   Webmaster Tools. K súkromným dátam týchto účtov táto kontrola nemala prístup.
2. Preveriť finálny názov produktu v Merchant XML. Pri kompatibilných
   kazetách musí zodpovedať pravidlám pre produkty tretích strán; finálny
   formatter dnes vracia značku tlačiarne na začiatok.
3. Preveriť stav renovovaných a iba znovu naplnených kaziet. Merchant XML
   aj Product JSON-LD dnes používajú nový stav paušálne. Google rozlišuje
   `new`, `refurbished` a `used` podľa skutočnej povahy produktu. Presné
   zaradenie, identifikátory a obrázky treba skontrolovať na reálnych produktoch.
4. Pri prioritných modeloch overiť kompatibilitu, región kazety, HP+,
   kapacitu, typ spotrebného materiálu a vnútorné odkazy.
5. Zmerať mobilné Core Web Vitals a serverové časy z relevantnej lokality.
   Čas jedného externého HTTP požiadavku nie je LCP ani mobilný benchmark.

Oficiálne podklady:

- https://developers.google.com/search/docs/appearance/ai-features
- https://developers.openai.com/api/docs/bots
- https://www.indexnow.org/documentation
- https://support.google.com/merchants/answer/7558050?hl=sk
- https://support.google.com/merchants/answer/6324469?hl=sk

## Nasadenie

Kontrola s reálnym katalógom je dokončená a tento návrh je pripravený
na kontrolu a zlúčenie. Vetva zatiaľ nebola zlúčená do main ani nasadená.
Po nasadení znovu skontrolovať tri exporty a bežný produktový detail.
Výsledok IndexNow skontrolovať po najbližšom riadnom produktovom synchrone;
nie je potrebné kvôli overeniu vyvolávať kompletný import.
